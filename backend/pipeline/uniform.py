"""
pipeline/uniform.py — SAPA

Pengenalan PEGAWAI lewat seragam, "Level 1.5": cocokkan PROFIL WARNA + POLA
SEDERHANA, bukan satu warna dominan. Murni OpenCV di inference — tanpa model,
tanpa dataset, tanpa training.

KENAPA BUKAN WARNA TUNGGAL
--------------------------
Mencocokkan satu warna dominan gampang keliru: pelanggan berkaus biru polos
akan dianggap pegawai berseragam biru. Seragam nyata umumnya punya lebih dari
satu warna khas (mis. biru dengan garis pink) dan susunan tertentu. Karena itu
sidik seragam di sini menyimpan DISTRIBUSI warna (histogram HSV) plus beberapa
ciri pola ringan, dan pencocokan mensyaratkan keduanya mirip.

KENAPA HSV, BUKAN RGB
---------------------
Hue relatif stabil saat terang-gelap berubah, sedangkan ketiga kanal RGB
bergeser bersamaan. CCTV toko punya pencahayaan yang tidak rata, jadi HSV
memberi pencocokan yang jauh lebih tahan.

BATASAN YANG DISADARI (tulis juga di pitch)
-------------------------------------------
Ini Level 1.5 — lebih tahan dari warna tunggal, tapi BUKAN solusi sempurna.
Pelanggan yang kebetulan berpakaian sangat mirip seragam (warna DAN pola
serupa) masih bisa salah dikenali sebagai pegawai. Arah pengembangan lanjutan
adalah pencocokan berbasis feature embedding / person re-identification —
JANGAN dibangun sekarang, itu future work.

CAKUPAN — PENTING
-----------------
Penandaan pegawai HANYA dipakai untuk mengecualikan dari deteksi BUTUH BANTUAN.
Deteksi JATUH tidak pernah terpengaruh: pegawai yang jatuh tetap keadaan darurat
dan harus selalu terdeteksi.
"""

import json
import logging
from pathlib import Path

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# Indeks COCO-17 untuk kotak torso
L_SHOULDER, R_SHOULDER = 5, 6
L_HIP, R_HIP           = 11, 12

# Ukuran histogram HSV. Hue diberi bin terbanyak karena itu pembawa identitas
# warna; saturation & value lebih kasar supaya toleran terhadap pencahayaan.
HUE_BINS, SAT_BINS, VAL_BINS = 24, 4, 4

DEFAULT = {
    # Ambang kemiripan histogram (korelasi 0..1). Di bawah ini = bukan seragam.
    "seragam_ambang": 0.60,
    # Toleransi selisih rasio warna dominan saat membandingkan pola.
    "seragam_toleransi_rasio": 0.25,
    # Berapa frame awal track yang dicek, dan berapa proporsi yang harus cocok.
    "seragam_frame_cek": 12,
    "seragam_rasio_setuju": 0.5,
    # Confidence keypoint minimum agar kotak torso dianggap sah.
    "seragam_min_conf": 0.30,
    # Luas minimum patch torso (piksel) agar histogramnya bermakna.
    # Orang yang jauh dari kamera menghasilkan torso sangat kecil; sidik dari
    # patch seperti itu tidak stabil antar-frame — terukur pada klip uji, torso
    # 37x21 px memberi skor 0,705 / -0,009 / -0,009 / 0,164 untuk ORANG YANG
    # SAMA di empat frame berdekatan. Lebih baik melewati frame itu daripada
    # menyumbang suara acak ke keputusan pegawai.
    "seragam_min_area": 1200,
    # Aktif/nonaktif fitur exclude pegawai.
    "seragam_aktif": False,
}


