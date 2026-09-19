"""
pipeline/thresholds.py — SAPA

Lapisan KEPUTUSAN jatuh, terpisah dari model.

Sebuah jendela dinyatakan JATUH bila memenuhi ketiga syarat sekaligus:

    JATUH  ⟺  (prob_jatuh >= T_prob) DAN (sudut_torso >= T_angle) DAN (kecepatan >= T_speed)

Syarat dengan ambang 0 berarti dimatikan (selalu lolos).

Angka-angka di bawah berasal dari sweep ambang di atas probabilitas
out-of-fold model multi-angle. Dua temuan yang menentukan default:

  1. Ambang probabilitas terbaik 0,65 — BUKAN 0,80 seperti sistem lama.
     0,80 terlalu ketat dan menyebabkan banyak kejatuhan tidak terdeteksi;
     0,65 menaikkan recall TANPA menambah false alarm (keduanya 0,023).

  2. Kecepatan tidak membantu, malah menurunkan recall (0,841 → 0,764),
     karena kecepatan gerak jatuh dan normal nyaris sama (5,12 vs 4,44).
     Karena itu T_speed=0 secara default, tapi tetap disediakan sebagai
     opsi supaya tim bisa memverifikasi sendiri lewat panel Setting.

Mengubah ambang TIDAK memerlukan pemuatan ulang model — ini murni lapisan
keputusan di atas probabilitas yang sudah dihitung.
"""

# Preset hasil sweep: nama → (T_prob, T_angle, T_speed, metrik)
PRESETS = {
    "prob_sudut": {
        "label": "Prob + Sudut (terbaik)",
        "fall_thr": 0.65, "fall_angle": 5.0, "fall_speed": 0.0,
        "metrik": {"recall": 0.841, "precision": 0.873, "f1": 0.857, "false_alarm": 0.023},
        "catatan": "Default. F1 tertinggi pada evaluasi.",
    },
    "prob_saja": {
        "label": "Prob saja",
        "fall_thr": 0.65, "fall_angle": 0.0, "fall_speed": 0.0,
        "metrik": {"recall": 0.842, "precision": 0.872, "f1": 0.856, "false_alarm": 0.023},
        "catatan": "Tanpa konfirmasi geometri; recall sedikit lebih tinggi.",
    },
    "prob_kecepatan": {
        "label": "Prob + Kecepatan",
        "fall_thr": 0.45, "fall_angle": 0.0, "fall_speed": 2.13,
        "metrik": {"recall": 0.764, "precision": 0.864, "f1": 0.811, "false_alarm": 0.023},
        "catatan": "Recall turun — kecepatan tidak memisahkan jatuh dari gerak normal.",
    },
    "prob_sudut_kecepatan": {
        "label": "Prob + Sudut + Kecepatan",
        "fall_thr": 0.45, "fall_angle": 5.0, "fall_speed": 2.13,
        "metrik": {"recall": 0.764, "precision": 0.864, "f1": 0.811, "false_alarm": 0.023},
        "catatan": "Syarat kecepatan mendominasi; hasil sama dengan mode di atas.",
    },
}

PRESET_DEFAULT = "prob_sudut"

# Default aplikasi — sama dengan preset terbaik.
FALL_THR_DEFAULT   = PRESETS[PRESET_DEFAULT]["fall_thr"]
FALL_ANGLE_DEFAULT = PRESETS[PRESET_DEFAULT]["fall_angle"]
FALL_SPEED_DEFAULT = PRESETS[PRESET_DEFAULT]["fall_speed"]


def resolve(preset: str = PRESET_DEFAULT, **override) -> dict:
    """
    Terjemahkan nama preset menjadi tiga ambang konkret.

    preset "custom" (atau nama tak dikenal) memakai default lalu menerapkan
    override, sehingga slider di UI bisa mengirim nilai bebas.

    Returns: {"preset", "fall_thr", "fall_angle", "fall_speed"}
    """
    base = PRESETS.get(preset)
    if base is None:
        base = PRESETS[PRESET_DEFAULT]
        preset = "custom" if preset == "custom" else PRESET_DEFAULT

    out = {
        "preset": preset,
        "fall_thr":   float(base["fall_thr"]),
        "fall_angle": float(base["fall_angle"]),
        "fall_speed": float(base["fall_speed"]),
    }
    for k in ("fall_thr", "fall_angle", "fall_speed"):
        if override.get(k) is not None:
            out[k] = float(override[k])
    return out


def is_fall(prob: float, angle: float, speed: float,
            fall_thr: float, fall_angle: float, fall_speed: float) -> bool:
    """
    Aturan keputusan gabungan. Ambang bernilai 0 = syarat dimatikan.
    """
    if prob < fall_thr:
        return False
    if fall_angle > 0 and angle < fall_angle:
        return False
    if fall_speed > 0 and speed < fall_speed:
        return False
    return True
