"""
production/profiles.py — SAPA Produksi

Profil kamera: satu entri per kamera CCTV terpasang.

KONTEKS §5 (KRUSIAL) — pencocokan fitur ke sudut kamera:
  jenis = "lorong"  kamera samping/miring  → Kepala Jatuh AKTIF,     Interaksi MATI
  jenis = "rak"     kamera top-down di rak → Kepala Interaksi AKTIF, Jatuh MATI

Dari sudut tepat-atas, berdiri vs berbaring nyaris tak terbedakan dan sudut torso
terbaca ≈90° secara permanen — Kepala Jatuh di kamera "rak" akan menyala terus.
Karena itu pemetaan fitur→kamera DITEGAKKAN di sini lewat properti `run_fall` /
`run_interaction`, bukan diserahkan sebagai opsi yang bisa dinyalakan operator.

Ambang default juga berbeda per jenis, mengikuti temuan MVP di app.py/analyze.py:
top-down membuat torso terkompresi perspektif sehingga is_dwell tidak dapat
diandalkan → untuk kamera rak, dwell dilewati dan digantikan syarat jendela
berturut yang lebih ketat.
"""

import json
import logging
import threading
from dataclasses import dataclass, field, asdict
from pathlib import Path

from pipeline import thresholds as TH

logger = logging.getLogger(__name__)

JENIS_LORONG = "lorong"
JENIS_RAK = "rak"
JENIS_VALID = (JENIS_LORONG, JENIS_RAK)

PREVIEW_VALID = ("kerangka", "video", "mati")

# Default yang berbeda per jenis kamera. Nilai yang tidak disebut di sini
# memakai default dataclass di bawah.
_DEFAULT_PER_JENIS: dict[str, dict] = {
    JENIS_LORONG: {
        # Kamera samping: is_dwell dapat dipercaya, torso terlihat penuh.
        "dwell_ratio": 0.4,
        "skip_dwell": False,
        "min_bbox_ratio": 0.01,
        # Jatuh = darurat → konfirmasi 1 jendela saja, kecepatan diutamakan.
        "confirm_windows": 1,
        "cooldown_seconds": 30.0,
    },
    JENIS_RAK: {
        # Top-down: torso terkompresi → is_dwell tidak andal, dilewati.
        "dwell_ratio": 3.0,
        "skip_dwell": True,
        # Orang terlihat lebih kecil dari atas.
        "min_bbox_ratio": 0.005,
        # "Butuh bantuan" tidak mendesak → minta 2 jendela berturut agar tidak berisik.
        "confirm_windows": 2,
        "cooldown_seconds": 90.0,
    },
}


