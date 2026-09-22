import { useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import PanelDeteksiOrang from './PanelDeteksiOrang.jsx'

/* ─────────────────────────────────────────────────────────────────────────────
   UploadPage — halaman unggah video + pilihan jenis kamera
   Desain: latar kertas hangat, dropzone border putus-putus, 3 kartu kamera ilustratif
───────────────────────────────────────────────────────────────────────────── */

/* Ikon SVG inline untuk tiap jenis kamera */
function IconCCTV() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="2" y="10" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <polygon points="20,12 28,8 28,24 20,20" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none" />
      <circle cx="8" cy="16" r="2" fill="currentColor" opacity="0.5" />
      <line x1="10" y1="26" x2="10" y2="30" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="6"  y1="30" x2="14" y2="30" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function IconShelf() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      {/* Rak dari atas */}
      <rect x="3" y="14" width="26" height="3" rx="1" stroke="currentColor" strokeWidth="1.8" fill="none" />
      <rect x="3" y="22" width="26" height="3" rx="1" stroke="currentColor" strokeWidth="1.8" fill="none" />
      {/* Produk di rak */}
      <rect x="6"  y="11" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.35" />
      <rect x="12" y="11" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.35" />
      <rect x="18" y="11" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.35" />
      {/* Orang dari atas */}
      <circle cx="16" cy="6" r="3" stroke="currentColor" strokeWidth="1.8" />
      <line x1="16" y1="9" x2="16" y2="14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function IconBoth() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      {/* Gabungan: orang berdiri + simbol kamera kecil */}
      <circle cx="16" cy="5" r="3" stroke="currentColor" strokeWidth="1.8" />
      <line x1="16" y1="8"  x2="16" y2="19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="16" y1="12" x2="10" y2="16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="16" y1="12" x2="22" y2="16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="16" y1="19" x2="12" y2="27" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="16" y1="19" x2="20" y2="27" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

const CAMERA_OPTIONS = [
  {
    id: 'lorong',
    Icon: IconCCTV,
    label: 'Kamera Lorong',
    desc: 'Kamera samping / depan lorong toko',
    feature: 'Deteksi jatuh aktif',
    note: 'Kamera miring/samping memperlihatkan perubahan postur tubuh secara jelas.',
    colorClass: 'selected-lorong',
    chipClass: 'chip-waspada',
    labelColor: 'var(--waspada)',
  },
  {
    id: 'rak',
    Icon: IconShelf,
    label: 'Kamera Rak (Atas)',
    desc: 'Kamera top-down menghadap rak produk',
    feature: 'Deteksi pelayanan aktif',
    note: 'Sudut atas menangkap interaksi tangan dengan rak secara optimal.',
    colorClass: 'selected-rak',
    chipClass: 'chip-bantu',
    labelColor: 'var(--bantu)',
  },
  {
    id: 'both',
    Icon: IconBoth,
    label: 'Semua Fitur',
    desc: 'Aktifkan kedua jenis deteksi sekaligus',
    feature: 'Jatuh + pelayanan',
    note: 'Cocok untuk klip kamera general yang mencakup lorong sekaligus area rak.',
    colorClass: 'selected-both',
    chipClass: 'chip-sigap',
    labelColor: 'var(--sigap)',
  },
]

/* Kerangka hero — siluet satu garis bergaya line-art hangat */
function HeroSkeleton() {
  return (
    <svg
      width="80" height="104"
      viewBox="0 0 80 104"
      fill="none"
      aria-hidden="true"
      style={{ animation: 'skeletonGlow 3.5s ease-in-out infinite' }}
    >
      {/* Kepala */}
      <circle cx="40" cy="12" r="9" stroke="var(--sigap)" strokeWidth="2.5" />
      {/* Badan */}
      <line x1="40" y1="21" x2="40" y2="50" stroke="var(--sigap)" strokeWidth="2.5" strokeLinecap="round" />
      {/* Bahu → lengan */}
      <line x1="40" y1="32" x2="18" y2="44" stroke="var(--sigap)" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="40" y1="32" x2="62" y2="44" stroke="var(--sigap)" strokeWidth="2.5" strokeLinecap="round" />
      {/* Lengan bawah */}
      <line x1="18" y1="44" x2="12" y2="60" stroke="var(--sigap)" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="62" y1="44" x2="68" y2="60" stroke="var(--sigap)" strokeWidth="2.5" strokeLinecap="round" />
      {/* Pinggul → kaki */}
      <line x1="40" y1="50" x2="28" y2="76" stroke="var(--sigap)" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="40" y1="50" x2="52" y2="76" stroke="var(--sigap)" strokeWidth="2.5" strokeLinecap="round" />
      {/* Kaki bawah */}
      <line x1="28" y1="76" x2="24" y2="96" stroke="var(--sigap)" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="52" y1="76" x2="56" y2="96" stroke="var(--sigap)" strokeWidth="2.5" strokeLinecap="round" />
      {/* Titik sendi */}
      {[
        [40,21],[18,44],[62,44],[12,60],[68,60],
        [28,76],[52,76],[24,96],[56,96]
      ].map(([cx,cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="3.5" fill="var(--sigap)" />
      ))}
    </svg>
  )
}

function CameraCard({ option, selected, onSelect }) {
  const { id, Icon, label, desc, feature, colorClass, chipClass, labelColor } = option
  return (
    <button
      id={`camera-${id}`}
      onClick={() => onSelect(id)}
      className={`camera-card ${selected ? colorClass : ''}`}
      type="button"
    >
      {/* Ikon */}
      <div style={{
        color: selected ? labelColor : 'var(--ink-faint)',
        marginBottom: 10,
        transition: 'color var(--dur-mid) var(--ease)',
      }}>
        <Icon />
      </div>
      {/* Label */}
      <div style={{
        fontSize: 14,
        fontWeight: 700,
        color: selected ? labelColor : 'var(--ink)',
        marginBottom: 4,
        transition: 'color var(--dur-mid) var(--ease)',
      }}>
        {label}
      </div>
      {/* Deskripsi */}
      <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 10, lineHeight: 1.5 }}>
        {desc}
      </div>
      {/* Chip fitur */}
      <span className={`chip ${chipClass}`}>
        ✓ {feature}
      </span>
    </button>
  )
}