def kotak_torso(kp: np.ndarray, w: int, h: int, min_conf: float = 0.30):
    """
    Tentukan kotak area torso dari keypoint bahu (5,6) & pinggul (11,12).

    Mengembalikan (x0, y0, x1, y1) terpotong ke dalam frame, atau None bila
    keypoint-nya tidak cukup terpercaya. Kotak dipersempit ke tengah badan
    supaya isinya baju, bukan latar di sekitar lengan.
    """
    idx = [L_SHOULDER, R_SHOULDER, L_HIP, R_HIP]
    if any(kp[i, 2] < min_conf for i in idx):
        return None

    xs = kp[idx, 0]
    ys = kp[idx, 1]
    x0, x1 = float(xs.min()), float(xs.max())
    y0, y1 = float(ys.min()), float(ys.max())

    lebar, tinggi = x1 - x0, y1 - y0
    if lebar < 4 or tinggi < 4:
        return None

    # Persempit 15% di kiri-kanan (buang latar), dan ambil bagian atas torso
    # (dada) yang paling konsisten memperlihatkan seragam.
    x0 += lebar * 0.15
    x1 -= lebar * 0.15
    y1 =  y0 + tinggi * 0.85

    x0, y0 = max(0, int(x0)), max(0, int(y0))
    x1, y1 = min(w, int(x1)), min(h, int(y1))
    if x1 - x0 < 4 or y1 - y0 < 4:
        return None
    return (x0, y0, x1, y1)


def signature_dari_patch(patch: np.ndarray, min_area: int = 0) -> dict | None:
    """
    Hitung "sidik seragam" dari potongan gambar BGR.

    Isi signature:
      hist       : histogram HSV ter-normalisasi (list, HUE_BINS*SAT_BINS*VAL_BINS)
      n_dominan  : jumlah warna dominan (hue) — seragam multi-warna > 1
      rasio      : proporsi tiap warna dominan, terurut menurun
      hue_dominan: hue tiap warna dominan (bin index)
      terbagi    : True bila paruh atas & bawah torso beda warna dominan
                   (menangkap garis/blok horizontal tanpa mendeteksi logo)
    """
    if patch is None or patch.size == 0 or patch.shape[0] < 4 or patch.shape[1] < 4:
        return None
    # Patch terlalu kecil menghasilkan histogram yang tidak stabil antar-frame
    # (lihat DEFAULT["seragam_min_area"]). Dilewati, bukan dipaksakan.
    if min_area > 0 and patch.shape[0] * patch.shape[1] < min_area:
        return None

    hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)

    # Buang piksel terlalu gelap / terlalu pudar: hue-nya tidak bermakna.
    mask = ((hsv[:, :, 1] > 40) & (hsv[:, :, 2] > 40)).astype(np.uint8) * 255
    if int(mask.sum()) == 0:
        mask = None

    hist = cv2.calcHist([hsv], [0, 1, 2], mask,
                        [HUE_BINS, SAT_BINS, VAL_BINS],
                        [0, 180, 0, 256, 0, 256])
    cv2.normalize(hist, hist, 0, 1, cv2.NORM_MINMAX)
    hist = hist.flatten()

    # Warna dominan dari histogram hue saja (lebih stabil untuk "pola").
    hist_h = cv2.calcHist([hsv], [0], mask, [HUE_BINS], [0, 180]).flatten()
    total = float(hist_h.sum())
    if total <= 0:
        return None
    rasio_semua = hist_h / total

    # Warna dianggap "dominan" bila menempati >= 12% area torso.
    urut = np.argsort(rasio_semua)[::-1]
    dominan = [int(i) for i in urut if rasio_semua[i] >= 0.12][:3]
    if not dominan:
        dominan = [int(urut[0])]

    # Pembagian horizontal: paruh atas vs bawah torso punya hue dominan beda?
    h_patch = hsv.shape[0]
    atas, bawah = hsv[: h_patch // 2], hsv[h_patch // 2:]
    def hue_dom(blok):
        m = ((blok[:, :, 1] > 40) & (blok[:, :, 2] > 40)).astype(np.uint8) * 255
        if int(m.sum()) == 0:
            m = None
        hh = cv2.calcHist([blok], [0], m, [HUE_BINS], [0, 180]).flatten()
        return int(np.argmax(hh)) if hh.sum() > 0 else -1
    terbagi = hue_dom(atas) != hue_dom(bawah)

    return {
        "hist": [float(v) for v in hist],
        "n_dominan": len(dominan),
        "rasio": [float(rasio_semua[i]) for i in dominan],
        "hue_dominan": dominan,
        "terbagi": bool(terbagi),
    }


def bandingkan(sig_a: dict, sig_b: dict, cfg: dict) -> tuple:
    """
    Bandingkan dua signature. Returns (cocok: bool, skor: float).

    Cocok mensyaratkan DUA hal sekaligus — inilah inti "Level 1.5":
      1. histogram HSV mirip (korelasi >= ambang), DAN
      2. pola cocok: jumlah warna dominan sama (toleransi 1), hue dominan
         utama sama, dan rasio warna utama tidak berselisih jauh.

    Kalau hanya histogram yang lolos tapi polanya beda, hasilnya TIDAK cocok.
    Itu yang mencegah kaus polos satu warna lolos sebagai seragam multi-warna.
    """
    if not sig_a or not sig_b:
        return False, 0.0

    ambang    = float(cfg.get("seragam_ambang",          DEFAULT["seragam_ambang"]))
    tol_rasio = float(cfg.get("seragam_toleransi_rasio", DEFAULT["seragam_toleransi_rasio"]))

    ha = np.asarray(sig_a["hist"], dtype=np.float32)
    hb = np.asarray(sig_b["hist"], dtype=np.float32)
    if ha.shape != hb.shape:
        return False, 0.0

    skor = float(cv2.compareHist(ha, hb, cv2.HISTCMP_CORREL))
    if skor < ambang:
        return False, skor

    # ── Syarat pola ──────────────────────────────────────────────────────────
    if abs(int(sig_a["n_dominan"]) - int(sig_b["n_dominan"])) > 1:
        return False, skor

    dom_a, dom_b = sig_a.get("hue_dominan", []), sig_b.get("hue_dominan", [])
    if not dom_a or not dom_b:
        return False, skor

    # Hue dominan utama harus sama (toleransi 1 bin untuk pergeseran cahaya).
    if min(abs(dom_a[0] - dom_b[0]), HUE_BINS - abs(dom_a[0] - dom_b[0])) > 1:
        return False, skor

    ra, rb = sig_a.get("rasio", [0]), sig_b.get("rasio", [0])
    if abs(ra[0] - rb[0]) > tol_rasio:
        return False, skor

    # Warna KEDUA juga harus cocok bila seragam memang multi-warna. Tanpa
    # pemeriksaan ini, "biru + hijau" lolos sebagai "biru + pink" — hue utama
    # dan rasionya sama, dan korelasi histogram tetap tinggi (0,88) karena
    # warna kedua hanya mengisi sebagian kecil area torso.
    if len(dom_a) > 1 and len(dom_b) > 1:
        selisih = abs(dom_a[1] - dom_b[1])
        if min(selisih, HUE_BINS - selisih) > 1:
            return False, skor

    return True, skor


# ── Penyimpanan signature seragam per toko ───────────────────────────────────

def muat_seragam(path: str | Path) -> list:
    """Baca daftar seragam terdaftar dari file JSON. Kosong bila belum ada."""
    p = Path(path)
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text())
        return data.get("seragam", []) if isinstance(data, dict) else []
    except Exception as e:
        logger.warning(f"Gagal membaca seragam dari {p}: {e}")
        return []


