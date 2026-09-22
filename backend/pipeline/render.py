"""
pipeline/render.py — SAPA

Render video beranotasi menggunakan OpenCV.
Overlay: kerangka sendi (bukan wajah) + ID orang + label aksi + banner kejadian.

Prinsip privacy-by-design: hanya kerangka yang ditampilkan, wajah tidak diblur
tapi TIDAK dijadikan fokus overlay — kerangka yang mencolok.
"""

import cv2
import numpy as np
import subprocess
import os
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# ── Koneksi kerangka COCO-17 ──────────────────────────────────────────────────
COCO_SKELETON = [
    (0, 1), (0, 2),           # hidung ke mata
    (1, 3), (2, 4),           # mata ke telinga
    (5, 6),                   # bahu kiri-kanan
    (5, 7), (7, 9),           # lengan kiri
    (6, 8), (8, 10),          # lengan kanan
    (5, 11), (6, 12),         # torso samping
    (11, 12),                 # pinggul
    (11, 13), (13, 15),       # kaki kiri
    (12, 14), (14, 16),       # kaki kanan
]

# Skeleton khusus kamera top-down (atas/rak) — hanya koneksi utama yang masuk akal
# dari pandangan atas. Lengan & kaki tidak digambar karena bercabang membingungkan.
COCO_SKELETON_TOPDOWN = [
    (5, 6),   # garis bahu (kiri–kanan)
    (11, 12), # garis pinggul
    (5, 11),  # sisi kiri torso
    (6, 12),  # sisi kanan torso
    # Lengan — hanya satu segmen agar tidak double-angle
    (5, 7),   # lengan atas kiri
    (6, 8),   # lengan atas kanan
    (7, 9),   # lengan bawah kiri
    (8, 10),  # lengan bawah kanan
]

# Bagian tubuh yang dipilah untuk warna gradient (opsional estetika)
_UPPER_JOINTS = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
_LOWER_JOINTS = {11, 12, 13, 14, 15, 16}

# ── Palet warna BGR ───────────────────────────────────────────────────────────
COLOR_NORMAL = (80, 180, 80)      # Hijau  — gerakan normal biasa
COLOR_FALL   = (40,  40, 210)     # Merah  — deteksi jatuh
COLOR_HELP   = (30, 140, 240)     # Oranye — tampak butuh bantuan (sinyal pasif)
COLOR_ANGKAT = (200, 60, 200)     # Ungu   — angkat tangan (permintaan eksplisit)
COLOR_PEGAWAI= (150, 150, 150)    # Abu    — dikenali pegawai (bukan pelanggan)
COLOR_WHITE  = (255, 255, 255)
COLOR_BLACK  = (0,   0,   0)
CONF_THRESHOLD = 0.3              # minimum confidence untuk menggambar sendi


def _get_person_color(events_active: list, pegawai: bool = False) -> tuple:
    """
    Pilih warna kerangka berdasarkan kejadian aktif.

    Urutan prioritas disengaja: JATUH selalu menang, termasuk bagi pegawai —
    pegawai yang jatuh tetap keadaan darurat. Warna pegawai hanya dipakai saat
    tidak ada kejadian apa pun.
    """
    if any(e["tipe"] == "jatuh" for e in events_active):
        return COLOR_FALL
    # Angkat tangan (sinyal aktif) dibedakan dari dwell (pasif) supaya saat
    # demo terlihat sistem memisahkan permintaan eksplisit.
    if any(e["tipe"] == "butuh_bantuan" and e.get("sinyal") == "aktif"
           for e in events_active):
        return COLOR_ANGKAT
    if any(e["tipe"] == "butuh_bantuan" for e in events_active):
        return COLOR_HELP
    if pegawai:
        return COLOR_PEGAWAI
    return COLOR_NORMAL


