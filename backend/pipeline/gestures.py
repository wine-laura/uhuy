"""
pipeline/gestures.py — SAPA

Deteksi "angkat tangan minta bantuan" berbasis ATURAN, tanpa model & tanpa
dataset baru. Semua dihitung dari keypoint YOLOv8-pose + track_id ByteTrack
yang SUDAH ada di pipeline.

KENAPA ATURAN, BUKAN MODEL
--------------------------
Pose tangan terangkat pada "minta bantuan", "stretching", "meraih rak tinggi",
dan "tos dengan teman" itu MIRIP SEMUA — wrist berada di atas shoulder pada
keempatnya. Yang membedakan bukan pose, melainkan KONTEKS: berapa lama ditahan,
apakah diam atau bergerak, apakah sedang menyentuh rak. Konteks seperti itu bisa
ditulis eksplisit, jadi model hanya akan menebak apa yang sudah kita ketahui.

EMPAT SYARAT (harus terpenuhi SEKALIGUS, ditahan minimal `min_durasi` detik)
---------------------------------------------------------------------------
1. Tangan terangkat  — wrist di atas shoulder (y lebih kecil = lebih atas).
2. Ditahan & stabil  — perpindahan wrist antar-frame kecil.
3. Bukan meraih rak  — label interaksi bukan reach / hand_in_shelf.
4. Satu tangan saja  — dua tangan terangkat simetris = stretching / tos.

Tiap syarat menyaring satu kesalahan yang berbeda:

  STRETCHING       → disaring syarat 2 dan 4. Stretching regang lalu turun cepat
                     (tidak stabil), dan umumnya mengangkat KEDUA tangan.
  MERAIH RAK       → disaring syarat 3 (dan sering juga 2: tangan bergerak
                     menuju lalu menarik barang).
  TOS / HIGH-FIVE  → disaring syarat 2 dan 1. Tos adalah gerakan cepat
                     (ayun-sentuh-turun), tidak pernah ditahan 2-3 detik.
  MELAMBAI CEPAT   → disaring syarat 2. Melambai = wrist berosilasi, sedangkan
                     minta bantuan = tangan diangkat lalu DITAHAN.
  BENERIN RAMBUT   → disaring syarat 2 dan 5 (wrist terlalu dekat kepala).

Ambang semuanya KONFIGURASI, bukan hardcode — lihat DEFAULT di bawah dan
panel Setting di UI.
"""

import numpy as np

# ── Indeks COCO-17 ───────────────────────────────────────────────────────────
NOSE = 0
L_SHOULDER, R_SHOULDER = 5, 6
L_ELBOW, R_ELBOW       = 7, 8
L_WRIST, R_WRIST       = 9, 10
L_HIP, R_HIP           = 11, 12

# Label interaksi yang berarti "sedang berurusan dengan rak" — bukan minta bantuan
LABEL_RAK = ("reach", "hand_in_shelf", "retract")

# Ambang default. Semuanya bisa ditimpa lewat cfg / panel Setting.
DEFAULT = {
    # Durasi minimum tangan terangkat & stabil (detik). 2-3 detik menyaring
    # gerakan sesaat seperti tos dan melambai.
    "angkat_min_durasi": 2.5,
    # Perpindahan wrist maksimum antar-frame, dalam satuan panjang torso.
    # Dinormalisasi supaya tidak bergantung jarak orang ke kamera.
    "angkat_maks_gerak": 0.35,
    # Seberapa tinggi wrist harus di atas shoulder (satuan panjang torso).
    # Sedikit di atas 0 supaya tangan yang cuma sejajar bahu tidak terhitung.
    "angkat_min_tinggi": 0.15,
    # Jarak minimum wrist ke hidung (satuan panjang torso) — menyaring tangan
    # yang menyentuh kepala (benerin rambut, memegang topi).
    "angkat_min_jarak_kepala": 0.45,
    # Tolak bila KEDUA tangan terangkat (stretching / tos / regangan dua tangan).
    "angkat_tolak_dua_tangan": True,
    # Minimal confidence keypoint agar wrist/shoulder dianggap terlihat.
    "angkat_min_conf": 0.30,
}


def _torso_len(kp: np.ndarray) -> float:
    """Panjang torso satu frame (piksel), sebagai satuan skala. Minimal 1.0."""
    sho = (kp[L_SHOULDER, :2] + kp[R_SHOULDER, :2]) / 2.0
    hip = (kp[L_HIP, :2] + kp[R_HIP, :2]) / 2.0
    return max(float(np.linalg.norm(sho - hip)), 1.0)