def simpan_seragam(path: str | Path, daftar: list) -> None:
    """Tulis daftar seragam ke file JSON (dibuat bila belum ada)."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"seragam": daftar}, indent=2))


def signature_dari_file(path_gambar: str, crop_tengah: bool = True) -> dict | None:
    """
    Hitung signature dari satu file foto seragam (dipakai saat registrasi).

    crop_tengah=True memotong 15% tepi lalu mengambil bagian tengah, karena
    foto seragam biasanya masih menyisakan latar di pinggir. Setel False bila
    area-nya sudah dipilih presisi oleh user (mis. crop dari frame video) —
    memotongnya lagi hanya akan membuang bagian yang sengaja dipilih.
    """
    img = cv2.imread(str(path_gambar))
    if img is None:
        return None
    if crop_tengah:
        h, w = img.shape[:2]
        y0, y1 = int(h * 0.15), int(h * 0.85)
        x0, x1 = int(w * 0.15), int(w * 0.85)
        img = img[y0:y1, x0:x1]
    return signature_dari_patch(img)


def gabung_signature(sigs: list) -> dict | None:
    """
    Gabungkan beberapa signature (1-3 foto seragam yang sama) menjadi satu.

    KENAPA DIRATA-RATA, BUKAN DISIMPAN TERPISAH
    Beberapa foto dari sudut & pencahayaan berbeda memberi gambaran seragam
    yang lebih utuh daripada satu foto. Histogram-nya dirata-ratakan lalu
    dinormalisasi ulang, sehingga warna yang muncul KONSISTEN di semua foto
    menguat, sementara pantulan cahaya atau latar yang hanya ada di satu foto
    ikut melemah.

    Ciri pola diambil dengan MEDIAN / MAYORITAS, bukan rata-rata, supaya satu
    foto yang buruk (mis. terlalu gelap sehingga warna keduanya tak terbaca)
    tidak menggeser hasilnya.
    """
    sigs = [s for s in sigs if s]
    if not sigs:
        return None
    if len(sigs) == 1:
        return sigs[0]

    H = np.mean([np.asarray(s["hist"], dtype=np.float32) for s in sigs], axis=0)
    puncak = float(H.max())
    if puncak > 0:
        H = H / puncak   # normalisasi ulang ke 0..1 seperti signature tunggal

    # Pola: ambil nilai tengah / terbanyak dari foto-foto yang ada.
    n_dom = int(np.median([s["n_dominan"] for s in sigs]))
    hue0  = [s["hue_dominan"][0] for s in sigs if s.get("hue_dominan")]
    hue1  = [s["hue_dominan"][1] for s in sigs if len(s.get("hue_dominan", [])) > 1]
    rasio0 = [s["rasio"][0] for s in sigs if s.get("rasio")]
    rasio1 = [s["rasio"][1] for s in sigs if len(s.get("rasio", [])) > 1]

    hue_dominan = [int(np.median(hue0))] if hue0 else [0]
    if hue1:
        hue_dominan.append(int(np.median(hue1)))

    rasio = [float(np.median(rasio0))] if rasio0 else [1.0]
    if rasio1:
        rasio.append(float(np.median(rasio1)))

    return {
        "hist": [float(v) for v in H],
        "n_dominan": max(1, n_dom),
        "rasio": rasio,
        "hue_dominan": hue_dominan,
        # Mayoritas: pembagian blok dianggap ada bila terlihat di lebih dari
        # separuh foto.
        "terbagi": bool(sum(1 for s in sigs if s.get("terbagi")) * 2 > len(sigs)),
        "n_foto": len(sigs),
    }


def ambil_frame(video_path: str, detik: float = 0.0) -> np.ndarray | None:
    """
    Ambil satu frame dari video pada detik tertentu.

    Dipakai untuk registrasi "pilih area dari frame video toko": user melihat
    frame ini, lalu menandai kotak area seragam pegawai di atasnya.
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return None
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        if detik > 0:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(detik * fps))
        ok, frame = cap.read()
        return frame if ok else None
    finally:
        cap.release()


