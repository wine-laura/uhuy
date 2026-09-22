"""
app.py — SAPA Backend (FastAPI)

Endpoint:
  POST /analyze      → analisis klip video (sinkron), return timeline + URL video beranotasi
  GET  /outputs/{fn} → sajikan video beranotasi
  WS   /ws/live      → mode live: terima frame webcam, kirim pose + event real-time

  Mode produksi CCTV (opsional, lihat production/):
  /api/produksi/*    → manajemen multi-kamera, log kejadian, kesehatan sistem
  WS /ws/produksi/alert → alert langsung ke dashboard operator

Model dimuat SEKALI saat startup (bukan per request).

MODE PRODUKSI DIMATIKAN SECARA DEFAULT.
Aktifkan dengan SAPA_PRODUKSI=1. Alasannya: yang dinilai lomba adalah MVP offline
(unggah klip), dan menyalakan pekerja kamera 24/7 di lingkungan penilaian hanya
akan memakan CPU tanpa gunanya. Dengan gerbang ini, perilaku default backend
sama persis seperti sebelum lapisan produksi ditambahkan.
"""

import asyncio
import os
import uuid
import shutil
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import Body, FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from pipeline.models import load_head
from pipeline.analyze import analyze
from pipeline.render import render
from pipeline import thresholds as TH
from pipeline import uniform as UNI
from pipeline.gestures import DEFAULT as GESTUR_DEFAULT
from live_server import router as live_router
from production.api import router as produksi_router, ws_router as produksi_ws_router
from production.api import pasang_manager
from production.manager import CameraManager

# ── Logging ───────────────────────────────────────────────────────────────────
LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
logging.basicConfig(
    level=logging.INFO,
    format=LOG_FORMAT,
)
logger = logging.getLogger("sapa.app")

def setup_loggers():
    formatter = logging.Formatter(LOG_FORMAT)
    for handler in logging.root.handlers:
        handler.setFormatter(formatter)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "sapa.app", "pipeline.analyze", "pipeline.render", "pipeline.extract"):
        l = logging.getLogger(name)
        l.setLevel(logging.INFO)
        for h in l.handlers:
            h.setFormatter(formatter)

setup_loggers()

# ── Path ──────────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent
MODELS_DIR = BASE_DIR / "models"
OUTPUTS_DIR = BASE_DIR / "outputs"
UPLOADS_DIR = BASE_DIR / "uploads"
DATA_DIR = BASE_DIR / "data"

OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# ── Mode produksi CCTV (opsional) ─────────────────────────────────────────────
PRODUKSI_AKTIF = os.getenv("SAPA_PRODUKSI", "0").lower() in ("1", "true", "yes", "on")
PROFIL_KAMERA = Path(os.getenv("SAPA_PROFIL_KAMERA", DATA_DIR / "cameras.json"))
LOG_KEJADIAN = Path(os.getenv("SAPA_LOG_KEJADIAN", DATA_DIR / "kejadian.jsonl"))
RETENSI_JAM = float(os.getenv("SAPA_RETENSI_JAM", "72"))

# Sidik seragam per toko — didaftarkan sekali oleh user, dipakai ulang.
# Disimpan di data/ agar selamat dari rebuild image (lihat docker-compose.yml).
PROFIL_SERAGAM = Path(os.getenv("SAPA_PROFIL_SERAGAM", DATA_DIR / "seragam.json"))

