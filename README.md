# SAPA — Safety and Assistance through Pose Analytics

> **"Melihat Kebutuhan, Bukan Wajah."**

Sistem analitik toko berbasis CCTV yang mendeteksi pelanggan yang **tampak butuh bantuan** dan kejadian **jatuh** — hanya dari pose/kerangka gerak tubuh (koordinat sendi), **bukan wajah, bukan identitas** (privacy-by-design).

Proyek untuk lomba **AI Innovation Challenge COMPFEST 18**.

---

## Cara Menjalankan (Docker Compose)

### Prasyarat
- [Docker Desktop](https://www.docker.com/products/docker-desktop) terinstal dan berjalan
- File bobot model dari tim (lihat bagian **Menyiapkan Bobot Model** di bawah)

### 1. Clone / unduh repo
```bash
git clone <url-repo> sapa
cd sapa
```

### 2. Siapkan bobot model

Taruh 4 file berikut ke folder `backend/models/`:

```
backend/models/
├── fall_head.pt             ← bobot Kepala Jatuh (dari tim)
├── fall_head.json           ← config Kepala Jatuh (sudah tersedia di repo)
├── interaction_head.pt      ← bobot Kepala Interaksi (dari tim)
└── interaction_head.json    ← config Kepala Interaksi (sudah tersedia di repo)
```

> **Catatan:** `yolov8n-pose.pt` akan **otomatis diunduh** oleh `ultralytics` saat pertama kali server dijalankan. Pastikan koneksi internet tersedia saat pertama build/run.

Jika file `.pt` belum tersedia, sistem tetap bisa berjalan dalam **mode stub** — YOLO tetap mengekstrak pose, tapi hasil klasifikasi acak (tidak bermakna). Mode ini berguna untuk pengujian UI.

### 3. Jalankan

```bash
docker compose up --build
```

Tunggu hingga log backend menampilkan:
```
✅ Fall model berhasil dimuat.
✅ Interaction model berhasil dimuat.
INFO:     Application startup complete.
```

Buka browser: **http://localhost:5173**

---

## Cara Pakai

1. **Unggah klip video** (.mp4) via drag-and-drop atau klik tombol pilih file
2. **Pilih jenis kamera:**
   - 🏃 **Kamera Lorong** — kamera samping/depan, aktifkan deteksi jatuh
   - 🛒 **Kamera Rak (Atas)** — kamera top-down menghadap rak, aktifkan deteksi pelayanan
   - ⚙️ **Semua Fitur** — aktifkan keduanya (default)
3. Klik **"Analisis Sekarang"** — proses berjalan di server (sinkron)
4. Lihat **video beranotasi** + **timeline kejadian**
5. Klik item timeline untuk **melompat ke waktu kejadian** di video

---

## Catatan Sudut Kamera (Penting!)

| Jenis Kamera | Cocok Untuk | Tidak Cocok Untuk |
|---|---|---|
| Kamera lorong / samping | ✅ Deteksi jatuh | ❌ Deteksi interaksi rak |
| Kamera rak / top-down | ✅ Deteksi pelayanan | ❌ Deteksi jatuh |

**Kenapa?** Dari sudut tepat atas (top-down), pose berdiri dan pose berbaring sulit dibedakan oleh model yang dilatih dari kamera samping (NTU RGB+D). Gunakan flag jenis kamera yang sesuai untuk menghindari false-positive.

---

## Batasan MVP

Yang dinilai lomba adalah alur **unggah klip** di atas. Batasannya:

- ❌ Tidak ada login / akun pengguna
- ❌ Tidak ada riwayat analisis
- ❌ Tidak ada background job / queue
- ✅ Proses sinkron — satu video pada satu waktu
- ✅ Disarankan klip ≤ 2 menit untuk respons yang nyaman

Streaming CCTV real-time **sudah ada** sebagai mode terpisah dan dimatikan secara
default — lihat bagian berikut.

---

## Mode Produksi CCTV (opsional)

Selain MVP unggah-klip, repo ini berisi lapisan deployment untuk menjalankan SAPA
sebagai perangkat lunak CCTV 24/7: ingest RTSP multi-kamera, alert langsung ke staf,
dan log kejadian dengan retensi otomatis.

**Mode ini nonaktif secara default** agar perilaku submission lomba tidak berubah.
Aktifkan dengan satu env var:

```bash
cp backend/data/cameras.example.json backend/data/cameras.json
# edit cameras.json → isi URL RTSP dan jenis tiap kamera

SAPA_PRODUKSI=1 uvicorn app:app --port 8000
```

Lalu buka **http://localhost:5173/dashboard** untuk dashboard operator, atau
periksa langsung lewat API:
```bash
curl localhost:8000/produksi/kesehatan     # status tiap kamera
curl localhost:8000/produksi/kejadian      # log kejadian
```

**Inti AI-nya tidak dibangun ulang.** Lapisan ini memakai `pipeline/` yang sama
persis dengan mode unggah — bobot, normalisasi, dan ambang yang identik. Yang
ditambahkan murni infrastruktur.

📄 Panduan lengkap (pemasangan kamera, kalibrasi, privasi, kebutuhan hardware):
**[docs/PRODUKSI.md](docs/PRODUKSI.md)**

> ⚠️ Endpoint `/produksi/*` **tidak punya autentikasi**. Untuk pemasangan
> nyata, taruh di balik reverse proxy ber-auth di jaringan toko — jangan pernah
> diekspos langsung ke internet.

---

## Arsitektur Sistem

```
Browser (React/Vite @ :5173)
    │  multipart POST /api/analyze
    ▼
nginx (port 5173, Docker)
    │  reverse proxy /api → backend:8000
    ▼
FastAPI (port 8000, Docker)
    │
    ├─ YOLOv8n-pose  ──→  ekstraksi 17 titik sendi COCO per frame + tracking
    ├─ normalize.py  ──→  normalisasi pose (origin=hip, skala=torso)
    ├─ BiLSTM Fall   ──→  {normal, oleng, jatuh} per jendela 3 detik
    ├─ BiLSTM Inter  ──→  {background, reach, retract, hand_in_shelf, inspect_product, inspect_shelf}
    ├─ geometry.py   ──→  konfirmasi jatuh (sudut torso ≥ 55°) + deteksi diam
    └─ render.py     ──→  video beranotasi (kerangka + label + banner kejadian)
```

---

## Struktur Folder

```
sapa/
├── docker-compose.yml
├── README.md
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── app.py                   # FastAPI: POST /analyze, GET /outputs
│   ├── pipeline/
│   │   ├── models.py            # BiLSTMHead + load_head() + predict_proba()
│   │   ├── normalize.py         # normalize_pose / resample_fps / make_windows
│   │   ├── geometry.py          # torso_angle / is_dwell / detect helpers
│   │   ├── extract.py           # YOLOv8 tracking → sekuens per orang
│   │   ├── analyze.py           # analyze() → timeline + frame_annotations
│   │   └── render.py            # render() → video beranotasi (OpenCV + ffmpeg)
│   ├── production/              # mode CCTV 24/7 (opsional, SAPA_PRODUKSI=1)
│   │   ├── profiles.py          # profil kamera: jenis → fitur mana yang aktif
│   │   ├── stream.py            # ingest RTSP, reconnect otomatis, drop frame
│   │   ├── buffer.py            # jendela geser per-orang berbasis waktu
│   │   ├── worker.py            # 1 thread/kamera: pose+track → inferensi → alert
│   │   ├── alerts.py            # debounce + log kejadian + retensi
│   │   ├── manager.py           # multi-kamera + pengawas & auto-restart
│   │   └── api.py               # REST /api/produksi/* + WS /ws/produksi/alert
│   ├── tests/                   # uji logika produksi (tanpa kamera/GPU)
│   ├── data/                    # cameras.json + kejadian.jsonl (tidak di-commit)
│   ├── models/                  # .pt + .json (taruh di sini)
│   └── outputs/                 # video beranotasi hasil (auto-dibuat)
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── App.jsx
│       ├── components/
│       │   ├── UploadPage.jsx
│       │   ├── ProcessingPage.jsx
│       │   └── ResultPage.jsx
│       └── styles/global.css
└── training/                    # kode training (konteks saja, tidak dijalankan di web)
```

---

## Development Lokal (tanpa Docker)

Butuh **dua terminal** yang dibiarkan terbuka. Menutupnya = server mati.

### Persiapan (sekali saja)

```bash
# Backend — WAJIB pakai virtualenv, jangan install ke Python sistem
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# Frontend
cd ../frontend
npm install
```

### Terminal 1 — Backend

```bash
cd backend
.venv/bin/uvicorn app:app --port 8000
```

Jalankan **tanpa `&`** agar log tampil langsung di layar. Yang ditunggu:

```
2026-08-20 21:46:08,095 [INFO] sapa.app: ✅ Fall model berhasil dimuat.
2026-08-20 21:46:08,098 [INFO] sapa.app: ✅ Interaction model berhasil dimuat.
INFO:     Application startup complete.
```

Setiap analisis menambah baris baru lengkap dengan tanggal dan jam. Terminal
inilah yang direkam untuk video proof of work.

> Tulis `.venv/bin/uvicorn`, bukan `uvicorn` saja — dependensi berat (torch,
> ultralytics, opencv) hanya ada di dalam virtualenv. Alternatifnya aktifkan
> dulu dengan `source .venv/bin/activate`, setelah itu `uvicorn` polos bisa dipakai.

### Terminal 2 — Frontend

```bash
cd frontend
npm run dev
```

### Buka di browser

| URL | Isi |
|---|---|
| **http://localhost:5173/analisis** | ✅ **aplikasinya — buka ini** |
| http://localhost:5173 | Halaman utama |
| http://localhost:8000/docs | Dokumentasi API interaktif |

> **http://localhost:8000 bukan aplikasinya.** Port itu hanya melayani API —
> membukanya di browser menampilkan keterangan singkat yang menunjuk balik ke
> port 5173, bukan antarmuka. Frontend otomatis mem-proxy `/api/*` ke backend,
> jadi cukup buka port 5173 saja.

### Menghentikan

`Ctrl+C` di masing-masing terminal. Kalau port terlanjur tersangkut:

```bash
pkill -f "uvicorn app:app"    # backend
pkill -f vite                 # frontend
```

### Masalah umum

| Pesan | Artinya |
|---|---|
| `address already in use` | Server lama masih hidup → jalankan `pkill` di atas |
| `ModuleNotFoundError: torch` | Memakai Python sistem, bukan `.venv/bin/...` |
| `No module named 'lap'` | Dependensi belum lengkap → ulangi `.venv/bin/pip install -r requirements.txt` |
| Halaman kosong / gagal analisis | Terminal 1 mati atau model belum selesai dimuat |

---

## ⚠️ Kesesuaian dengan Kode Training

Sudah diverifikasi terhadap `Train_fall.ipynb` dan `Kepala Interaksi.ipynb`:

| Hal | Status |
|---|---|
| Agregasi temporal (`out.mean(dim=1)`) | ✅ identik — dikunci `tests/uji_arsitektur.py` |
| 12 sendi (5–16) × x,y untuk Kepala Jatuh | ✅ identik |
| 17 sendi × x,y,conf untuk Kepala Interaksi | ✅ identik |
| `inspect_idx = [4, 5]` | ✅ diambil dari config model |
| `resample_fps` / `make_windows` | ✅ sesuai `Inference.ipynb` |
| `normalize_pose` (anchor frame pertama) | ✅ sesuai `train_fall_threshold_sweep_v2.py` CELL 2 |
| `window_torso_angle` (maks `atan2`) | ✅ sesuai `geom_features()` |

**Pernah salah, sudah diperbaiki:** `BiLSTMHead.forward()` memakai hidden state
terakhir padahal training memakai mean-pooling. Keduanya memakai parameter yang
sama persis sehingga `load_state_dict(strict=True)` tetap lolos tanpa error —
tapi pada bobot `fall_head` kedua varian hanya sepakat **46%** dari waktu.
Pelajarannya: **model berhasil dimuat bukan bukti forward-pass sudah benar.**

Verifikasi ulang kapan saja:
```bash
cd backend && python tests/uji_arsitektur.py
```

### ✅ Ambang sudah disetel ulang

Ambang lama (`fall_thr = 0.80`, `fall_angle = 35°`) sudah diganti dengan hasil
sweep pada model multi-angle: **`0.65` / `5°` / kecepatan mati**. Sumber
kebenarannya ada di `backend/pipeline/thresholds.py` dan dipakai bersama oleh
jalur unggah-klip, mode Live, dan mode Produksi.

0,80 terlalu ketat. Karena syaratnya digabung dengan DAN, sebuah kejatuhan harus
lolos ambang probabilitas **dan** sudut sekaligus — efek ketatnya berlipat, dan
banyak kejatuhan nyata tidak pernah muncul di timeline.

### 🔧 Perbaikan model deteksi jatuh (multi-angle)

Tiga hal diperbaiki bersamaan; dua di antaranya adalah *train–serving skew*
yang tidak menimbulkan error apa pun, hanya prediksi yang meleset:

1. **Bobot baru** — `fall_head.pt` dilatih ulang dengan augmentasi 15 sudut
   kamera (sebelumnya 4), 89.865 window. CV 5-fold: macroF1 0,876 ± 0,020.

2. **`normalize_pose` — anchor frame pertama, bukan per-frame.** Versi lama
   memusatkan *setiap* frame ke pinggulnya sendiri, sehingga pinggul selalu
   berada di (0,0) dan perpindahan tubuh — sinyal utama sebuah kejatuhan —
   terhapus dari input model. Terukur: pada klip jatuh sintetis, pergerakan
   pinggul setelah normalisasi lama = **0,0000**; setelah perbaikan = **1,71**
   panjang torso. Normalisasi kini juga dilakukan **per jendela** (sesudah
   windowing), sama seperti saat training.

3. **`window_torso_angle` — maks sepanjang window, bukan rata-rata 5 frame
   terakhir.** Kejatuhan adalah puncak singkat; diratakan bersama frame tegak
   di sekitarnya, nilainya turun di bawah ambang. Rumusnya juga disamakan ke
   `degrees(atan2(|dx|,|dy|))` (rentang 0–90°) karena ambang hasil sweep
   dikalibrasi pada rumus itu.

### 🎛️ Panel Setting (coba-coba ambang tanpa proses ulang)

Di halaman hasil ada panel **Setting Deteksi Jatuh**: 4 preset hasil sweep +
mode custom dengan tiga slider, lalu tombol **Proses ulang**.

Yang membuatnya instan: backend menyimpan fitur tiap jendela (probabilitas,
sudut, kecepatan) di `fall_cache` saat analisis. `POST /api/rethreshold` hanya
membandingkan angka-angka itu dengan ambang baru — **ekstraksi pose dan
inferensi model tidak pernah diulang.**

| Mode | T_prob | T_angle | T_speed | recall | precision | F1 |
|---|---|---|---|---|---|---|
| **Prob + Sudut** (default) | 0,65 | 5° | — | 0,841 | 0,873 | **0,857** |
| Prob saja | 0,65 | — | — | 0,842 | 0,872 | 0,856 |
| Prob + Kecepatan | 0,45 | — | 2,13 | 0,764 | 0,864 | 0,811 |
| Prob + Sudut + Kecepatan | 0,45 | 5° | 2,13 | 0,764 | 0,864 | 0,811 |

Keempat preset memakai **bobot model yang sama** — yang berbeda hanya lapisan
keputusan, jadi tidak perlu menyimpan beberapa file `.pt`.

Kecepatan dimatikan secara default: ia justru **menurunkan** recall (0,841 →
0,764) karena kecepatan gerak jatuh dan normal nyaris sama (5,12 vs 4,44).
Tetap disediakan agar tim bisa memverifikasi sendiri.

Endpoint terkait:
```
GET  /api/preset        → daftar preset + batas slider
POST /api/rethreshold   → hitung ulang kejadian dari fall_cache
```

---

## Konvensi Commit

Proyek mengikuti **conventional commits**:
```
feat: tambah fitur baru
fix:  perbaiki bug
refactor: refactor kode tanpa mengubah perilaku
docs: perbarui dokumentasi
chore: perubahan build/config
```

---

*SAPA — AI menandai, manusia memutuskan.*