/* Nilai awal setting dua fitur rule-based. Sengaja: angkat tangan ON (fitur
   baru yang memang ingin ditunjukkan), exclude pegawai OFF (butuh seragam
   didaftarkan dulu, dan harus bisa dimatikan saat demo). */
const SETTING_AWAL = {
  angkat_aktif: true,
  angkat_min_durasi: 2.5,
  angkat_maks_gerak: 0.35,
  seragam_aktif: false,
  seragam_ambang: 0.60,
}

export default function UploadPage({ onAnalyze, error, onClearError }) {
  const [setting, setSetting] = useState(SETTING_AWAL)
  const [file, setFile] = useState(null)
  const [cameraType, setCameraType] = useState('both')
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef(null)
  const navigate = useNavigate()

  const handleFile = useCallback((f) => {
    if (!f) return
    if (!f.name.match(/\.(mp4|avi|mov|mkv)$/i)) {
      alert('Format tidak didukung. Gunakan .mp4, .avi, .mov, atau .mkv')
      return
    }
    setFile(f)
    if (error) onClearError()
  }, [error, onClearError])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setIsDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }, [handleFile])

  const onDragOver = (e) => { e.preventDefault(); setIsDragging(true) }
  const onDragLeave = () => setIsDragging(false)

  const formatSize = (bytes) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const selectedOption = CAMERA_OPTIONS.find(o => o.id === cameraType)

  return (
    <main
      className="page-center page-enter"
      style={{ maxWidth: 840, width: '100%', margin: '0 auto' }}
    >
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        {/* Siluet kerangka */}
        <div style={{ position: 'relative', display: 'inline-block', marginBottom: 24 }}>
          <HeroSkeleton />
          {/* Lingkaran breathe tipis di belakang */}
          <div style={{
            position: 'absolute',
            top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 128, height: 128,
            borderRadius: '50%',
            border: '1.5px solid rgba(47, 107, 88, 0.18)',
            animation: 'breathe 4s ease-in-out infinite',
            pointerEvents: 'none',
          }} />
        </div>

        <h1 style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 'clamp(26px, 4.5vw, 40px)',
          fontWeight: 800,
          marginBottom: 12,
          color: 'var(--ink)',
          letterSpacing: '-0.03em',
        }}>
          Analisis Klip Video CCTV
        </h1>
        <p style={{ color: 'var(--ink-soft)', fontSize: 16, maxWidth: 520, margin: '0 auto', lineHeight: 1.6 }}>
          Mendeteksi pelanggan tampak butuh bantuan & kejadian jatuh — hanya dari{' '}
          <span style={{ color: 'var(--sigap)', fontWeight: 600 }}>pose/kerangka tubuh</span>,
          tanpa mengenali wajah atau identitas.
        </p>
      </div>

      {/* ── Mode Selector (Tab) ─────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 32 }}>
        <div style={{
          display: 'inline-flex',
          background: 'var(--surface)',
          border: '1.5px solid var(--garis)',
          borderRadius: 999,
          padding: 6,
          boxShadow: 'var(--shadow-sm)',
          position: 'relative'
        }}>
          <button
            type="button"
            style={{
              padding: '10px 24px',
              borderRadius: 999,
              border: 'none',
              background: 'var(--sigap-soft)',
              color: 'var(--sigap-dark)',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'default',
              transition: 'all 0.3s ease',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 2px 8px rgba(47, 107, 88, 0.15)'
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            Unggah Video
          </button>
          
          <button
            type="button"
            onClick={() => navigate('/live')}
            style={{
              padding: '10px 24px',
              borderRadius: 999,
              border: 'none',
              background: 'transparent',
              color: 'var(--ink-soft)',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
            onMouseOver={e => { e.currentTarget.style.color = 'var(--ink)' }}
            onMouseOut={e => { e.currentTarget.style.color = 'var(--ink-soft)' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
              <circle cx="12" cy="13" r="4"></circle>
            </svg>
            Kamera Real-time
          </button>
        </div>
      </div>

      {/* ── Error banner ──────────────────────────────────────────────── */}
      {error && (
        <div className="error-banner" style={{ marginBottom: 20 }}>
          <span>⚠ {error}</span>
          <button
            onClick={onClearError}
            style={{
              background: 'none', border: 'none',
              color: 'var(--waspada-dark)',
              cursor: 'pointer', fontSize: 20, lineHeight: 1,
              fontFamily: 'inherit',
            }}
            aria-label="Tutup pesan error"
          >×</button>
        </div>
      )}

      {/* ── Drop zone ─────────────────────────────────────────────────── */}
      <div
        id="upload-dropzone"
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => !file && inputRef.current?.click()}
        className={`dropzone ${isDragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`}
        style={{ minHeight: 200, marginBottom: 28 }}
        role="button"
        tabIndex={0}
        aria-label="Area unggah video"
        onKeyDown={(e) => e.key === 'Enter' && !file && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/avi,video/quicktime,.mkv"
          style={{ display: 'none' }}
          onChange={e => handleFile(e.target.files?.[0])}
          id="file-input"
        />

        {file ? (
          /* File sudah dipilih */
          <div style={{ textAlign: 'center' }}>
            {/* Ikon video kecil berbasis SVG */}
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none"
              style={{ marginBottom: 12 }} aria-hidden="true">
              <rect x="4" y="8" width="30" height="32" rx="3" stroke="var(--sigap)" strokeWidth="2" fill="var(--sigap-soft)" />
              <polygon points="36,16 44,20 44,28 36,32" stroke="var(--sigap)" strokeWidth="2" strokeLinejoin="round" fill="var(--sigap-soft)" />
              <line x1="10" y1="18" x2="28" y2="18" stroke="var(--sigap)" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="10" y1="24" x2="22" y2="24" stroke="var(--sigap)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--sigap)', marginBottom: 4 }}>
              {file.name}
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-faint)' }}>
              {formatSize(file.size)}
            </div>
            <button
              id="change-file-btn"
              type="button"
              onClick={e => { e.stopPropagation(); setFile(null); inputRef.current?.click() }}
              style={{
                marginTop: 14,
                background: 'none',
                border: '1.5px solid var(--garis)',
                borderRadius: 20,
                color: 'var(--ink-soft)',
                fontSize: 12,
                fontWeight: 600,
                padding: '5px 16px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all var(--dur-fast) var(--ease)',
              }}
              onMouseOver={e => { e.currentTarget.style.borderColor = 'var(--sigap)'; e.currentTarget.style.color = 'var(--sigap)' }}
              onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--garis)'; e.currentTarget.style.color = 'var(--ink-soft)' }}
            >
              Ganti file
            </button>
          </div>
        ) : (
          /* Prompt drop */
          <div style={{ textAlign: 'center' }}>
            {/* Ikon upload SVG */}
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none"
              style={{ marginBottom: 14, animation: isDragging ? 'none' : 'breathe 3s ease-in-out infinite' }}
              aria-hidden="true">
              <circle cx="24" cy="24" r="20" stroke="var(--garis)" strokeWidth="1.5" fill="var(--paper-2)" />
              <line x1="24" y1="16" x2="24" y2="32" stroke="var(--ink-faint)" strokeWidth="2" strokeLinecap="round" />
              <polyline points="18,22 24,16 30,22" stroke="var(--ink-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="16" y1="33" x2="32" y2="33" stroke="var(--garis)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
              {isDragging ? 'Lepaskan untuk mengunggah' : 'Seret video ke sini'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
              atau <span style={{ color: 'var(--sigap)', fontWeight: 600 }}>klik untuk pilih file</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 8 }}>
              Format: .mp4 &nbsp;·&nbsp; Disarankan klip ≤ 2 menit
            </div>
          </div>
        )}
      </div>

      {/* ── Pilihan jenis kamera ──────────────────────────────────────── */}
      <div style={{ width: '100%', marginBottom: 32 }}>
        <div style={{
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--ink-soft)',
          marginBottom: 14,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}>
          Jenis Kamera
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {CAMERA_OPTIONS.map(opt => (
            <CameraCard
              key={opt.id}
              option={opt}
              selected={cameraType === opt.id}
              onSelect={setCameraType}
            />
          ))}
        </div>

        {/* Catatan kontekstual tergantung pilihan */}
        {selectedOption && (
          <div className="info-box" style={{ marginTop: 12 }}>
            💡 <strong style={{ color: 'var(--sigap-dark)' }}>
              {selectedOption.label}:
            </strong>{' '}
            {selectedOption.note}
          </div>
        )}
      </div>

      {/* ── Setting deteksi orang (angkat tangan + pegawai) ───────────── */}
      <PanelDeteksiOrang nilai={setting} onUbah={setSetting} />

      {/* ── CTA ───────────────────────────────────────────────────────── */}
      <button
        id="analyze-btn"
        type="button"
        className="btn btn-primary"
        disabled={!file}
        onClick={() => onAnalyze(file, cameraType, setting)}
        style={{ fontSize: 16, padding: '14px 48px' }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.8" />
          <line x1="11" y1="11" x2="14.5" y2="14.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        Analisis Sekarang
      </button>

      {/* ── Privacy note ─────────────────────────────────────────────── */}
      <div className="privacy-note" style={{ marginTop: 24 }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M7 1L2 3v4c0 2.8 2.1 5.4 5 6 2.9-.6 5-3.2 5-6V3L7 1z"
            stroke="var(--ink-faint)" strokeWidth="1.4" fill="none" strokeLinejoin="round" />
        </svg>
        Video diproses lokal di server Anda · Wajah tidak dikenali · Tidak ada data yang dikirim ke cloud
      </div>
    </main>
  )
}