@dataclass
class CameraProfile:
    """Konfigurasi satu kamera CCTV."""

    id: str
    nama: str
    sumber: str                      # "rtsp://user:pass@ip:554/stream" | "0" (webcam) | path file
    jenis: str = JENIS_LORONG
    lokasi: str = ""                 # keterangan bebas, mis. "Lorong 3 — Minuman"
    aktif: bool = True               # ikut dijalankan saat sistem start

    # ── Laju proses ───────────────────────────────────────────────────────────
    # Frame/detik yang BENAR-BENAR diinferensi (bukan fps kamera). Frame lain
    # di-grab lalu dibuang tanpa decode — lihat stream.py.
    process_fps: float = 8.0

    # ── Jendela analisis — dalam DETIK, bukan jumlah frame ────────────────────
    # Kepala BiLSTM dilatih pada jendela 3 detik @15fps (45 frame). Di produksi
    # laju frame nyata tidak pernah tepat 15fps, jadi jendela didefinisikan dalam
    # detik lalu di-resample ke 45×15fps oleh build_windows_for_heads().
    window_seconds: float = 3.0
    stride_seconds: float = 1.0
    max_gap_seconds: float = 1.0     # jeda pose > ini → sekuens dianggap terputus
    track_ttl_seconds: float = 5.0   # track tak terlihat selama ini → dilupakan

    # ── Ambang Kepala Jatuh (dipakai bila jenis="lorong") ─────────────────────
    # Default mengikuti hasil sweep di pipeline/thresholds.py — sengaja tidak
    # di-hardcode ulang agar profil kamera produksi tidak menyimpang dari
    # jalur unggah-klip. fall_speed=0 berarti syarat kecepatan dimatikan.
    fall_thr: float = TH.FALL_THR_DEFAULT
    fall_angle: float = TH.FALL_ANGLE_DEFAULT
    fall_speed: float = TH.FALL_SPEED_DEFAULT

    # ── Ambang Kepala Interaksi (dipakai bila jenis="rak") ────────────────────
    inspect_thr: float = 0.40
    inspect_idx: list = field(default_factory=lambda: [3, 4, 5])
    dwell_ratio: float = 0.4
    skip_dwell: bool = False

    # ── Filter kualitas deteksi (semantik sama dengan pipeline/extract.py) ────
    det_conf: float = 0.45
    min_bbox_ratio: float = 0.01
    min_kp_conf: float = 0.25
    min_visible_kp: int = 6

    # ── Debounce alert (KONTEKS §6 — satu kejadian ≠ 10 notifikasi) ───────────
    confirm_windows: int = 1
    cooldown_seconds: float = 30.0

    # ── Privasi (KONTEKS §7) ──────────────────────────────────────────────────
    # "kerangka" = dashboard hanya menerima kerangka di atas kanvas hitam;
    #              video mentah tidak pernah meninggalkan proses ini.
    # "video"    = pratinjau video beranotasi (khusus setup/kalibrasi).
    # "mati"     = tanpa pratinjau sama sekali (paling hemat & paling privat).
    preview: str = "kerangka"

    # ── Ketahanan koneksi ─────────────────────────────────────────────────────
    reconnect_delay: float = 2.0
    reconnect_max_delay: float = 30.0

    def __post_init__(self):
        if self.jenis not in JENIS_VALID:
            raise ValueError(
                f"jenis kamera '{self.jenis}' tidak dikenal — pilih {JENIS_VALID}"
            )
        if self.preview not in PREVIEW_VALID:
            raise ValueError(
                f"preview '{self.preview}' tidak dikenal — pilih {PREVIEW_VALID}"
            )
        if self.process_fps <= 0:
            raise ValueError("process_fps harus > 0")
        if self.window_seconds <= 0:
            raise ValueError("window_seconds harus > 0")
        if self.stride_seconds <= 0:
            raise ValueError("stride_seconds harus > 0")
        if self.confirm_windows < 1:
            raise ValueError("confirm_windows minimal 1")
        self.id = str(self.id).strip()
        if not self.id:
            raise ValueError("id kamera tidak boleh kosong")

    # ── Pemetaan fitur → sudut kamera (DITEGAKKAN, lihat docstring modul) ─────
    @property
    def run_fall(self) -> bool:
        """Kepala Jatuh hanya untuk kamera samping/miring."""
        return self.jenis == JENIS_LORONG

    @property
    def run_interaction(self) -> bool:
        """Kepala Interaksi hanya untuk kamera rak top-down."""
        return self.jenis == JENIS_RAK

    @property
    def min_frames_per_window(self) -> int:
        """
        Minimum sampel pose dalam satu jendela agar layak diinferensi.
        Setengah dari jumlah ideal — mentoleransi occlusion sesaat tanpa
        meloloskan jendela yang isinya cuma 2-3 titik.
        """
        ideal = self.window_seconds * self.process_fps
        return max(4, int(ideal * 0.5))

    def to_dict(self) -> dict:
        d = asdict(self)
        # Turunan — memudahkan dashboard tanpa menduplikasi aturan di frontend.
        d["run_fall"] = self.run_fall
        d["run_interaction"] = self.run_interaction
        return d

    def sumber_aman(self) -> str:
        """
        Sumber dengan kredensial disamarkan — untuk log dan tampilan dashboard.
        URL RTSP sering memuat user:password; itu tidak boleh bocor ke log.
        """
        s = self.sumber
        if "://" not in s or "@" not in s:
            return s
        skema, sisa = s.split("://", 1)
        kredensial, host = sisa.rsplit("@", 1)
        user = kredensial.split(":", 1)[0]
        return f"{skema}://{user}:***@{host}"

    @classmethod
    def from_dict(cls, data: dict) -> "CameraProfile":
        """
        Bangun profil dari dict, dengan default yang bergantung jenis kamera.
        Urutan: default dataclass → default per jenis → nilai eksplisit user.
        """
        data = dict(data)
        jenis = data.get("jenis", JENIS_LORONG)
        if jenis not in JENIS_VALID:
            raise ValueError(f"jenis kamera '{jenis}' tidak dikenal — pilih {JENIS_VALID}")

        gabung: dict = dict(_DEFAULT_PER_JENIS.get(jenis, {}))
        gabung.update({k: v for k, v in data.items() if v is not None})

        # Buang kunci turunan agar tidak ditolak konstruktor.
        for turunan in ("run_fall", "run_interaction"):
            gabung.pop(turunan, None)

        dikenal = {f for f in cls.__dataclass_fields__}
        tidak_dikenal = set(gabung) - dikenal
        if tidak_dikenal:
            raise ValueError(f"field profil tidak dikenal: {sorted(tidak_dikenal)}")

        return cls(**gabung)


