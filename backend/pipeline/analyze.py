"""
pipeline/analyze.py — SAPA

Orkestrasi inferensi end-to-end:
  extract → normalize → resample → window → infer → detect_events → timeline

Urutan pipeline wajib (sesuai spesifikasi):
  1. extract_poses()           → raw keypoints [T,17,3] per track
  2. build_windows_for_heads() → normalize → resample → window dalam satu panggilan
       ├── fall_input      [W,45,24]  (12 sendi × x,y — untuk Kepala Jatuh)
       ├── interaction_input [W,45,51] (17 sendi × x,y,conf — untuk Kepala Interaksi)
       └── raw_windows     [W,45,17,3] (koordinat MENTAH — untuk lapisan geometri)
  3. predict_proba()           → probabilitas per jendela
  4. Lapisan geometri          → sudut torso + kecepatan torso + dwell (is_dwell)
  5. Lapisan keputusan         → thresholds.is_fall() → timeline

Keputusan jatuh sengaja dipisah dari inferensi (lihat pipeline/thresholds.py):
fitur per jendela disimpan di "fall_cache" supaya ambang bisa diubah-ubah
lewat panel Setting tanpa mengulang ekstraksi pose.

PENTING: Geometri (torso_angle, is_dwell) SELALU menggunakan raw_windows,
         bukan yang sudah dinormalisasi.
"""

import numpy as np
import torch
import logging
from typing import Optional

from .extract import extract_poses
from .normalize import build_windows_for_heads
from .geometry import is_dwell, window_torso_angle, window_torso_speed, INTERACTION_CLASS_NAMES
from .models import predict_proba, BiLSTMHead
from . import thresholds as TH
from . import uniform as UNI
from .gestures import deteksi_angkat_tangan

logger = logging.getLogger(__name__)

# Indeks kelas jatuh di output Kepala Jatuh (0=normal, 1=oleng, 2=jatuh)
_FALL_CLASS_IDX = 2


def _compute_window_times(frame_indices: np.ndarray, src_fps: float,
                           W: int, window: int, stride: int, dst_fps: float) -> list:
    """
    Hitung pasangan (t0, t1) dalam detik untuk setiap jendela.

    Strategi: petakan posisi jendela di ruang resampled kembali ke detik nyata.
    """
    t_start = float(frame_indices[0]) / src_fps
    t_end = float(frame_indices[-1]) / src_fps

    times = []
    for w in range(W):
        wt0 = t_start + (w * stride) / dst_fps
        wt1 = t_start + (w * stride + window) / dst_fps
        # Klem ke rentang track yang sebenarnya ada
        wt1 = min(wt1, t_end + (window / dst_fps))
        times.append((float(wt0), float(wt1)))
    return times


