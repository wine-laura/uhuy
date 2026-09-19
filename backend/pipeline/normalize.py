"""
pipeline/normalize.py — SAPA

Normalisasi pose sesuai training multi-angle (train_fall_threshold_sweep_v2.py CELL 2):
  - origin  = titik tengah pinggul FRAME PERTAMA (anchor tetap sepanjang window)
  - skala   = panjang torso FRAME PERTAMA, di-clip minimum 1e-3
  - fill_lowconf_frames(): ganti frame dengan keypoint hilang dari frame terdekat yang valid
  - resample_fps(): interpolasi linear temporal
  - make_windows(): sliding window dengan edge-padding jika terlalu pendek

Format keypoint COCO-17:
  0 nose, 1 l_eye, 2 r_eye, 3 l_ear, 4 r_ear,
  5 l_shoulder, 6 r_shoulder, 7 l_elbow, 8 r_elbow,
  9 l_wrist, 10 r_wrist, 11 l_hip, 12 r_hip,
  13 l_knee, 14 r_knee, 15 l_ankle, 16 r_ankle
"""

import numpy as np

# ── Indeks sendi COCO-17 ──────────────────────────────────────────────────────
L_SHOULDER, R_SHOULDER = 5, 6
L_HIP, R_HIP           = 11, 12

FALL_JOINTS = list(range(5, 17))   # 12 sendi badan (dikonfirmasi di fall_head.json)

# Sendi kunci untuk deteksi frame berkualitas rendah
_KEY_JOINTS = [L_HIP, R_HIP, L_SHOULDER, R_SHOULDER]


def fill_lowconf_frames(seq: np.ndarray, th: float = 0.2) -> np.ndarray:
    """
    Ganti frame yang sendi-sendi kuncinya di bawah threshold confidence
    dengan frame terdekat yang valid.

    seq: [T, 17, 3] — (x, y, confidence)
    th:  ambang minimum confidence untuk 4 sendi kunci (hip + shoulder)

    Sesuai inference.py Cell 3 Line 124-131.
    """
    valid = (seq[:, _KEY_JOINTS, 2] > th).all(axis=1)   # [T] bool
    if valid.all() or valid.sum() == 0:
        return seq

    seq = seq.copy()
    idx  = np.arange(len(seq))
    good = idx[valid]

    for t in idx[~valid]:
        nearest = good[np.argmin(np.abs(good - t))]
        seq[t] = seq[nearest]

    return seq


def normalize_pose(seq: np.ndarray) -> np.ndarray:
    """
    Normalisasi pose dengan ANCHOR FRAME PERTAMA (sesuai kode training
    multi-angle, train_fall_threshold_sweep_v2.py CELL 2):
      - origin = titik tengah pinggul pada frame PERTAMA
      - skala  = panjang torso pada frame PERTAMA, clip minimum 1e-3
      - confidence tidak diubah

    KENAPA BUKAN PER-FRAME (ini sumber bug lama):
    Versi sebelumnya memusatkan SETIAP frame ke pinggulnya masing-masing.
    Akibatnya pinggul selalu berada di (0,0) di semua frame, sehingga
    perpindahan badan antar-frame — justru sinyal utama sebuah kejatuhan —
    ikut terhapus dari input model. Model hanya melihat perubahan postur
    relatif, bukan tubuh yang turun. Dengan anchor frame pertama, gerakan
    jatuh tetap terlihat sebagai pergeseran terhadap posisi awal.

    seq: [T, 17, 3]  (x, y, confidence) koordinat piksel mentah
    return: [T, 17, 3] dinormalisasi
    """
    seq = seq.copy().astype(np.float32)
    xy   = seq[:, :, :2]        # [T, 17, 2]
    conf = seq[:, :, 2:3]       # [T, 17, 1]

    # Titik tengah pinggul & bahu pada FRAME PERTAMA saja: [2]
    hip0 = (xy[0, L_HIP] + xy[0, R_HIP]) / 2.0
    sho0 = (xy[0, L_SHOULDER] + xy[0, R_SHOULDER]) / 2.0

    # Panjang torso frame pertama — skalar, clip min 1e-3
    torso0 = float(np.linalg.norm(sho0 - hip0))
    torso0 = max(torso0, 1e-3)

    # Translate ke hip frame pertama, skala tunggal untuk seluruh sekuens
    xy_norm = (xy - hip0[None, None, :]) / torso0

    return np.concatenate([xy_norm, conf], axis=-1)