class ProfileStore:
    """
    Penyimpan profil kamera berbasis satu berkas JSON.

    Sengaja tanpa database: satu toko biasanya punya <20 kamera, dan berkas JSON
    bisa diedit tangan saat pemasangan lapangan tanpa perlu tooling.
    Aman dipakai dari banyak thread (satu lock, tulis atomik via rename).
    """

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self._lock = threading.RLock()
        self._profiles: dict[str, CameraProfile] = {}
        self.muat()

    def muat(self) -> None:
        """Baca berkas profil. Berkas hilang = daftar kosong (bukan error)."""
        with self._lock:
            if not self.path.exists():
                logger.info(f"[profil] {self.path.name} belum ada — mulai dengan daftar kosong.")
                self._profiles = {}
                return
            try:
                data = json.loads(self.path.read_text(encoding="utf-8"))
            except Exception as e:
                logger.error(f"[profil] Gagal baca {self.path}: {e}")
                self._profiles = {}
                return

            entri = data.get("kamera", data) if isinstance(data, dict) else data
            hasil: dict[str, CameraProfile] = {}
            for item in entri:
                try:
                    p = CameraProfile.from_dict(item)
                    hasil[p.id] = p
                except Exception as e:
                    logger.error(f"[profil] Entri dilewati ({item.get('id', '?')}): {e}")
            self._profiles = hasil
            logger.info(f"[profil] {len(hasil)} kamera dimuat dari {self.path.name}.")

    def simpan(self) -> None:
        """Tulis atomik: tulis ke .tmp lalu rename, agar tidak korup saat mati listrik."""
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            isi = {"kamera": [p.to_dict() for p in self._profiles.values()]}
            tmp = self.path.with_suffix(self.path.suffix + ".tmp")
            tmp.write_text(json.dumps(isi, indent=2, ensure_ascii=False), encoding="utf-8")
            tmp.replace(self.path)

    def semua(self) -> list[CameraProfile]:
        with self._lock:
            return list(self._profiles.values())

    def ambil(self, camera_id: str) -> CameraProfile | None:
        with self._lock:
            return self._profiles.get(camera_id)

    def tambah(self, profil: CameraProfile) -> CameraProfile:
        with self._lock:
            if profil.id in self._profiles:
                raise ValueError(f"kamera '{profil.id}' sudah ada")
            self._profiles[profil.id] = profil
            self.simpan()
            return profil

    def perbarui(self, camera_id: str, perubahan: dict) -> CameraProfile:
        with self._lock:
            lama = self._profiles.get(camera_id)
            if lama is None:
                raise KeyError(camera_id)
            data = lama.to_dict()

            # Jika JENIS kamera berubah, ambang yang bergantung jenis harus ikut
            # kembali ke default jenis baru — kecuali operator menyetelnya sendiri
            # dalam permintaan yang sama. Tanpa ini, kamera lorong yang diubah
            # menjadi "rak" akan tetap memakai skip_dwell=False dan gagal total.
            jenis_baru = perubahan.get("jenis", lama.jenis)
            if jenis_baru != lama.jenis:
                for kunci in _DEFAULT_PER_JENIS.get(lama.jenis, {}):
                    if kunci not in perubahan:
                        data.pop(kunci, None)

            data.update(perubahan)
            data["id"] = camera_id          # id tidak boleh berubah lewat update
            baru = CameraProfile.from_dict(data)
            self._profiles[camera_id] = baru
            self.simpan()
            return baru

    def hapus(self, camera_id: str) -> None:
        with self._lock:
            if camera_id not in self._profiles:
                raise KeyError(camera_id)
            del self._profiles[camera_id]
            self.simpan()