def analyze(
    video_path: str,
    cfg: dict,
    fall_model: Optional[BiLSTMHead] = None,
    inter_model: Optional[BiLSTMHead] = None,
    camera_type: str = "both",
) -> dict:
    """
    Analisis penuh satu klip video.

    camera_type: 'lorong' | 'rak' | 'both'
      - 'rak'    → kamera top-down (atas rak) — fall detection DIMATIKAN karena
                    sudut torso selalu ≈90° dari atas, pasti false positive.
      - 'lorong' → kamera samping lorong — fall detection AKTIF, interaction OFF.
      - 'both'   → kedua kepala aktif.
    """
    # 1. Ekstraksi pose per track (filter false positive berdasarkan camera_type)
    tracks = extract_poses(video_path, cfg, camera_type=camera_type)

    if not tracks:
        logger.warning("Tidak ada track valid ditemukan di video.")
        return {"timeline": [], "frame_annotations": {}, "src_fps": 30.0,
                "total_frames": 0, "fall_cache": [], "ambang_dipakai": {}}

    first = next(iter(tracks.values()))
    src_fps = first["fps"]
    total_frames = first["total_frames"]

    # Parameter dari cfg
    dst_fps     = float(cfg.get("target_fps", 15))
    window_size = int(cfg.get("window", 45))
    stride      = int(cfg.get("stride", 15))
    # camera_type menentukan kepala mana yang aktif
    # Jangan batasi berdasar camera_type — selalu jalankan semua model yang ada.
    # camera_type hanya mematikan FALL untuk kamera rak (false positive kamera atas).
    run_fall    = bool(cfg.get("run_fall", True))
    run_inter   = bool(cfg.get("run_interaction", True))
    # Untuk kamera rak (top-down), jatuh hampir selalu false positive — nonaktifkan
    if camera_type == "rak":
        run_fall = False
        logger.info("camera_type='rak' → deteksi jatuh DIMATIKAN (kamera top-down).")
    # Ambang keputusan jatuh — default dari hasil sweep (pipeline/thresholds.py).
    # fall_confirm dipertahankan demi kompatibilitas: False = matikan syarat
    # geometri, setara menyetel sudut & kecepatan ke 0.
    fall_confirm= bool(cfg.get("fall_confirm", True))
    fall_thr    = float(cfg.get("fall_thr",   TH.FALL_THR_DEFAULT))
    fall_ang    = float(cfg.get("fall_angle", TH.FALL_ANGLE_DEFAULT))
    fall_spd    = float(cfg.get("fall_speed", TH.FALL_SPEED_DEFAULT))
    if not fall_confirm:
        fall_ang, fall_spd = 0.0, 0.0
    # MERL label (dari geometry.py INTERACTION_CLASS_NAMES):
    # 0=background, 1=reach, 2=retract, 3=hand_in_shelf, 4=inspect_product, 5=inspect_shelf
    # Default [4, 5] mengikuti INSPECT_IDX di Kepala Interaksi.ipynb — hanya
    # "menimbang produk" dan "memandangi rak" yang menandakan butuh bantuan.
    inspect_idx = list(cfg.get("inspect_idx", [4, 5]))
    help_min_win= int(cfg.get("help_min_win", 2))
    # dwell_ratio berbeda untuk top-down vs samping:
    # top-down: torso_length sangat kecil karena kompresi perspektif → pakai nilai besar
    # samping: gunakan default kecil
    if camera_type == "rak":
        dwell_ratio = float(cfg.get("dwell_ratio", 3.0))   # besar = toleran — top-down
    else:
        dwell_ratio = float(cfg.get("dwell_ratio", 0.4))
    # Untuk kamera rak, is_dwell tidak diandalkan (YOLO top-down tidak akurat di pinggul)
    # → skip dwell check sepenuhnya untuk kamera rak
    skip_dwell = (camera_type == "rak")

    # ── Tandai pegawai dari sidik seragam (sekali, sebelum loop track) ───────
    # CAKUPAN PENTING: tanda pegawai HANYA mengecualikan dari BUTUH BANTUAN.
    # Deteksi jatuh tidak pernah melihat tanda ini — pegawai yang jatuh tetap
    # keadaan darurat dan harus selalu muncul di timeline.
    seragam_aktif = bool(cfg.get("seragam_aktif", False))
    status_pegawai: dict = {}
    if seragam_aktif:
        daftar_seragam = cfg.get("daftar_seragam") or []
        kandidat = {
            tid: tdata.get("uniform_sigs", [])
            for tid, tdata in tracks.items()
        }
        status_pegawai = UNI.tandai_pegawai(kandidat, daftar_seragam, cfg)
        n_peg = sum(1 for v in status_pegawai.values() if v["pegawai"])
        logger.info(
            f"Seragam: {n_peg} dari {len(tracks)} track dikenali pegawai "
            f"(dikecualikan dari butuh-bantuan, TETAP dicek untuk jatuh)."
        )

    timeline: list = []
    frame_annotations: dict = {}
    # Cache fitur per jendela — dipakai endpoint /rethreshold agar percobaan
    # ambang tidak perlu mengekstrak pose ulang (bagian paling lambat).
    fall_cache: list = []

    for track_id, tdata in tracks.items():
        frames = tdata["frames"]   # [(frame_idx, kps[17,3])]
        if len(frames) < 2:
            continue

        frame_indices = np.array([f[0] for f in frames])
        raw_seq = np.array([f[1] for f in frames], dtype=np.float32)  # [T,17,3]

        # 2. Pipeline normalisasi → jendela (satu panggilan)
        head_inputs = build_windows_for_heads(
            raw_seq, src_fps,
            window=window_size, stride=stride, dst_fps=dst_fps,
        )
        fall_input   = head_inputs["fall_input"]        # [W,45,24]
        inter_input  = head_inputs["interaction_input"] # [W,45,51]
        raw_windows  = head_inputs["raw_windows"]       # [W,45,17,3]
        W = raw_windows.shape[0]

        # Timestamp per jendela
        window_times = _compute_window_times(frame_indices, src_fps, W, window_size, stride, dst_fps)

        # 3a. Inferensi Kepala Jatuh
        fall_probs = None
        if run_fall and fall_model is not None:
            t = torch.from_numpy(fall_input)            # [W,45,24]
            fall_probs = predict_proba(fall_model, t).cpu().numpy()  # [W,3]

        # 3b. Inferensi Kepala Interaksi
        inter_probs = None
        if run_inter and inter_model is not None:
            t = torch.from_numpy(inter_input)           # [W,45,51]
            inter_probs = predict_proba(inter_model, t).cpu().numpy()  # [W,6]

        # 4. Peta label aksi ke frame asli (untuk rendering)
        # Setiap jendela w mencakup resampled frame [w*stride, w*stride+window)
        # Petakan balik ke frame indeks asli via timestamp
        T_orig = len(frames)
        t_start = float(frame_indices[0]) / src_fps

        window_action_for_resamp: dict = {}   # {resamp_idx: label}
        if inter_probs is not None:
            for w in range(W):
                act_idx = int(np.argmax(inter_probs[w]))
                label = INTERACTION_CLASS_NAMES[act_idx]
                for ri in range(w * stride, min(w * stride + window_size,
                                                 int((float(frame_indices[-1]) / src_fps - t_start) * dst_fps) + 1)):
                    window_action_for_resamp[ri] = label

        # Label aksi per frame UNTUK TRACK INI — dipakai blok 5c (angkat
        # tangan) sebagai syarat "bukan sedang meraih rak". Dibangun di sini
        # karena di sinilah label per frame track ini memang dihitung.
        label_track: dict = {}

        for orig_i, (fidx, kps) in enumerate(frames):
            t_rel = (float(fidx) / src_fps) - t_start
            ri = min(int(round(t_rel * dst_fps)), max(window_action_for_resamp.keys(), default=0))
            action = window_action_for_resamp.get(ri, "background")
            if inter_probs is not None:
                label_track[fidx] = action

            frame_annotations.setdefault(fidx, []).append({
                "track_id": int(track_id),
                "keypoints": kps,
                "action_label": action,
                "pegawai": bool(status_pegawai.get(track_id, {}).get("pegawai", False)),
            })

        # 5a. Deteksi kejadian JATUH
        # Fitur tiap jendela (prob, sudut, kecepatan) dihitung SEKALI dan
        # disimpan di fall_cache; keputusannya sendiri murni perbandingan
        # ambang, jadi bisa diulang cepat tanpa menyentuh video lagi.
        if fall_probs is not None:
            for w, (wt0, wt1) in enumerate(window_times):
                prob  = float(fall_probs[w, _FALL_CLASS_IDX])
                angle = window_torso_angle(raw_windows[w])
                speed = window_torso_speed(raw_windows[w], fps=dst_fps)

                fall_cache.append({
                    "track_id": int(track_id),
                    "t0": float(wt0), "t1": float(wt1),
                    "prob": prob, "sudut_torso": angle, "kecepatan": speed,
                })

                if TH.is_fall(prob, angle, speed, fall_thr, fall_ang, fall_spd):
                    timeline.append({
                        "tipe": "jatuh",
                        "t0": wt0,
                        "t1": wt1,
                        "skor": prob,
                        "sudut_torso": angle,
                        "kecepatan": speed,
                        "track_id": int(track_id),
                    })

        # Apakah track ini pegawai? Dipakai HANYA di 5b & 5c (butuh bantuan).
        # Blok 5a (jatuh) di atas sengaja tidak memeriksanya.
        ini_pegawai = bool(status_pegawai.get(track_id, {}).get("pegawai", False))

        # 5c. Deteksi ANGKAT TANGAN minta bantuan (rule-based, lihat gestures.py)
        # Ini sinyal AKTIF: pelanggan meminta secara eksplisit, jadi diberi
        # prioritas lebih tinggi daripada sinyal pasif dwell+inspect di 5b.
        if bool(cfg.get("angkat_aktif", True)) and not ini_pegawai:
            # label_track kosong bila kepala interaksi tidak aktif (mis. kamera
            # lorong); kirim None supaya syarat "bukan meraih rak" dilewati,
            # bukan dianggap selalu terpenuhi.
            label_map = label_track or None

            for ev in deteksi_angkat_tangan(frames, src_fps, cfg, label_map):
                timeline.append({
                    "tipe": "butuh_bantuan",
                    "sinyal": "aktif",           # angkat tangan = permintaan eksplisit
                    "t0": ev["t0"],
                    "t1": ev["t1"],
                    "durasi": round(ev["durasi"], 2),
                    "sisi_tangan": ev["sisi"],
                    "skor": 1.0,                 # aturan: terpenuhi atau tidak
                    "track_id": int(track_id),
                })

        # 5b. Deteksi kejadian BUTUH BANTUAN (sinyal PASIF: dwell + inspect)
        if inter_probs is not None and not ini_pegawai:
            run_count, run_t0, run_t1 = 0, None, None
            best_prob = 0.0

            # Debug: log distribusi probabilitas semua kelas per jendela
            logger.info(f"Track {track_id} — {W} jendela, inspect_idx={inspect_idx}, dwell_ratio={dwell_ratio}")
            for w in range(min(W, 5)):  # log 5 jendela pertama saja
                probs_str = " ".join(f"{v:.2f}" for v in inter_probs[w])
                logger.info(f"  w={w}: probs=[{probs_str}], "
                            f"inspect_sum={sum(inter_probs[w,i] for i in inspect_idx):.3f}, "
                            f"is_dwell={is_dwell(raw_windows[w], dwell_ratio)}")

            for w, (wt0, wt1) in enumerate(window_times):
                inspect_prob = float(sum(inter_probs[w, i] for i in inspect_idx))
                stationary   = skip_dwell or is_dwell(raw_windows[w], dwell_ratio)

                # Kelas prediksi harus BENAR-BENAR salah satu kelas inspect,
                # sesuai Kepala Interaksi.ipynb:
                #     browsing = np.isin(act_pred, INSPECT_IDX) & (dwell < ...)
                #
                # Versi sebelumnya memakai jumlah probabilitas dengan ambang
                # 0,30 untuk kamera rak. Aturan itu jauh lebih longgar: pada
                # klip CCTV top-down 129 detik, ia menandai 62% dari seluruh
                # jendela sebagai "butuh bantuan", sementara aturan argmax
                # menandai 38%. Ambang jumlah juga memperkenalkan angka sihir
                # yang tidak pernah divalidasi tim, sedangkan argmax langsung
                # memakai keputusan model.
                inspect_aktif = int(np.argmax(inter_probs[w])) in inspect_idx

                if skip_dwell:
                    # Kamera rak (top-down): is_dwell tidak dapat diandalkan
                    # karena torso terkompresi perspektif, jadi dilewati.
                    active = inspect_aktif
                else:
                    active = inspect_aktif and stationary

                if active:
                    if run_count == 0:
                        run_t0 = wt0
                    run_count += 1
                    run_t1 = wt1
                    best_prob = max(best_prob, inspect_prob)
                else:
                    if run_count >= help_min_win:
                        timeline.append({
                            "tipe": "butuh_bantuan",
                            "sinyal": "pasif",   # dwell + inspect, bukan permintaan eksplisit
                            "t0": float(run_t0),
                            "t1": float(run_t1),
                            "durasi_window": run_count,
                            "skor": round(best_prob, 3),
                            "track_id": int(track_id),
                        })
                    run_count, run_t0, run_t1, best_prob = 0, None, None, 0.0

            # Flush run yang masih jalan di akhir sekuens
            if run_count >= help_min_win:
                timeline.append({
                    "tipe": "butuh_bantuan",
                    "sinyal": "pasif",
                    "t0": float(run_t0),
                    "t1": float(run_t1),
                    "durasi_window": run_count,
                    "skor": round(best_prob, 3),
                    "track_id": int(track_id),
                })

        logger.debug(f"Track {track_id}: {T_orig} frame → {W} jendela diproses.")


    timeline.sort(key=lambda x: x["t0"])

    n_jatuh  = sum(1 for e in timeline if e["tipe"] == "jatuh")
    n_bantu  = sum(1 for e in timeline if e["tipe"] == "butuh_bantuan")
    logger.info(f"Analisis selesai: {n_jatuh} jatuh, {n_bantu} butuh_bantuan dari {len(tracks)} track.")

    return {
        "timeline": timeline,
        "frame_annotations": frame_annotations,
        "src_fps": src_fps,
        "total_frames": total_frames,
        # Fitur per jendela untuk percobaan ambang tanpa ekstraksi pose ulang
        "fall_cache": fall_cache,
        "ambang_dipakai": {
            "fall_thr": fall_thr, "fall_angle": fall_ang, "fall_speed": fall_spd,
        },
    }