def resample_fps(seq: np.ndarray, src_fps: float, dst_fps: float = 15.0) -> np.ndarray:
    """
    Resample urutan temporal dari src_fps ke dst_fps via interpolasi linear.

    seq: [T, 17, C]
    Sesuai inference.py Cell 3 Line 108-114.
    """
    T = seq.shape[0]
    if T < 2 or abs(src_fps - dst_fps) < 1e-6:
        return seq.astype(np.float32)

    n_dst = max(1, int(round((T / src_fps) * dst_fps)))
    idx   = np.linspace(0, T - 1, n_dst)

    lo  = np.floor(idx).astype(int)
    hi  = np.ceil(idx).astype(int)
    fr  = (idx - lo)[:, None, None].astype(np.float32)

    out = (1.0 - fr) * seq[lo] + fr * seq[hi]
    return out.astype(np.float32)


def make_windows(seq: np.ndarray, window: int = 45, stride: int = 15) -> np.ndarray:
    """
    Sliding window dengan edge-padding jika urutan lebih pendek dari window.

    seq: [T, 17, C]
    return: [W, window, 17, C]

    Sesuai inference.py Cell 3 Line 116-122.
    """
    T = seq.shape[0]
    outs = []

    if T < window:
        # Edge-pad: ulangi frame terakhir
        pad = np.repeat(seq[-1:], window - T, axis=0)
        outs.append(np.concatenate([seq, pad], axis=0))
    else:
        for s in range(0, T - window + 1, stride):
            outs.append(seq[s: s + window])

    return np.stack(outs, axis=0).astype(np.float32)   # [W, window, 17, C]


def build_windows_for_heads(
    raw_seq_xyc: np.ndarray,
    src_fps: float,
    window: int = 45,
    stride: int = 15,
    dst_fps: float = 15.0,
) -> dict:
    """
    Pipeline lengkap satu track orang:
      fill_lowconf → resample → window → normalize PER JENDELA
      → siapkan input untuk Kepala Jatuh & Kepala Interaksi

    URUTAN PENTING: normalisasi dilakukan SESUDAH windowing, sekali untuk
    tiap jendela. Anchor "frame pertama" berarti frame pertama JENDELA ITU,
    bukan frame pertama seluruh track — sama seperti saat training, di mana
    tiap sampel window dinormalisasi berdiri sendiri. Kalau seluruh track
    dinormalisasi dengan satu anchor, jendela di menit ke-2 akan diukur
    relatif terhadap posisi orang di detik ke-0 dan menghasilkan koordinat
    yang jauh di luar rentang yang pernah dilihat model saat training.

    raw_seq_xyc: [T, 17, 3] koordinat piksel MENTAH dari YOLOv8-pose

    Returns dict:
      "fall_input"        : [W, window, 24]    (12 sendi × x,y)
      "interaction_input" : [W, window, 51]    (17 sendi × x,y,conf)
      "raw_windows"       : [W, window, 17, 3] koordinat MENTAH untuk lapisan geometri
    """
    raw = raw_seq_xyc.astype(np.float32)

    # 1. Isi frame yang keypoint-nya hilang/rendah confidence
    raw_filled = fill_lowconf_frames(raw)

    # 2. Resample ke dst_fps (masih koordinat piksel mentah)
    raw_resampled = resample_fps(raw_filled, src_fps, dst_fps)   # [T', 17, 3]

    # 3. Sliding window di ruang mentah
    raw_windows = make_windows(raw_resampled, window, stride)    # [W, window, 17, 3]

    W = raw_windows.shape[0]

    # 4. Normalisasi PER JENDELA — anchor = frame pertama jendela tsb
    norm_windows = np.stack(
        [normalize_pose(raw_windows[w]) for w in range(W)], axis=0
    )                                                            # [W, window, 17, 3]

    # 5. Reshape ke input shape masing-masing kepala
    # Fall: 12 sendi × (x,y) = 24 channel
    fall_input = norm_windows[:, :, FALL_JOINTS, :2].reshape(W, window, -1)  # [W, window, 24]
    # Interaction: 17 sendi × (x,y,conf) = 51 channel
    interaction_input = norm_windows.reshape(W, window, -1)                   # [W, window, 51]

    return {
        "fall_input":        fall_input.astype(np.float32),
        "interaction_input": interaction_input.astype(np.float32),
        "raw_windows":       raw_windows.astype(np.float32),
    }


if __name__ == "__main__":
    # Sanity check
    dummy = np.random.rand(90, 17, 3).astype(np.float32) * 100
    dummy[:, :, 2] = 0.9
    out = build_windows_for_heads(dummy, src_fps=30.0)
    print("fall_input        :", out["fall_input"].shape)        # (W, 45, 24)
    print("interaction_input :", out["interaction_input"].shape) # (W, 45, 51)
    print("raw_windows       :", out["raw_windows"].shape)       # (W, 45, 17, 3)
    print("OK normalize.py sesuai inference.py")
