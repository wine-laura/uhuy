"""
live_server.py — SAPA
Router FastAPI untuk mode Live (WebSocket /ws/live).

Protokol (sesuai addendum B.2):
  Browser → Server (tiap ~200ms):
    { "type": "frame", "image": "data:image/jpeg;base64,...", "t": 12.34,
      "camera_type": "lorong" | "rak" }

  Server → Browser:
    { "type": "pose",  "t": 12.34, "tracks": { "3": [[x,y,conf], ...×17] } }
    { "type": "event", "tipe": "jatuh"|"butuh_bantuan",
      "t0": .., "t1": .., "track_id": .. }

Arsitektur:
- Satu WebSocket per sesi klien (satu browser tab).
- Setiap sesi punya instance YOLO dan buffer sendiri → tidak ada shared state
  global, aman untuk koneksi bersamaan.
- Reuse pipeline yang sama dengan mode upload:
  pose+tracking → normalize → models → geometry
- Threshold klasifikasi sama dengan analyze.py.

CATATAN: untuk deployment CCTV sungguhan (RTSP, multi-kamera, alert, 24/7),
pakai mode produksi di production/ — lihat docs/PRODUKSI.md. Modul ini khusus
demo webcam lewat browser.
"""

import asyncio
import base64
import json
import logging
import os

import cv2
import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from pipeline import thresholds as TH
from pipeline import uniform as UNI
from pipeline.geometry import INTERACTION_CLASS_NAMES
from production.buffer import TrackWindowBuffer
from production.worker import muat_yolo

logger = logging.getLogger(__name__)

# ── Router FastAPI ─────────────────────────────────────────────────────────────
router = APIRouter()

# ── Konfigurasi (sama dengan analyze.py) ──────────────────────────────────────
WINDOW_SIZE    = 45     # frame per jendela BiLSTM setelah resample (= 3 dtk @15fps)
FPS_TUJUAN     = 15.0   # HARUS sama dengan saat training (fall_head.json: fps=15)
# Ambang jatuh disamakan dengan jalur unggah-klip (pipeline/thresholds.py)
# supaya satu kejadian yang sama tidak dinilai berbeda hanya karena masuk
# lewat mode Live. Masih bisa ditimpa lewat env var untuk uji lapangan.
FALL_THRESH    = float(os.getenv("FALL_THRESH",   TH.FALL_THR_DEFAULT))
FALL_SPEED     = float(os.getenv("FALL_SPEED",    TH.FALL_SPEED_DEFAULT))
DWELL_THRESH   = float(os.getenv("DWELL_THRESH",  0.60))
TORSO_THRESH   = float(os.getenv("TORSO_THRESH",  TH.FALL_ANGLE_DEFAULT))  # derajat
INSPECT_THRESH = float(os.getenv("INSPECT_THRESH", 0.50))
# Angkat tangan minta bantuan (aturan, lihat pipeline/gestures.py). Di mode live
# durasinya dibuat lebih pendek dari jalur unggah-klip: satu jendela live = 3
# detik dan dievaluasi sendiri-sendiri, jadi menuntut 2,5 detik DI DALAM satu
# jendela praktis tak pernah tercapai. Yang tetap menyaring stretching/tos di
# sini adalah syarat stabil + satu tangan + bukan meraih rak.
ANGKAT_AKTIF      = os.getenv("ANGKAT_AKTIF", "1").lower() in ("1", "true", "yes", "on")
ANGKAT_MIN_DURASI = float(os.getenv("ANGKAT_MIN_DURASI", 1.2))

# Exclude pegawai via seragam. Hanya jalan bila toko sudah mendaftarkan seragam
# (lihat POST /seragam) — tanpa itu tidak ada yang bisa dicocokkan.
# Seperti di jalur unggah-klip: tanda pegawai HANYA mengecualikan dari
# butuh-bantuan, TIDAK PERNAH dari deteksi jatuh.
SERAGAM_FRAME_CEK = int(os.getenv("SERAGAM_FRAME_CEK", 8))
PROFIL_SERAGAM = os.getenv(
    "SAPA_PROFIL_SERAGAM",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "seragam.json"),
)

