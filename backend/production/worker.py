"""
production/worker.py — SAPA Produksi

Satu pekerja per kamera: baca frame → pose + tracking → jendela → dua kepala +
geometri → ajukan ke mesin alert. Berjalan di thread sendiri, selamanya.

Inti AI TIDAK dibangun ulang. Modul ini memanggil pipeline yang sama persis
dengan mode unggah:
    pipeline.normalize.build_windows_for_heads()   ← normalisasi identik training
    pipeline.models.predict_proba()
    pipeline.geometry.window_torso_angle() / is_dwell()

SATU INSTANCE YOLO PER KAMERA — INI DISENGAJA
---------------------------------------------
Ultralytics menyimpan state ByteTrack DI DALAM objek model (model.predictor.trackers).
Membagi satu objek YOLO ke beberapa kamera membuat state tracker mereka saling
menimpa: ID orang di kamera A tiba-tiba dipakai ulang untuk orang di kamera B,
dan buffer per-orang berisi campuran dua manusia berbeda. Karena itu setiap
pekerja memuat instance-nya sendiri. Biayanya kecil (yolov8n-pose ~7 MB) dan
harganya jauh lebih murah daripada alert yang salah orang.

INI JUGA MEMPERBAIKI CACAT MODE LIVE LAMA
-----------------------------------------
live_server.py memakai model.predict() (bukan .track()), sehingga "track_id"
sebenarnya hanya INDEKS DETEKSI dalam frame — angka yang berubah setiap kali
urutan deteksi bergeser. Buffer per-orang karenanya mencampur orang yang berbeda
dan sekuens gerak yang dianalisis tidak pernah benar-benar milik satu manusia.
Di sini dipakai .track(persist=True) sehingga ID benar-benar melekat pada orang.
"""

# threading.Lock adalah factory function, bukan kelas, sehingga anotasi seperti
# `threading.Lock | None` gagal dievaluasi saat impor. Menunda evaluasi anotasi
# menghindarkan seluruh kelas kesalahan ini.
from __future__ import annotations

import logging
import threading
import time

import cv2
import numpy as np
import torch

from pipeline import thresholds as TH
from pipeline.geometry import is_dwell, window_torso_angle, window_torso_speed
from pipeline.models import predict_proba
from pipeline.normalize import build_windows_for_heads
from pipeline.render import (
    COLOR_FALL,
    COLOR_HELP,
    COLOR_NORMAL,
    _draw_label,
    _draw_skeleton,
)

from .alerts import AlertEngine
from .buffer import TrackWindowBuffer
from .profiles import CameraProfile
from .stream import FrameGrabber

logger = logging.getLogger(__name__)

# Indeks kelas "jatuh" pada keluaran Kepala Jatuh (0=normal, 1=oleng, 2=jatuh)
_IDX_JATUH = 2

# Laju resample tujuan — HARUS sama dengan saat training (lihat fall_head.json fps=15)
_FPS_TUJUAN = 15.0
_JENDELA_FRAME = 45

# Pembuatan objek YOLO diserialkan: saat pertama kali jalan, ultralytics mengunduh
# bobot. Beberapa kamera yang start bersamaan bisa mengunduh ke berkas yang sama
# dan saling merusak.
_kunci_muat_yolo = threading.Lock()


def muat_yolo():
    """
    Buat instance YOLOv8-pose baru dengan state tracker sendiri.

    Dipakai pekerja kamera dan juga mode live browser — keduanya butuh state
    ByteTrack terpisah per sumber video.
    """
    from ultralytics import YOLO
    with _kunci_muat_yolo:
        return YOLO("yolov8n-pose.pt")