# ── State global (model dimuat sekali) ────────────────────────────────────────
_state: dict = {
    "fall_model": None,
    "inter_model": None,
    "fall_cfg": {},
    "inter_cfg": {},
    "manager": None,
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model saat startup, bersihkan saat shutdown."""
    setup_loggers()
    fall_pt = MODELS_DIR / "fall_head.pt"
    fall_json = MODELS_DIR / "fall_head.json"
    inter_pt = MODELS_DIR / "interaction_head.pt"
    inter_json = MODELS_DIR / "interaction_head.json"

    if fall_pt.exists() and fall_json.exists():
        try:
            _state["fall_model"], _state["fall_cfg"] = load_head(str(fall_pt), str(fall_json))
            logger.info("✅ Fall model berhasil dimuat.")
        except Exception as e:
            logger.error(f"❌ Gagal muat fall model: {e}")
    else:
        logger.warning("⚠️  fall_head.pt atau fall_head.json tidak ditemukan — deteksi jatuh dinonaktifkan.")

    if inter_pt.exists() and inter_json.exists():
        try:
            _state["inter_model"], _state["inter_cfg"] = load_head(str(inter_pt), str(inter_json))
            logger.info("✅ Interaction model berhasil dimuat.")
        except Exception as e:
            logger.error(f"❌ Gagal muat interaction model: {e}")
    else:
        logger.warning("⚠️  interaction_head.pt atau interaction_head.json tidak ditemukan — deteksi pelayanan dinonaktifkan.")

    # ── Mode produksi CCTV ────────────────────────────────────────────────────
    if PRODUKSI_AKTIF:
        try:
            manager = CameraManager(
                path_profil=PROFIL_KAMERA,
                path_log_kejadian=LOG_KEJADIAN,
                retensi_jam=RETENSI_JAM,
            )
            manager.pasang_model(
                fall_model=_state["fall_model"],
                inter_model=_state["inter_model"],
            )
            # Pekerja kamera berjalan di thread; mesin alert butuh referensi ke
            # event loop ini untuk menyiarkan alert ke WebSocket dengan aman.
            manager.alert.pasang_loop(asyncio.get_running_loop())
            manager.mulai()

            _state["manager"] = manager
            pasang_manager(manager)
            logger.info(
                f"🎥 Mode produksi AKTIF — profil: {PROFIL_KAMERA}, retensi: {RETENSI_JAM} jam."
            )
        except Exception as e:
            logger.exception(f"❌ Gagal menyalakan mode produksi: {e}")
    else:
        logger.info("Mode produksi nonaktif (set SAPA_PRODUKSI=1 untuk mengaktifkan).")

    yield  # aplikasi berjalan

    manager = _state.get("manager")
    if manager is not None:
        try:
            manager.berhenti()
        except Exception as e:
            logger.warning(f"Gagal menghentikan mode produksi dengan rapi: {e}")

    logger.info("SAPA backend shutdown.")


# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="SAPA API",
    description="Safety and Assistance through Pose Analytics — analitik toko berbasis pose (privacy-by-design).",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mode Live — WebSocket /ws/live
app.include_router(live_router)

# Mode Produksi CCTV — endpoint selalu terdaftar agar terdokumentasi di /docs,
# tapi mengembalikan 503 bila SAPA_PRODUKSI belum diaktifkan.
app.include_router(produksi_router)
app.include_router(produksi_ws_router)

# Sajikan folder outputs sebagai file statis
app.mount("/outputs", StaticFiles(directory=str(OUTPUTS_DIR)), name="outputs")


# ── Endpoint ──────────────────────────────────────────────────────────────────

@app.get("/")
def akar():
    """
    Penunjuk arah, bukan halaman aplikasi.

    Membuka http://localhost:8000 di browser sebelumnya menghasilkan 404 karena
    backend memang tidak menyajikan halaman — antarmuka ada di frontend (port
    5173 saat dev, 80 di dalam Docker). 404 itu benar secara teknis tapi
    menyesatkan: ia tampak seperti aplikasi rusak, dan ikut terekam sebagai
    baris merah di log saat demonstrasi.
    """
    return {
        "layanan": "SAPA API",
        "status": "ok",
        "catatan": "Ini API, bukan antarmuka. Buka aplikasinya di http://localhost:5173",
        "dokumentasi": "/docs",
        "endpoint_utama": {
            "analisis_klip": "POST /analyze",
            "kesehatan": "GET /health",
        },
    }


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    """Browser selalu meminta ini; balas 204 agar log tidak penuh 404 palsu."""
    return Response(status_code=204)


@app.get("/health")
def health():
    """Cek status server dan model."""
    manager = _state.get("manager")
    return {
        "status": "ok",
        "fall_model_loaded": _state["fall_model"] is not None,
        "inter_model_loaded": _state["inter_model"] is not None,
        "produksi_aktif": manager is not None,
        "kamera_berjalan": (
            manager.kesehatan()["kamera_berjalan"] if manager is not None else 0
        ),
    }


@app.get("/status")                # lewat proxy frontend (/api dibuang)
@app.get("/api/status")            # akses langsung ke backend
def api_status():
    """
    Status ketersediaan model untuk ditampilkan di frontend.
    Return:
      fall_model    : bool — Kepala Jatuh (fall_head.pt) siap
      inter_model   : bool — Kepala Interaksi (interaction_head.pt) siap
      pipeline_ready: bool — minimal YOLO tersedia (YOLOv8 selalu ready jika terinstal)
    """
    return {
        "fall_model":     _state["fall_model"] is not None,
        "inter_model":    _state["inter_model"] is not None,
        "pipeline_ready": True,  # YOLOv8-pose selalu di-load lazy saat pertama infer
    }


# Didaftarkan di dua path. Proxy frontend (nginx `proxy_pass .../` dan Vite
# `rewrite`) MEMBUANG prefiks /api, jadi permintaan browser ke /api/preset tiba
# di sini sebagai /preset. Path "/api/preset" dipertahankan agar akses langsung
# ke backend (curl, /docs) tetap bekerja seperti /api/status.
@app.get("/preset")
@app.get("/api/preset")
def api_preset():
    """
    Daftar preset ambang jatuh untuk panel Setting di UI.

    Semua preset memakai MODEL YANG SAMA — yang berbeda hanya lapisan
    keputusan. Tidak perlu bobot terpisah per mode.
    """
    return {
        "default": TH.PRESET_DEFAULT,
        "preset": [
            {"id": pid, **{k: v for k, v in p.items()}}
            for pid, p in TH.PRESETS.items()
        ],
        "batas": {
            "fall_thr":   {"min": 0.30, "max": 0.95, "step": 0.05},
            "fall_angle": {"min": 0,    "max": 80,   "step": 5},
            "fall_speed": {"min": 0,    "max": 10,   "step": 0.25},
        },
        "catatan": (
            "Kecepatan dimatikan secara default karena pada evaluasi tidak "
            "meningkatkan akurasi; disediakan untuk eksperimen."
        ),
        # Ambang aturan angkat tangan — dipisah dari ambang jatuh karena ini
        # rule-based, bukan keluaran model.
        "angkat": {
            "default": {
                "angkat_aktif": True,
                "angkat_min_durasi": GESTUR_DEFAULT["angkat_min_durasi"],
                "angkat_maks_gerak": GESTUR_DEFAULT["angkat_maks_gerak"],
            },
            "batas": {
                "angkat_min_durasi": {"min": 1.0, "max": 6.0,  "step": 0.5},
                "angkat_maks_gerak": {"min": 0.1, "max": 1.0,  "step": 0.05},
            },
            "catatan": (
                "Durasi lebih panjang & gerak lebih kecil = lebih ketat. "
                "Menahan tangan membedakan minta bantuan dari stretching, "
                "tos, dan melambai."
            ),
        },
    }


@app.get("/seragam")               # lewat proxy frontend (/api dibuang)
@app.get("/api/seragam")           # akses langsung ke backend
def api_seragam_list():
    """Daftar seragam yang sudah terdaftar (tanpa histogram, biar ringan)."""
    daftar = UNI.muat_seragam(PROFIL_SERAGAM)
    return {
        "seragam": [
            {
                "id": s.get("id"),
                "nama": s.get("nama"),
                "n_dominan": s.get("signature", {}).get("n_dominan"),
                "rasio": s.get("signature", {}).get("rasio"),
                "terbagi": s.get("signature", {}).get("terbagi"),
            }
            for s in daftar
        ],
        "batas": {
            "seragam_ambang": {"min": 0.30, "max": 0.95, "step": 0.05},
        },
        "default": {
            "seragam_ambang": UNI.DEFAULT["seragam_ambang"],
            "seragam_aktif":  UNI.DEFAULT["seragam_aktif"],
        },
        "catatan": (
            "Level 1.5 — cocokkan warna + pola sederhana. Lebih tahan dari "
            "warna tunggal, tapi pelanggan berpakaian sangat mirip seragam "
            "masih bisa keliru ter-exclude. Pegawai TETAP dicek untuk jatuh."
        ),
    }


@app.post("/seragam")
@app.post("/api/seragam")
async def api_seragam_tambah(
    file: UploadFile = File(..., description="Foto seragam (.jpg/.png)"),
    nama: str = Form("Seragam", description="Nama seragam, mis. 'Seragam Kasir'"),
):
    """
    Daftarkan satu seragam dari foto.

    Yang disimpan hanya SIDIK seragam (histogram HSV + ciri pola), bukan
    fotonya — file upload dihapus setelah diproses. Jadi tidak ada gambar orang
    yang tersimpan, konsisten dengan privacy-by-design.
    """
    suffix = Path(file.filename or "foto.jpg").suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".bmp"}:
        raise HTTPException(status_code=400, detail=f"Format tidak didukung: {suffix}")

    tmp = UPLOADS_DIR / f"seragam_{uuid.uuid4().hex[:8]}{suffix}"
    try:
        with open(tmp, "wb") as f:
            shutil.copyfileobj(file.file, f)

        sig = UNI.signature_dari_file(str(tmp))
        if sig is None:
            raise HTTPException(
                status_code=400,
                detail="Gagal membaca warna dari foto. Pastikan foto jelas dan tidak terlalu gelap.",
            )

        daftar = UNI.muat_seragam(PROFIL_SERAGAM)
        entri = {"id": uuid.uuid4().hex[:8], "nama": nama, "signature": sig}
        daftar.append(entri)
        UNI.simpan_seragam(PROFIL_SERAGAM, daftar)

        logger.info(
            f"Seragam '{nama}' terdaftar (id={entri['id']}, "
            f"{sig['n_dominan']} warna dominan, terbagi={sig['terbagi']})."
        )
        return {
            "id": entri["id"],
            "nama": nama,
            "n_dominan": sig["n_dominan"],
            "rasio": sig["rasio"],
            "terbagi": sig["terbagi"],
            "total_terdaftar": len(daftar),
        }
    finally:
        if tmp.exists():
            tmp.unlink()


@app.delete("/seragam/{seragam_id}")
@app.delete("/api/seragam/{seragam_id}")
def api_seragam_hapus(seragam_id: str):
    """Hapus satu seragam terdaftar."""
    daftar = UNI.muat_seragam(PROFIL_SERAGAM)
    sisa = [s for s in daftar if s.get("id") != seragam_id]
    if len(sisa) == len(daftar):
        raise HTTPException(status_code=404, detail="Seragam tidak ditemukan.")
    UNI.simpan_seragam(PROFIL_SERAGAM, sisa)
    return {"dihapus": seragam_id, "total_terdaftar": len(sisa)}


@app.post("/rethreshold")          # lewat proxy frontend (/api dibuang)
@app.post("/api/rethreshold")      # akses langsung ke backend
def api_rethreshold(payload: dict = Body(...)):
    """
    Hitung ulang kejadian jatuh dari fitur jendela yang SUDAH dihitung.

    Ini yang membuat panel Setting terasa instan: ekstraksi pose dan inferensi
    model — bagian paling lambat — tidak diulang sama sekali. Frontend mengirim
    balik "fall_cache" dari respons /analyze beserta ambang baru, dan yang
    terjadi di sini hanya perbandingan angka.

    Body: {
      "fall_cache": [{track_id, t0, t1, prob, sudut_torso, kecepatan}, ...],
      "preset": "prob_sudut" | ... | "custom",
      "fall_thr": float|null, "fall_angle": float|null, "fall_speed": float|null
    }
    """
    cache = payload.get("fall_cache") or []
    if not isinstance(cache, list):
        raise HTTPException(status_code=400, detail="fall_cache harus berupa list.")

    ambang = TH.resolve(
        payload.get("preset", TH.PRESET_DEFAULT),
        fall_thr=payload.get("fall_thr"),
        fall_angle=payload.get("fall_angle"),
        fall_speed=payload.get("fall_speed"),
    )

    timeline = []
    for win in cache:
        try:
            prob  = float(win["prob"])
            angle = float(win.get("sudut_torso", 0.0))
            speed = float(win.get("kecepatan", 0.0))
        except (KeyError, TypeError, ValueError):
            continue

        if TH.is_fall(prob, angle, speed,
                      ambang["fall_thr"], ambang["fall_angle"], ambang["fall_speed"]):
            timeline.append({
                "tipe": "jatuh",
                "t0": float(win.get("t0", 0.0)),
                "t1": float(win.get("t1", 0.0)),
                "skor": prob,
                "sudut_torso": angle,
                "kecepatan": speed,
                "track_id": int(win.get("track_id", 0)),
            })

    timeline.sort(key=lambda e: e["t0"])

    return {
        "ambang": ambang,
        "timeline": timeline,
        "summary": {
            "jatuh": len(timeline),
            "total_window": len(cache),
            "total_track": len(set(e["track_id"] for e in timeline)),
        },
    }


@app.post("/analyze")
async def analyze_video(
    file: UploadFile = File(..., description="File video .mp4"),
    camera_type: str = Form(
        "both",
        description=(
            "Jenis kamera: "
            "'lorong' (deteksi jatuh, kamera samping), "
            "'rak' (deteksi pelayanan, kamera atas/top-down), "
            "'both' (keduanya aktif, default)"
        ),
    ),
    preset: str = Form(
        TH.PRESET_DEFAULT,
        description="Preset ambang jatuh: prob_sudut | prob_saja | prob_kecepatan | prob_sudut_kecepatan | custom",
    ),
    fall_thr: Optional[float] = Form(None, description="Override ambang probabilitas (0–1)"),
    fall_angle: Optional[float] = Form(None, description="Override ambang sudut torso (°); 0 = matikan"),
    fall_speed: Optional[float] = Form(None, description="Override ambang kecepatan; 0 = matikan"),
    # ── Fitur angkat tangan (rule-based) ──────────────────────────────────
    angkat_aktif: bool = Form(True, description="Aktifkan deteksi angkat tangan minta bantuan"),
    angkat_min_durasi: Optional[float] = Form(None, description="Detik tangan harus ditahan (default 2.5)"),
    angkat_maks_gerak: Optional[float] = Form(None, description="Gerak wrist maks antar-frame, satuan torso (default 0.35)"),
    # ── Fitur exclude pegawai via seragam ─────────────────────────────────
    seragam_aktif: bool = Form(False, description="Kecualikan pegawai berseragam dari butuh-bantuan"),
    seragam_ambang: Optional[float] = Form(None, description="Ambang kemiripan seragam 0–1 (default 0.60)"),
):
    """
    Analisis klip video CCTV.

    - Unggah file .mp4 via multipart/form-data
    - Pilih jenis kamera untuk mengaktifkan deteksi yang sesuai
    - Proses sinkron — klip panjang (>2 menit) bisa memakan waktu beberapa menit
    - Kembalikan timeline kejadian + URL video beranotasi
    """
    # Validasi format file
    filename = file.filename or "video.mp4"
    suffix = Path(filename).suffix.lower()
    if suffix not in {".mp4", ".avi", ".mov", ".mkv"}:
        raise HTTPException(status_code=400, detail=f"Format tidak didukung: {suffix}. Gunakan .mp4")

    # Validasi camera_type
    if camera_type not in {"lorong", "rak", "both"}:
        raise HTTPException(status_code=400, detail="camera_type harus 'lorong', 'rak', atau 'both'.")

    # Simpan file upload
    uid = str(uuid.uuid4())[:8]
    stem = Path(filename).stem
    upload_path = UPLOADS_DIR / f"{stem}_{uid}.mp4"

    try:
        with open(upload_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        logger.info(f"Video diunggah: {upload_path.name} ({upload_path.stat().st_size // 1024} KB)")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gagal menyimpan file: {e}")

    # Bangun konfigurasi berdasarkan jenis kamera
    run_fall = camera_type in ("lorong", "both")
    run_interaction = camera_type in ("rak", "both")

    # Ambil fall_joints dari config model jika tersedia
    fall_joints = _state["fall_cfg"].get("fall_joints", list(range(5, 17)))

    # Ambang keputusan jatuh: preset + override opsional dari panel Setting
    ambang = TH.resolve(preset, fall_thr=fall_thr, fall_angle=fall_angle, fall_speed=fall_speed)
    logger.info(f"Ambang jatuh: {ambang}")

    # Seragam terdaftar — hanya dimuat bila fiturnya dinyalakan.
    daftar_seragam = UNI.muat_seragam(PROFIL_SERAGAM) if seragam_aktif else []
    if seragam_aktif and not daftar_seragam:
        logger.warning(
            "seragam_aktif=1 tapi belum ada seragam terdaftar — "
            "tidak ada yang bisa dicocokkan, exclude pegawai efektif nonaktif."
        )



    cfg = {
        "run_fall": run_fall,
        "run_interaction": run_interaction,
        # Ambang deteksi jatuh — default hasil sweep, lihat pipeline/thresholds.py.
        # Nilai lama (0,80 / 35°) terlalu ketat: keduanya harus terpenuhi
        # sekaligus, sehingga banyak kejatuhan nyata lolos tanpa terdeteksi.
        "fall_thr":    ambang["fall_thr"],
        "fall_angle":  ambang["fall_angle"],
        "fall_speed":  ambang["fall_speed"],
        "fall_confirm": True,
        "fall_joints": fall_joints,
        # MERL classes: 0=background,1=reach,2=retract,3=hand_in_shelf,4=inspect_product,5=inspect_shelf
        # Ambil dari config model, JANGAN di-hardcode. Kepala Interaksi.ipynb
        # menetapkan INSPECT_IDX = [4, 5] ("aksi yang penting utk butuh bantuan")
        # dan menyimpannya ke interaction_head.json. Nilai [1, 3, 4, 5] yang
        # dipakai sebelumnya ikut memasukkan kelas 1 = "reach" — mengambil barang
        # dari rak adalah belanja normal, bukan tanda seseorang butuh bantuan,
        # sehingga deteksi jadi jauh lebih berisik daripada yang dimaksud tim.
        "inspect_idx": _state["inter_cfg"].get("inspect_idx", [4, 5]),
        # Untuk kamera rak: 1 window cukup (is_dwell di-skip, false positive rendah)
        # Untuk kamera lorong: butuh 2 window berturut (tanpa dwell skip)
        # Minimal jendela berturut sebelum dianggap kejadian. Satu jendela
        # cukup untuk kedipan model; "butuh bantuan" secara konsep berarti
        # seseorang menimbang produk BEBERAPA SAAT, bukan sekilas menoleh.
        # Kepala Interaksi.ipynb memakai 3; di sini 2 sebagai kompromi, karena
        # jendela di web bergeser 1 detik (stride 15 @ 15fps) sehingga 2 jendela
        # sudah berarti aktivitas bertahan sekitar 2 detik.
        "help_min_win": 2,
        # Geometri diam/dwell — top-down: skip sepenuhnya (lihat analyze.py skip_dwell)
        "dwell_ratio": 3.0 if camera_type == "rak" else 0.4,
        # Pipeline normalisasi
        "target_fps": 15,
        "window": 45,
        "stride": 15,
        # ── Angkat tangan minta bantuan (aturan, lihat pipeline/gestures.py) ─
        "angkat_aktif": angkat_aktif,
        "angkat_min_durasi": (angkat_min_durasi
                              if angkat_min_durasi is not None
                              else GESTUR_DEFAULT["angkat_min_durasi"]),
        "angkat_maks_gerak": (angkat_maks_gerak
                              if angkat_maks_gerak is not None
                              else GESTUR_DEFAULT["angkat_maks_gerak"]),
        # ── Exclude pegawai via seragam (lihat pipeline/uniform.py) ──────────
        # CATATAN CAKUPAN: hanya memengaruhi butuh-bantuan, bukan jatuh.
        "seragam_aktif": bool(seragam_aktif and daftar_seragam),
        "seragam_ambang": (seragam_ambang
                           if seragam_ambang is not None
                           else UNI.DEFAULT["seragam_ambang"]),
        "daftar_seragam": daftar_seragam,
        # Ekstraksi — filter false positive kamera sudut
        "min_track_frames": 10,
        "det_conf": 0.45,
        "min_bbox_ratio": 0.005 if camera_type == "rak" else 0.01,
        "min_kp_conf": 0.25,
        "min_visible_kp": 6,    # minimal 6 joint visible untuk bukan ghost
    }


    output_filename = f"{stem}_{uid}_anotasi.mp4"
    output_path = OUTPUTS_DIR / output_filename

    try:
        logger.info(f"Mulai analisis [{camera_type}]: {upload_path.name}")

        # Tentukan mode berdasarkan model yang tersedia
        effective_run_fall = run_fall and _state["fall_model"] is not None
        effective_run_inter = run_interaction and _state["inter_model"] is not None

        if not effective_run_fall and run_fall:
            logger.warning("fall_head.pt tidak tersedia — deteksi jatuh dilewati.")
        if not effective_run_inter and run_interaction:
            logger.warning("interaction_head.pt tidak tersedia — deteksi interaksi dilewati.")

        # Analisis — camera_type menentukan kepala mana yg aktif (rak=no fall, lorong=no inter)
        result = analyze(
            str(upload_path),
            cfg,
            fall_model=_state["fall_model"] if effective_run_fall else None,
            inter_model=_state["inter_model"] if effective_run_inter else None,
            camera_type=camera_type,
        )


        # Render video beranotasi
        render(str(upload_path), result, str(output_path), camera_type=camera_type)


        # Hitung ringkasan
        n_jatuh = sum(1 for e in result["timeline"] if e["tipe"] == "jatuh")
        n_bantuan = sum(1 for e in result["timeline"] if e["tipe"] == "butuh_bantuan")
        n_angkat = sum(1 for e in result["timeline"]
                       if e["tipe"] == "butuh_bantuan" and e.get("sinyal") == "aktif")

        logger.info(f"Selesai: {n_jatuh} jatuh, {n_bantuan} butuh_bantuan → {output_filename}")

        return JSONResponse({
            "video": filename,
            "fps": result["src_fps"],
            "timeline": result["timeline"],
            "annotated_video_url": f"/outputs/{output_filename}",
            "model_mode": {
                "fall": effective_run_fall,
                "interaction": effective_run_inter,
            },
            "summary": {
                "jatuh": n_jatuh,
                "butuh_bantuan": n_bantuan,
                "angkat_tangan": n_angkat,
                "bantuan_pasif": n_bantuan - n_angkat,
                "total_track": len(set(e["track_id"] for e in result["timeline"])),
            },
            # Untuk panel Setting: ambang yang dipakai + fitur per jendela,
            # supaya frontend bisa minta /api/rethreshold tanpa unggah ulang.
            "ambang": ambang,
            "fall_cache": result.get("fall_cache", []),
        })

    except Exception as e:
        logger.exception(f"Error saat menganalisis {upload_path.name}: {e}")
        # Hapus output yang mungkin setengah jadi
        if output_path.exists():
            output_path.unlink()
        raise HTTPException(status_code=500, detail=f"Analisis gagal: {str(e)}")

    finally:
        # Selalu hapus file upload setelah selesai
        if upload_path.exists():
            upload_path.unlink()