# Jendela analisis dalam DETIK. Browser mengirim frame ~5fps, tapi laju itu
# bergoyang mengikuti beban perangkat klien — menyimpan "45 frame terakhir"
# berarti buffer memuat 9 detik kejadian yang lalu di-resample dan hanya bagian
# AWAL-nya yang dianalisis, sehingga alert tertinggal beberapa detik. Karena itu
# jendela diukur dengan waktu dan src_fps dihitung dari stempel waktu nyata.
WINDOW_SECONDS = 3.0
STRIDE_SECONDS = 1.0


def _pose_track(yolo, frame: np.ndarray) -> dict:
    """
    Ekstraksi pose + tracking untuk satu frame. Kembalikan {track_id: [17,3]}.

    Memakai .track(persist=True), BUKAN .predict(). Dengan .predict() angka yang
    dipakai sebagai "track_id" sebenarnya hanya indeks deteksi dalam frame, yang
    berubah setiap kali urutan deteksi bergeser — akibatnya buffer per-orang
    berisi campuran beberapa manusia dan sekuens gerak yang dianalisis tidak
    pernah benar-benar milik satu orang.
    """
    hasil = yolo.track(
        frame, persist=True, tracker="bytetrack.yaml", conf=0.25, verbose=False
    )[0]

    keluaran: dict[int, np.ndarray] = {}
    if hasil.keypoints is None or hasil.keypoints.data is None:
        return keluaran

    kps_data = hasil.keypoints.data
    boxes = hasil.boxes

    for i in range(len(kps_data)):
        # Tanpa ID dari tracker, sampel tidak bisa dikaitkan ke orang tertentu.
        if boxes is None or boxes.id is None or i >= len(boxes.id):
            continue
        kps = kps_data[i].cpu().numpy().astype(np.float32)
        if kps.shape == (17, 3):
            keluaran[int(boxes.id[i].item())] = kps

    return keluaran