class CameraWorker(threading.Thread):
    """Pekerja satu kamera. Buat lewat CameraManager, jangan langsung."""

    def __init__(
        self,
        profil: CameraProfile,
        mesin_alert: AlertEngine,
        fall_model=None,
        inter_model=None,
        kunci_inferensi: threading.Lock | None = None,
    ):
        super().__init__(name=f"kamera-{profil.id}", daemon=True)
        self.profil = profil
        self.alert = mesin_alert
        self.fall_model = fall_model
        self.inter_model = inter_model
        # Dua kepala BiLSTM dibagi ke semua pekerja. Inferensinya sangat murah
        # (~0,12 ms per jendela) sehingga menyerialkannya tidak mengurangi
        # throughput, tapi menghilangkan seluruh kelas bug konkurensi torch.
        self._kunci_inferensi = kunci_inferensi or threading.Lock()

        # JANGAN dinamai self._stop: threading.Thread sudah punya method internal
        # _stop() yang dipanggil join() lewat _wait_for_tstate_lock(). Menimpanya
        # dengan Event membuat setiap join() melempar
        # "TypeError: 'Event' object is not callable" saat thread selesai.
        self._henti = threading.Event()
        self._yolo = None

        self._grabber = FrameGrabber(
            sumber=profil.sumber,
            nama=profil.id,
            target_fps=profil.process_fps,
            reconnect_delay=profil.reconnect_delay,
            reconnect_max_delay=profil.reconnect_max_delay,
        )

        self._buffer = TrackWindowBuffer(
            window_seconds=profil.window_seconds,
            stride_seconds=profil.stride_seconds,
            max_gap_seconds=profil.max_gap_seconds,
            track_ttl_seconds=profil.track_ttl_seconds,
            min_frames=profil.min_frames_per_window,
        )

        # Pratinjau — hanya digambar bila ada yang menonton (lihat _gambar_pratinjau)
        self._kunci_pratinjau = threading.Lock()
        self._pratinjau: np.ndarray | None = None
        self._penonton = 0

        # {track_id: (tipe, t_kedaluwarsa)} — mewarnai kerangka di pratinjau
        self._sorot: dict[int, tuple[str, float]] = {}

        # Statistik
        self._t_mulai: float | None = None
        self._n_frame = 0
        self._n_jendela = 0
        self._n_alert = 0
        self._error_terakhir: str | None = None
        self._t_frame_terakhir: float = 0.0

    # ── Siklus hidup ──────────────────────────────────────────────────────────
    def stop(self, timeout: float = 10.0) -> None:
        self._henti.set()
        self._grabber.stop()
        if self.is_alive():
            self.join(timeout=timeout)

    def run(self) -> None:
        logger.info(
            f"[kamera:{self.profil.id}] Mulai — jenis={self.profil.jenis} "
            f"sumber={self.profil.sumber_aman()} "
            f"fall={'ON' if self._fall_aktif() else 'off'} "
            f"interaksi={'ON' if self._inter_aktif() else 'off'}"
        )
        self._t_mulai = time.time()

        try:
            self._yolo = muat_yolo()
        except Exception as e:
            self._error_terakhir = f"gagal memuat YOLO: {e}"
            logger.error(f"[kamera:{self.profil.id}] {self._error_terakhir}")
            return

        self._grabber.start()

        seq_terakhir = -1
        t_rawat_terakhir = time.monotonic()

        while not self._henti.is_set():
            hasil = self._grabber.read_baru(seq_terakhir)
            if hasil is None:
                # Belum ada frame baru — tidur singkat agar tidak spin.
                if self._henti.wait(0.02):
                    break
                continue

            frame, t_mono, seq_terakhir = hasil
            self._n_frame += 1
            self._t_frame_terakhir = t_mono

            try:
                deteksi = self._pose_dan_track(frame)
            except Exception as e:
                self._error_terakhir = f"pose/track: {e}"
                logger.warning(f"[kamera:{self.profil.id}] Gagal ekstraksi pose: {e}")
                continue

            for tid, kps in deteksi.items():
                self._buffer.push(tid, kps, t_mono)

            for jendela in self._buffer.jendela_siap():
                try:
                    self._proses_jendela(jendela)
                except Exception as e:
                    self._error_terakhir = f"inferensi: {e}"
                    logger.warning(
                        f"[kamera:{self.profil.id}] Inferensi gagal "
                        f"track={jendela.track_id}: {e}"
                    )

            self._gambar_pratinjau(frame, deteksi)

            # Perawatan berkala — buang track mati & state debounce basi.
            sekarang = time.monotonic()
            if sekarang - t_rawat_terakhir >= 10.0:
                self._buffer.bersihkan(sekarang)
                self._bersihkan_sorot()
                t_rawat_terakhir = sekarang

        self._grabber.stop()
        self.alert.lupakan_kamera(self.profil.id)
        logger.info(f"[kamera:{self.profil.id}] Berhenti.")

    # ── Pose + tracking ───────────────────────────────────────────────────────
    def _pose_dan_track(self, frame: np.ndarray) -> dict[int, np.ndarray]:
        """
        Jalankan YOLOv8-pose dengan ByteTrack dan kembalikan {track_id: [17,3]}.

        Filter kualitas di sini menyalin semantik pipeline/extract.py agar
        perilaku produksi dan MVP tidak menyimpang: deteksi kecil di sudut,
        bayangan, dan kerangka "hantu" harus dibuang sebelum masuk buffer,
        karena satu deteksi palsu yang bertahan beberapa detik cukup untuk
        memicu alert.
        """
        p = self.profil
        h, w = frame.shape[:2]
        luas_frame = float(h * w)
        luas_min = luas_frame * p.min_bbox_ratio

        hasil = self._yolo.track(
            frame,
            persist=True,          # ← pertahankan ID antar frame (inti tracking)
            tracker="bytetrack.yaml",
            conf=p.det_conf,
            verbose=False,
        )[0]

        keluaran: dict[int, np.ndarray] = {}

        if hasil.keypoints is None or hasil.keypoints.data is None:
            return keluaran

        kps_data = hasil.keypoints.data     # [N,17,3]
        boxes = hasil.boxes

        for i in range(len(kps_data)):
            # Tanpa ID dari tracker, sampel tidak bisa dikaitkan ke orang tertentu
            # antar frame — lebih baik dibuang daripada mencemari buffer.
            if boxes is None or boxes.id is None or i >= len(boxes.id):
                continue
            track_id = int(boxes.id[i].item())

            if boxes.conf is not None and i < len(boxes.conf):
                if float(boxes.conf[i].item()) < p.det_conf:
                    continue

            if boxes.xywh is not None and i < len(boxes.xywh):
                bw = float(boxes.xywh[i][2].item())
                bh = float(boxes.xywh[i][3].item())
                if bw * bh < luas_min:
                    continue

            kps = kps_data[i].cpu().numpy().astype(np.float32)
            if kps.shape != (17, 3):
                continue

            terlihat = kps[:, 2][kps[:, 2] > 0.1]
            if len(terlihat) == 0 or float(terlihat.mean()) < p.min_kp_conf:
                continue

            if int(np.sum(kps[:, 2] > 0.20)) < p.min_visible_kp:
                continue

            keluaran[track_id] = kps

        return keluaran

    # ── Inferensi satu jendela ────────────────────────────────────────────────
    def _fall_aktif(self) -> bool:
        return self.profil.run_fall and self.fall_model is not None

    def _inter_aktif(self) -> bool:
        return self.profil.run_interaction and self.inter_model is not None

    @staticmethod
    def _ke_epoch(t_mono: float) -> float:
        """Ubah stempel monotonic menjadi epoch untuk log kejadian."""
        return time.time() - (time.monotonic() - t_mono)

    def _proses_jendela(self, jendela) -> None:
        p = self.profil
        if not self._fall_aktif() and not self._inter_aktif():
            return

        # Normalisasi + resample + window — IDENTIK dengan jalur training/MVP.
        # src_fps memakai laju NYATA jendela ini (dihitung dari stempel waktu),
        # bukan angka tetap, sehingga hasil resample benar-benar 3 detik @15fps.
        masukan = build_windows_for_heads(
            jendela.frames,
            src_fps=jendela.src_fps,
            window=_JENDELA_FRAME,
            stride=_JENDELA_FRAME,
            dst_fps=_FPS_TUJUAN,
        )
        raw_windows = masukan["raw_windows"]
        if raw_windows.shape[0] == 0:
            return

        # Buffer memotong tepat window_seconds, jadi biasanya hanya ada satu
        # jendela. Ambil yang TERAKHIR — bila pembulatan resample menghasilkan
        # lebih dari satu, yang terakhir adalah yang paling baru.
        raw = raw_windows[-1]

        t0 = self._ke_epoch(jendela.t_mulai)
        t1 = self._ke_epoch(jendela.t_selesai)
        self._n_jendela += 1

        # ── Kepala Jatuh — hanya kamera lorong (profiles.py menegakkan ini) ───
        if self._fall_aktif():
            x = torch.from_numpy(masukan["fall_input"][-1:])   # [1,45,24]
            with self._kunci_inferensi:
                proba = predict_proba(self.fall_model, x).cpu().numpy()
            skor = float(proba[0, _IDX_JATUH])

            # Konfirmasi geometri dari koordinat MENTAH (bukan yang dinormalisasi).
            # Aturan gabungan dipusatkan di thresholds.is_fall() agar mode
            # produksi, mode live, dan jalur unggah-klip memutuskan dengan
            # logika yang sama persis.
            sudut = window_torso_angle(raw)
            kecepatan = window_torso_speed(raw, fps=15.0)
            if TH.is_fall(skor, sudut, kecepatan,
                          p.fall_thr, p.fall_angle, getattr(p, "fall_speed", 0.0)):
                self._ajukan(
                    "jatuh", jendela.track_id, skor, t0, t1,
                    {"sudut_torso": round(sudut, 1),
                     "kecepatan": round(kecepatan, 2),
                     "src_fps": round(jendela.src_fps, 1),
                     "n_frame": jendela.n_frames},
                )

        # ── Kepala Interaksi — hanya kamera rak ───────────────────────────────
        if self._inter_aktif():
            x = torch.from_numpy(masukan["interaction_input"][-1:])   # [1,45,51]
            with self._kunci_inferensi:
                proba = predict_proba(self.inter_model, x).cpu().numpy()
            skor = float(sum(proba[0, i] for i in p.inspect_idx))

            if skor >= p.inspect_thr:
                diam = p.skip_dwell or is_dwell(raw, p.dwell_ratio)
                if diam:
                    self._ajukan(
                        "butuh_bantuan", jendela.track_id, skor, t0, t1,
                        {"dwell": bool(diam),
                         "src_fps": round(jendela.src_fps, 1),
                         "n_frame": jendela.n_frames},
                    )

    def _ajukan(self, tipe, track_id, skor, t0, t1, detail) -> None:
        p = self.profil
        # Sorot kerangka di pratinjau meski alert-nya nanti ditekan debounce —
        # operator tetap perlu melihat apa yang sedang dinilai sistem.
        self._sorot[track_id] = (tipe, time.monotonic() + 3.0)

        kejadian = self.alert.ajukan(
            kamera_id=p.id,
            kamera_nama=p.nama,
            tipe=tipe,
            track_id=track_id,
            skor=skor,
            confirm_windows=p.confirm_windows,
            cooldown_seconds=p.cooldown_seconds,
            detail=detail,
            t_mulai=t0,
            t_selesai=t1,
        )
        if kejadian is not None:
            self._n_alert += 1

    def _bersihkan_sorot(self) -> None:
        sekarang = time.monotonic()
        for tid in [t for t, (_, exp) in self._sorot.items() if exp < sekarang]:
            self._sorot.pop(tid, None)

    # ── Pratinjau (privasi: lihat KONTEKS §7) ─────────────────────────────────
    def tambah_penonton(self) -> None:
        with self._kunci_pratinjau:
            self._penonton += 1

    def kurangi_penonton(self) -> None:
        with self._kunci_pratinjau:
            self._penonton = max(0, self._penonton - 1)
            if self._penonton == 0:
                self._pratinjau = None

    def _gambar_pratinjau(self, frame: np.ndarray, deteksi: dict) -> None:
        """
        Siapkan frame pratinjau — HANYA bila ada yang menonton.

        Mode "kerangka" (default) menggambar sendi di atas kanvas hitam: operator
        bisa memverifikasi kamera bekerja dan alert masuk akal, tanpa video wajah
        pelanggan pernah meninggalkan proses ini. Mode "video" disediakan untuk
        kalibrasi pemasangan dan sebaiknya dimatikan lagi setelah selesai.
        """
        if self.profil.preview == "mati":
            return
        with self._kunci_pratinjau:
            if self._penonton <= 0:
                return

        topdown = self.profil.jenis == "rak"

        if self.profil.preview == "kerangka":
            kanvas = np.zeros_like(frame)
        else:
            kanvas = frame.copy()

        sekarang = time.monotonic()
        for tid, kps in deteksi.items():
            warna = COLOR_NORMAL
            sorot = self._sorot.get(tid)
            if sorot and sorot[1] > sekarang:
                warna = COLOR_FALL if sorot[0] == "jatuh" else COLOR_HELP

            _draw_skeleton(kanvas, kps, warna, thickness=2, topdown=topdown)

            terlihat = kps[kps[:, 2] > 0.3]
            if len(terlihat) > 0:
                x = int(np.clip(terlihat[:, 0].min(), 0, kanvas.shape[1] - 60))
                y = int(np.clip(terlihat[:, 1].min() - 10, 20, kanvas.shape[0] - 10))
                _draw_label(kanvas, f"#{tid}", x, y, warna)

        _draw_label(
            kanvas,
            f"{self.profil.nama} [{self.profil.jenis}]",
            10, kanvas.shape[0] - 12, COLOR_NORMAL,
        )

        with self._kunci_pratinjau:
            self._pratinjau = kanvas

    def pratinjau_jpeg(self) -> bytes | None:
        """Encode pratinjau terakhir ke JPEG. None bila belum ada."""
        with self._kunci_pratinjau:
            kanvas = None if self._pratinjau is None else self._pratinjau.copy()
        if kanvas is None:
            return None
        ok, buf = cv2.imencode(".jpg", kanvas, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
        return buf.tobytes() if ok else None

    # ── Kesehatan ─────────────────────────────────────────────────────────────
    def kesehatan(self) -> dict:
        return {
            "kamera_id": self.profil.id,
            "nama": self.profil.nama,
            "jenis": self.profil.jenis,
            "berjalan": self.is_alive() and not self._henti.is_set(),
            "sumber": self.profil.sumber_aman(),
            "fall_aktif": self._fall_aktif(),
            "interaksi_aktif": self._inter_aktif(),
            "frame_diproses": self._n_frame,
            "jendela_diinferensi": self._n_jendela,
            "alert_dikeluarkan": self._n_alert,
            "uptime_detik": (
                round(time.time() - self._t_mulai, 1) if self._t_mulai else None
            ),
            "error_terakhir": self._error_terakhir,
            "stream": self._grabber.kesehatan(),
            "buffer": self._buffer.statistik(),
        }