def _status_satu_frame(kp: np.ndarray, cfg: dict) -> dict:
    """
    Evaluasi syarat "tangan terangkat" pada SATU frame.

    Returns dict:
      terangkat   : bool  — ada tepat satu tangan terangkat yang sah
      dua_tangan  : bool  — kedua tangan terangkat (stretching/tos)
      wrist       : np.ndarray [2] | None — posisi wrist yang terangkat
      sisi        : 'kiri' | 'kanan' | None
    """
    min_conf   = float(cfg.get("angkat_min_conf",        DEFAULT["angkat_min_conf"]))
    min_tinggi = float(cfg.get("angkat_min_tinggi",      DEFAULT["angkat_min_tinggi"]))
    min_kepala = float(cfg.get("angkat_min_jarak_kepala",DEFAULT["angkat_min_jarak_kepala"]))

    skala = _torso_len(kp)
    hasil = {"terangkat": False, "dua_tangan": False, "wrist": None, "sisi": None}

    naik = []
    for sisi, w_i, s_i in (("kiri", L_WRIST, L_SHOULDER), ("kanan", R_WRIST, R_SHOULDER)):
        if kp[w_i, 2] < min_conf or kp[s_i, 2] < min_conf:
            continue

        # y makin KECIL = makin ATAS di koordinat gambar.
        tinggi = (kp[s_i, 1] - kp[w_i, 1]) / skala
        if tinggi < min_tinggi:
            continue

        # Tangan menyentuh/dekat kepala → benerin rambut, bukan minta bantuan.
        if kp[NOSE, 2] >= min_conf:
            jarak_kepala = float(np.linalg.norm(kp[w_i, :2] - kp[NOSE, :2])) / skala
            if jarak_kepala < min_kepala:
                continue

        naik.append((sisi, kp[w_i, :2].copy()))

    if len(naik) >= 2:
        # Dua tangan terangkat. Stretching dan tos hampir selalu begini,
        # sedangkan minta bantuan lazimnya satu tangan.
        hasil["dua_tangan"] = True
        if not bool(cfg.get("angkat_tolak_dua_tangan", DEFAULT["angkat_tolak_dua_tangan"])):
            hasil["terangkat"] = True
            hasil["sisi"], hasil["wrist"] = naik[0]
        return hasil

    if len(naik) == 1:
        hasil["terangkat"] = True
        hasil["sisi"], hasil["wrist"] = naik[0]

    return hasil


def deteksi_angkat_tangan(
    frames: list,
    src_fps: float,
    cfg: dict,
    label_per_frame: dict | None = None,
) -> list:
    """
    Cari kejadian "angkat tangan minta bantuan" pada satu track.

    frames          : list [(frame_idx, kps[17,3])] koordinat piksel MENTAH
    src_fps         : fps video asli — untuk mengubah jumlah frame ke detik
    cfg             : ambang (lihat DEFAULT)
    label_per_frame : {frame_idx: label_interaksi} untuk syarat 3. Bila None,
                      syarat "bukan meraih rak" dilewati (mis. kepala interaksi
                      tidak aktif untuk kamera lorong).

    Returns: list kejadian [{t0, t1, durasi, sisi, kestabilan}]
    """
    if len(frames) < 2 or src_fps <= 0:
        return []

    min_durasi = float(cfg.get("angkat_min_durasi", DEFAULT["angkat_min_durasi"]))
    maks_gerak = float(cfg.get("angkat_maks_gerak", DEFAULT["angkat_maks_gerak"]))

    kejadian: list = []

    # Akumulator satu rentetan (run) frame yang memenuhi semua syarat
    run_mulai: int | None = None   # frame_idx awal
    run_akhir: int | None = None
    run_sisi: str | None  = None
    wrist_sebelum: np.ndarray | None = None
    gerak_maks = 0.0

    def tutup_run():
        """Tutup run yang sedang jalan; catat jadi kejadian bila cukup lama."""
        nonlocal run_mulai, run_akhir, run_sisi, wrist_sebelum, gerak_maks
        if run_mulai is not None and run_akhir is not None:
            durasi = (run_akhir - run_mulai) / src_fps
            if durasi >= min_durasi:
                kejadian.append({
                    "t0": run_mulai / src_fps,
                    "t1": run_akhir / src_fps,
                    "durasi": durasi,
                    "sisi": run_sisi,
                    "kestabilan": round(gerak_maks, 3),
                })
        run_mulai = run_akhir = run_sisi = None
        wrist_sebelum = None
        gerak_maks = 0.0

    for fidx, kp in frames:
        st = _status_satu_frame(kp, cfg)

        # Syarat 3: sedang berurusan dengan rak → bukan minta bantuan.
        sedang_di_rak = False
        if label_per_frame is not None:
            sedang_di_rak = label_per_frame.get(fidx) in LABEL_RAK

        if not st["terangkat"] or sedang_di_rak:
            tutup_run()
            continue

        skala = _torso_len(kp)

        # Syarat 2: stabil. Wrist yang berpindah jauh antar-frame berarti
        # melambai, mengayun, atau menarik barang — bukan tangan yang ditahan.
        if wrist_sebelum is not None:
            gerak = float(np.linalg.norm(st["wrist"] - wrist_sebelum)) / skala
            if gerak > maks_gerak:
                tutup_run()
                # Frame ini tetap sah sebagai AWAL run baru: tangannya memang
                # terangkat, hanya perpindahan dari frame sebelumnya yang besar.
                run_mulai, run_akhir, run_sisi = fidx, fidx, st["sisi"]
                wrist_sebelum = st["wrist"]
                gerak_maks = 0.0
                continue
            gerak_maks = max(gerak_maks, gerak)

        # Sisi tangan berganti → anggap gerakan baru.
        if run_sisi is not None and st["sisi"] != run_sisi:
            tutup_run()

        if run_mulai is None:
            run_mulai, run_sisi, gerak_maks = fidx, st["sisi"], 0.0
        run_akhir = fidx
        wrist_sebelum = st["wrist"]

    tutup_run()
    return kejadian