def _inferensi_jendela(jendela, camera_type, fall_head, interaction_head,
                       ini_pegawai: bool = False) -> list:
    """
    Inferensi satu jendela satu orang. Sepenuhnya SINKRON — dipanggil lewat
    run_in_executor lalu hasilnya dikirim dari konteks async pemanggil.

    Versi sebelumnya membungkus asyncio.run_coroutine_threadsafe(...).result()
    di dalam run_in_executor: thread pool diblokir menunggu event loop sementara
    inferensi torch tetap berjalan di loop itu sendiri — tidak menghasilkan
    konkurensi apa pun dan rawan deadlock saat beberapa jendela siap bersamaan.
    """
    from pipeline.normalize import build_windows_for_heads
    from pipeline.geometry import window_torso_angle, window_torso_speed, is_dwell
    from pipeline.gestures import deteksi_angkat_tangan
    from pipeline.models import predict_proba
    import torch

    kejadian: list = []

    masukan = build_windows_for_heads(
        jendela.frames,
        src_fps=jendela.src_fps,      # laju NYATA jendela ini, bukan angka tetap
        window=WINDOW_SIZE,
        stride=WINDOW_SIZE,
        dst_fps=FPS_TUJUAN,
    )
    raw_windows = masukan["raw_windows"]
    if raw_windows.shape[0] == 0:
        return kejadian

    raw = raw_windows[-1]
    t0 = round(jendela.t_mulai, 2)
    t1 = round(jendela.t_selesai, 2)

    # ── Kepala Jatuh — dimatikan untuk kamera rak (top-down) ──────────────────
    if camera_type != "rak" and fall_head is not None:
        x = torch.from_numpy(masukan["fall_input"][-1:])
        skor = float(predict_proba(fall_head, x)[0, 2])       # kelas 2 = jatuh
        sudut = window_torso_angle(raw)
        kecepatan = window_torso_speed(raw, fps=FPS_TUJUAN)
        if TH.is_fall(skor, sudut, kecepatan, FALL_THRESH, TORSO_THRESH, FALL_SPEED):
            kejadian.append({
                "type": "event", "tipe": "jatuh",
                "track_id": jendela.track_id,
                "t0": t0, "t1": t1,
                "skor": round(skor, 3),
                "sudut_torso": round(sudut, 1),
                "kecepatan": round(kecepatan, 2),
            })

    # ── Kepala Interaksi — dimatikan untuk kamera lorong ──────────────────────
    # CAKUPAN: pegawai dikecualikan dari butuh-bantuan saja. Blok Kepala Jatuh
    # di atas sengaja TIDAK memeriksa ini_pegawai — pegawai yang jatuh tetap
    # keadaan darurat.
    label_aksi = None
    if camera_type != "lorong" and interaction_head is not None and not ini_pegawai:
        x = torch.from_numpy(masukan["interaction_input"][-1:])
        proba = predict_proba(interaction_head, x)
        label_aksi = INTERACTION_CLASS_NAMES[int(proba[0].argmax())]
        # Kelas 3,4,5 = hand_in_shelf, inspect_product, inspect_shelf
        skor = float(proba[0, 3:6].sum())
        if skor >= INSPECT_THRESH and is_dwell(raw, dwell_ratio=DWELL_THRESH):
            kejadian.append({
                "type": "event", "tipe": "butuh_bantuan",
                "sinyal": "pasif",          # dwell + inspect
                "track_id": jendela.track_id,
                "t0": t0, "t1": t1,
                "skor": round(skor, 3),
            })

    # ── Angkat tangan minta bantuan (aturan, tanpa model) ────────────────────
    # Sinyal AKTIF: permintaan eksplisit, prioritas lebih tinggi dari dwell.
    # Dipakai di semua jenis kamera — orang bisa minta bantuan di lorong maupun
    # di depan rak.
    if ANGKAT_AKTIF and not ini_pegawai:
        frames_idx = [(i, kp) for i, kp in enumerate(jendela.frames)]
        label_map = (
            {i: label_aksi for i, _ in frames_idx} if label_aksi else None
        )
        ev = deteksi_angkat_tangan(
            frames_idx,
            src_fps=jendela.src_fps,
            cfg={"angkat_min_durasi": ANGKAT_MIN_DURASI},
            label_per_frame=label_map,
        )
        if ev:
            e = ev[-1]
            kejadian.append({
                "type": "event", "tipe": "butuh_bantuan",
                "sinyal": "aktif",          # angkat tangan
                "track_id": jendela.track_id,
                "t0": t0, "t1": t1,
                "skor": 1.0,
                "durasi": round(e["durasi"], 2),
                "sisi_tangan": e["sisi"],
            })

    return kejadian