def _draw_skeleton(frame: np.ndarray, keypoints: np.ndarray, color: tuple,
                   thickness: int = 2, topdown: bool = False):
    """
    Gambar kerangka sendi pada frame.

    topdown=True  → gunakan COCO_SKELETON_TOPDOWN (kamera atas/rak),
                    hanya tampilkan koneksi torso + lengan atas.
    topdown=False → gunakan COCO_SKELETON penuh (kamera samping/lorong).
    """
    h, w = frame.shape[:2]
    edges = COCO_SKELETON_TOPDOWN if topdown else COCO_SKELETON

    # Gambar garis penghubung sendi
    for j1, j2 in edges:
        x1, y1, c1 = keypoints[j1]
        x2, y2, c2 = keypoints[j2]
        if c1 > CONF_THRESHOLD and c2 > CONF_THRESHOLD:
            pt1 = (int(np.clip(x1, 0, w - 1)), int(np.clip(y1, 0, h - 1)))
            pt2 = (int(np.clip(x2, 0, w - 1)), int(np.clip(y2, 0, h - 1)))
            cv2.line(frame, pt1, pt2, color, thickness, cv2.LINE_AA)

    # Gambar titik sendi
    # Top-down: titik besar + ring tebal agar terlihat dari atas
    for j in range(17):
        x, y, c = keypoints[j]
        if c > CONF_THRESHOLD:
            cx = int(np.clip(x, 0, w - 1))
            cy = int(np.clip(y, 0, h - 1))
            r = (7 if j in _UPPER_JOINTS else 6) if topdown else (5 if j in _UPPER_JOINTS else 4)
            cv2.circle(frame, (cx, cy), r,     color,       -1, cv2.LINE_AA)
            cv2.circle(frame, (cx, cy), r + 1, COLOR_BLACK,  1, cv2.LINE_AA)


def _draw_label(frame: np.ndarray, text: str, x: int, y: int, color: tuple):
    """Gambar label teks dengan background gelap — mudah dibaca."""
    font      = cv2.FONT_HERSHEY_SIMPLEX   # lebih tebal dari DUPLEX
    scale     = 0.55
    thickness = 2
    (tw, th), baseline = cv2.getTextSize(text, font, scale, thickness)
    pad = 5
    # Background kotak dengan padding lebih besar
    cv2.rectangle(
        frame,
        (x - pad, y - th - pad),
        (x + tw + pad, y + baseline + pad),
        (0, 0, 0), -1
    )
    # Opsional: border tipis berwarna agar lebih menonjol
    cv2.rectangle(
        frame,
        (x - pad, y - th - pad),
        (x + tw + pad, y + baseline + pad),
        color, 1
    )
    cv2.putText(frame, text, (x, y), font, scale, COLOR_WHITE, thickness, cv2.LINE_AA)


def _draw_event_banner(frame: np.ndarray, events_active: list):
    """
    Gambar banner kejadian di bagian atas frame (semi-transparan).
    """
    h, w = frame.shape[:2]
    y_offset = 0
    overlay = frame.copy()

    for event in events_active:
        if event["tipe"] == "jatuh":
            banner_color = (40, 40, 200)
            icon = "!!! JATUH TERDETEKSI"
            skor = event.get("skor", 0.0)
            text = f"{icon}  (skor: {skor:.2f})"
        else:
            banner_color = (20, 120, 240)
            icon = "BUTUH BANTUAN"
            text = f"{icon}  (ID: {event['track_id']})"

        cv2.rectangle(overlay, (0, y_offset), (w, y_offset + 48), banner_color, -1)
        cv2.addWeighted(overlay, 0.75, frame, 0.25, 0, frame)
        overlay = frame.copy()

        cv2.putText(
            frame, text,
            (16, y_offset + 32),
            cv2.FONT_HERSHEY_DUPLEX, 0.85,
            COLOR_WHITE, 2, cv2.LINE_AA
        )
        y_offset += 52