def tandai_pegawai(
    kandidat: dict,
    daftar_seragam: list,
    cfg: dict,
) -> dict:
    """
    Putuskan track mana yang pegawai, dari kumpulan signature per track.

    kandidat: {track_id: [signature, ...]} — signature beberapa frame AWAL track.
              Hanya frame awal yang dicek: sekali ditandai, tanda itu bertahan
              selama track_id hidup, jadi tidak ada pemeriksaan warna tiap frame.

    Returns: {track_id: {"pegawai": bool, "skor": float, "nama": str|None}}
    """
    rasio_setuju = float(cfg.get("seragam_rasio_setuju", DEFAULT["seragam_rasio_setuju"]))
    hasil: dict = {}

    for tid, sigs in kandidat.items():
        if not sigs or not daftar_seragam:
            hasil[tid] = {"pegawai": False, "skor": 0.0, "nama": None}
            continue

        n_cocok = 0
        skor_terbaik = 0.0
        nama_terbaik = None

        for sig in sigs:
            cocok_frame = False
            for ser in daftar_seragam:
                cocok, skor = bandingkan(sig, ser.get("signature", {}), cfg)
                if skor > skor_terbaik:
                    skor_terbaik = skor
                    if cocok:
                        nama_terbaik = ser.get("nama")
                if cocok:
                    cocok_frame = True
            if cocok_frame:
                n_cocok += 1

        # Butuh MAYORITAS frame awal yang cocok, bukan sekali kebetulan.
        pegawai = (n_cocok / len(sigs)) >= rasio_setuju
        hasil[tid] = {
            "pegawai": bool(pegawai),
            "skor": round(skor_terbaik, 3),
            "nama": nama_terbaik if pegawai else None,
        }

    return hasil