@router.websocket("/ws/live")
async def ws_live(websocket: WebSocket):
    """
    Endpoint WebSocket utama mode live.
    Satu sesi per klien — state buffer tidak dibagi antar koneksi.
    """
    await websocket.accept()
    logger.info("[live] Klien terhubung.")

    # Muat model dari app.state (sudah di-load saat startup app.py)
    # Fallback: load langsung dari disk jika dipanggil standalone
    try:
        from app import _state as app_state
        fall_head        = app_state.get("fall_model")
        interaction_head = app_state.get("inter_model")
        if fall_head is None and interaction_head is None:
            raise RuntimeError("app_state kosong")
        logger.info("[live] Menggunakan model dari app_state.")
    except Exception:
        # Fallback: load langsung
        try:
            from pipeline.models import load_head
            import os
            BASE = os.path.dirname(__file__)
            fall_head        = load_head(
                os.path.join(BASE, "models", "fall_head.pt"),
                os.path.join(BASE, "models", "fall_head.json"),
            )[0]
            interaction_head = load_head(
                os.path.join(BASE, "models", "interaction_head.pt"),
                os.path.join(BASE, "models", "interaction_head.json"),
            )[0]
            logger.info("[live] Model dimuat langsung dari disk.")
        except Exception as e2:
            logger.warning(f"[live] Gagal muat BiLSTM heads: {e2}. Mode stub (pose only).")
            fall_head        = None
            interaction_head = None

    loop = asyncio.get_running_loop()

    # Instance YOLO sendiri per sesi: state ByteTrack tersimpan di dalam objek
    # model, jadi membaginya antar tab browser akan menukar ID antar sesi.
    try:
        yolo = await loop.run_in_executor(None, muat_yolo)
    except Exception as e:
        logger.error(f"[live] Gagal memuat YOLO: {e}")
        await websocket.close()
        return

    # ── Seragam pegawai (per sesi) ───────────────────────────────────────────
    # Dimuat sekali saat sesi dibuka. Kalau toko belum mendaftarkan seragam,
    # daftarnya kosong dan seluruh jalur ini otomatis tidak aktif.
    daftar_seragam = UNI.muat_seragam(PROFIL_SERAGAM)
    sig_track: dict = {}     # {track_id: [signature, ...]} frame-frame awal
    status_pegawai: dict = {}  # {track_id: bool} — sekali diputuskan, tetap
    if daftar_seragam:
        logger.info(f"[live] {len(daftar_seragam)} seragam terdaftar — exclude pegawai aktif.")

    buf = TrackWindowBuffer(
        window_seconds=WINDOW_SECONDS,
        stride_seconds=STRIDE_SECONDS,
        max_gap_seconds=1.5,     # browser bisa tersendat; beri toleransi
        track_ttl_seconds=5.0,
        min_frames=6,            # ~5fps × 3 dtk = 15 sampel ideal
    )

    try:
        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=10.0)
            except asyncio.TimeoutError:
                # Klien tidak kirim frame selama 10 detik → anggap mati
                break

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            if msg.get("type") != "frame":
                continue

            image_b64  = msg.get("image", "")
            t_now      = float(msg.get("t", 0.0))
            camera_type = msg.get("camera_type", "both")

            # Decode gambar JPEG base64
            try:
                header, data = image_b64.split(",", 1) if "," in image_b64 else ("", image_b64)
                img_bytes = base64.b64decode(data)
                arr = np.frombuffer(img_bytes, np.uint8)
                frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                if frame is None:
                    continue
            except Exception as e:
                logger.debug(f"[live] Decode frame gagal: {e}")
                continue

            # Ekstraksi pose + tracking — di thread terpisah agar tidak block loop
            try:
                track_kps = await loop.run_in_executor(None, _pose_track, yolo, frame)
            except Exception as e:
                logger.debug(f"[live] Ekstraksi pose gagal: {e}")
                continue

            # ── Sidik seragam dari area torso ────────────────────────────
            # Diambil DI SINI karena hanya di sini piksel frame tersedia.
            # Hanya beberapa frame AWAL tiap track: begitu diputuskan, status
            # pegawai bertahan selama track_id hidup — tidak ada pemeriksaan
            # warna tiap frame, jadi beban per frame tetap ringan.
            if daftar_seragam:
                h_f, w_f = frame.shape[:2]
                for tid, kps in track_kps.items():
                    if tid in status_pegawai:
                        continue        # sudah diputuskan
                    if len(sig_track.get(tid, [])) >= SERAGAM_FRAME_CEK:
                        # Cukup sampel → putuskan sekali, lalu berhenti mengecek.
                        hasil = UNI.tandai_pegawai(
                            {tid: sig_track[tid]}, daftar_seragam, {}
                        )
                        status_pegawai[tid] = bool(hasil[tid]["pegawai"])
                        if status_pegawai[tid]:
                            logger.info(
                                f"[live] track={tid} dikenali PEGAWAI "
                                f"(skor {hasil[tid]['skor']}) — dikecualikan dari "
                                f"butuh-bantuan, tetap dicek jatuh."
                            )
                        sig_track.pop(tid, None)
                        continue
                    kotak = UNI.kotak_torso(kps, w_f, h_f)
                    if kotak is not None:
                        x0, y0, x1, y1 = kotak
                        sig = UNI.signature_dari_patch(
                            frame[y0:y1, x0:x1],
                            min_area=UNI.DEFAULT["seragam_min_area"],
                        )
                        if sig is not None:
                            sig_track.setdefault(tid, []).append(sig)

            # Push ke buffer dengan stempel waktu dari klien
            for tid, kps in track_kps.items():
                buf.push(tid, kps, t_now)

            # Kirim pose ke browser untuk overlay langsung
            tracks_json = {
                str(tid): kps.tolist()
                for tid, kps in track_kps.items()
            }
            await websocket.send_json({
                "type":   "pose",
                "t":      round(t_now, 3),
                "tracks": tracks_json,
                # Track yang dikenali pegawai — untuk label berbeda di overlay.
                "pegawai": [int(t) for t, v in status_pegawai.items() if v],
            })

            # Inferensi untuk jendela yang siap. Bagian berat dikerjakan di
            # thread executor; pengiriman hasil tetap di event loop ini.
            for jendela in buf.jendela_siap():
                try:
                    kejadian = await loop.run_in_executor(
                        None, _inferensi_jendela,
                        jendela, camera_type, fall_head, interaction_head,
                        bool(status_pegawai.get(jendela.track_id, False)),
                    )
                except Exception as e:
                    logger.warning(
                        f"[live] Inferensi gagal track={jendela.track_id}: {e}"
                    )
                    continue

                for ev in kejadian:
                    await websocket.send_json(ev)
                    logger.info(
                        f"[live] {ev['tipe']} track={ev['track_id']} skor={ev['skor']}"
                    )

            buf.bersihkan(t_now)

    except WebSocketDisconnect:
        logger.info("[live] Klien terputus.")
    except Exception as e:
        logger.warning(f"[live] Error sesi WS: {e}")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
        logger.info("[live] Sesi WS ditutup.")


