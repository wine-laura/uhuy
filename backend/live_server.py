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


def _inferensi_jendela(jendela, camera_type, fall_head, interaction_head) -> list:
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
    if camera_type != "lorong" and interaction_head is not None:
        x = torch.from_numpy(masukan["interaction_input"][-1:])
        proba = predict_proba(interaction_head, x)
        # Kelas 3,4,5 = hand_in_shelf, inspect_product, inspect_shelf
        skor = float(proba[0, 3:6].sum())
        if skor >= INSPECT_THRESH and is_dwell(raw, dwell_ratio=DWELL_THRESH):
            kejadian.append({
                "type": "event", "tipe": "butuh_bantuan",
                "track_id": jendela.track_id,
                "t0": t0, "t1": t1,
                "skor": round(skor, 3),
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
            })

            # Inferensi untuk jendela yang siap. Bagian berat dikerjakan di
            # thread executor; pengiriman hasil tetap di event loop ini.
            for jendela in buf.jendela_siap():
                try:
                    kejadian = await loop.run_in_executor(
                        None, _inferensi_jendela,
                        jendela, camera_type, fall_head, interaction_head,
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