def render(video_path: str, analysis_result: dict, output_path: str,
           camera_type: str = "lorong"):
    """
    Render video beranotasi dari hasil analyze().

    video_path: video asli
    analysis_result: dict dari analyze() — berisi frame_annotations + timeline
    output_path: path output .mp4
    camera_type: 'rak' → gunakan skeleton top-down (tanpa kaki/lengan penuh)
    """
    topdown = (camera_type == "rak")
    frame_annotations = analysis_result.get("frame_annotations", {})
    timeline = analysis_result.get("timeline", [])
    src_fps = analysis_result.get("src_fps", 30.0)

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise ValueError(f"Tidak bisa membuka video untuk render: {video_path}")

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or src_fps
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # Coba codec H.264 (avc1) agar langsung bisa diputar browser tanpa ffmpeg
    # Fallback ke mp4v jika avc1 tidak didukung platform ini
    temp_path = str(output_path) + ".tmp.mp4"
    fourcc_h264 = cv2.VideoWriter_fourcc(*"avc1")
    out = cv2.VideoWriter(temp_path, fourcc_h264, fps, (width, height))

    if not out.isOpened():
        # Fallback ke mp4v, akan di-re-encode ffmpeg setelahnya
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        out = cv2.VideoWriter(temp_path, fourcc, fps, (width, height))

    if not out.isOpened():
        cap.release()
        raise RuntimeError("VideoWriter gagal dibuka. Periksa path output dan codec.")


    logger.info(f"Merender {total} frame ke {Path(output_path).name}...")

    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        current_time = frame_idx / fps

        # Cari kejadian yang aktif di waktu ini
        events_active = [
            e for e in timeline
            if e["t0"] <= current_time <= e["t1"]
        ]

        # Gambar kerangka tiap orang
        if frame_idx in frame_annotations:
            for ann in frame_annotations[frame_idx]:
                track_id = ann["track_id"]
                kps = ann["keypoints"]  # [17, 3]
                action = ann["action_label"]

                # Cek apakah track ini sedang dalam kejadian
                person_events = [e for e in events_active if e["track_id"] == track_id]
                pegawai = bool(ann.get("pegawai", False))
                color = _get_person_color(person_events, pegawai)

                # Gambar kerangka
                _draw_skeleton(frame, kps, color,
                               thickness=3 if person_events else 2,
                               topdown=topdown)

                # Label: ID + status mudah dibaca (di atas kepala)
                nose_x, nose_y, nose_c = kps[0]
                # Fallback: gunakan bahu jika hidung tidak terdeteksi
                if nose_c <= CONF_THRESHOLD:
                    sh_x = (kps[5][0] + kps[6][0]) / 2
                    sh_y = (kps[5][1] + kps[6][1]) / 2
                    nose_x, nose_y = sh_x, sh_y
                    nose_c = min(kps[5][2], kps[6][2])

                if nose_c > CONF_THRESHOLD:
                    # Teks status yang mudah dimengerti
                    if any(e["tipe"] == "jatuh" for e in person_events):
                        status_txt = "JATUH!"
                    elif any(e["tipe"] == "butuh_bantuan" and e.get("sinyal") == "aktif"
                             for e in person_events):
                        status_txt = "ANGKAT TANGAN"
                    elif any(e["tipe"] == "butuh_bantuan" for e in person_events):
                        status_txt = "BUTUH BANTUAN"
                    elif pegawai:
                        status_txt = "Pegawai"
                    else:
                        status_txt = "Normal"
                    prefix = "PEGAWAI " if pegawai else ""
                    label = f"{prefix}ID:{track_id}  {status_txt}"
                    lx = max(int(nose_x) - 40, 4)
                    ly = max(int(nose_y) - 18, 20)
                    _draw_label(frame, label, lx, ly, color)

        # Banner kejadian
        if events_active:
            _draw_event_banner(frame, events_active)

        # Watermark sudut kiri bawah
        cv2.putText(
            frame, "SAPA | Analitik Pose (Privacy-by-Design)",
            (8, height - 10), cv2.FONT_HERSHEY_SIMPLEX,
            0.4, (160, 160, 160), 1, cv2.LINE_AA
        )

        out.write(frame)
        frame_idx += 1

    cap.release()
    out.release()

    # Re-encode ke H.264 agar bisa diputar browser
    _reencode_h264(temp_path, output_path)

    logger.info(f"Render selesai: {output_path}")


def _reencode_h264(temp_path: str, output_path: str):
    """
    Re-encode video dari mp4v ke H.264 menggunakan ffmpeg.
    ffmpeg dipasang di Docker image.
    Fallback: rename saja jika ffmpeg tidak tersedia.
    """
    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", temp_path,
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", "23",
                "-movflags", "+faststart",
                output_path,
            ],
            capture_output=True,
            timeout=300,
        )
        if result.returncode != 0:
            logger.warning(f"ffmpeg gagal, menggunakan file temp langsung. Stderr: {result.stderr[-500:]}")
            os.rename(temp_path, output_path)
        else:
            os.remove(temp_path)
    except FileNotFoundError:
        # ffmpeg tidak tersedia (dev lokal tanpa Docker)
        logger.warning("ffmpeg tidak ditemukan. Video mungkin tidak bisa diputar di browser.")
        os.rename(temp_path, output_path)
    except subprocess.TimeoutExpired:
        logger.error("ffmpeg timeout.")
        if os.path.exists(temp_path):
            os.rename(temp_path, output_path)