# ── run_local_capture() ────────────────────────────────────────────────────────
def run_local_capture(source=0):
    """
    Pratinjau pose lokal — untuk mengecek kamera dan sudut pemasangan.

    source: 0 (webcam lokal) atau "rtsp://user:pass@ip:554/stream" (kamera IP)
    Tekan 'q' untuk berhenti.  Contoh: python live_server.py 0

    Fungsi ini SENGAJA hanya menggambar pose, tidak menjalankan deteksi kejadian.
    Untuk deployment CCTV sungguhan — RTSP tahan-putus, multi-kamera, alert,
    debounce, log kejadian — pakai mode produksi:

        SAPA_PRODUKSI=1 uvicorn app:app --port 8000

    Lihat docs/PRODUKSI.md.
    """
    from pipeline.render import COLOR_NORMAL, _draw_skeleton

    try:
        yolo = muat_yolo()
    except Exception as e:
        print(f"[local] Gagal memuat YOLO: {e}")
        return

    cap = cv2.VideoCapture(int(source) if str(source).isdigit() else source)
    if not cap.isOpened():
        print(f"[local] Tidak bisa membuka sumber: {source}")
        return

    print(f"[local] Pratinjau pose dari: {source}. Tekan 'q' untuk berhenti.")
    frame_count = 0

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            frame_count += 1

            for kps in _pose_track(yolo, frame).values():
                _draw_skeleton(frame, kps, COLOR_NORMAL, thickness=2)

            cv2.putText(frame, f"frame={frame_count}", (10, 28),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

            cv2.imshow("SAPA — Pratinjau Pose", frame)
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break
    finally:
        cap.release()
        cv2.destroyAllWindows()
        print("[local] Pratinjau selesai.")


if __name__ == "__main__":
    import sys
    run_local_capture(source=sys.argv[1] if len(sys.argv) > 1 else 0)
