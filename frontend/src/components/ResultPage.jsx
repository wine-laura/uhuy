import { useRef, useState } from 'react'
import PanelSetting from './PanelSetting.jsx'

/* ─────────────────────────────────────────────────────────────────────────────
   ResultPage — video beranotasi + timeline kejadian + ringkasan statistik
   Desain: angka besar Fraunces, timestamp IBM Plex Mono, kartu event border kiri berwarna
───────────────────────────────────────────────────────────────────────────── */

function formatTime(sec) {
  if (sec == null) return '--:--'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/* Kartu satu kejadian di timeline */
function EventCard({ event, isActive, onClick }) {
  const isFall  = event.tipe === 'jatuh'
  // Sinyal AKTIF = pelanggan mengangkat tangan (permintaan eksplisit).
  // Sinyal PASIF = dwell + inspect dari kepala interaksi.
  const isAktif = !isFall && event.sinyal === 'aktif'
  const typeClass = isFall ? 'jatuh' : 'bantu'
  const color   = isFall ? 'var(--waspada)'      : 'var(--bantu)'
  const label   = isFall
    ? 'Jatuh Terdeteksi'
    : (isAktif ? 'Angkat Tangan — Minta Bantuan' : 'Tampak Butuh Bantuan')
  const icon    = isFall
    ? (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path d="M9 2L2 14h14L9 2z" stroke="var(--waspada)" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
        <line x1="9" y1="8" x2="9" y2="11" stroke="var(--waspada)" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="9" cy="13" r="0.8" fill="var(--waspada)" />
      </svg>
    )
    : (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <circle cx="9" cy="5" r="3" stroke="var(--bantu)" strokeWidth="1.6" />
        <line x1="9" y1="8" x2="9" y2="14" stroke="var(--bantu)" strokeWidth="1.6" strokeLinecap="round" />
        <line x1="9" y1="11" x2="5" y2="13" stroke="var(--bantu)" strokeWidth="1.6" strokeLinecap="round" />
        <line x1="9" y1="11" x2="13" y2="13" stroke="var(--bantu)" strokeWidth="1.6" strokeLinecap="round" />
        <line x1="9" y1="14" x2="7"  y2="17" stroke="var(--bantu)" strokeWidth="1.6" strokeLinecap="round" />
        <line x1="9" y1="14" x2="11" y2="17" stroke="var(--bantu)" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )

  return (
    <button
      id={`event-card-${event.tipe}-${event.track_id}-${Math.round(event.t0)}`}
      type="button"
      onClick={onClick}
      className={`event-card ${typeClass} ${isActive ? 'active' : ''}`}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {/* Ikon */}
        <span style={{ flexShrink: 0, marginTop: 1 }}>{icon}</span>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Label kejadian */}
          <div style={{
            fontSize: 13,
            fontWeight: 700,
            color: isActive ? color : 'var(--ink)',
            marginBottom: 5,
            transition: 'color var(--dur-mid) var(--ease)',
          }}>
            {label}
          </div>

          {/* Meta: waktu + track ID + skor */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
            {/* Waktu */}
            <span style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
              color: 'var(--ink-soft)', letterSpacing: '0.02em',
            }}>
              {formatTime(event.t0)} → {formatTime(event.t1)}
            </span>

            {/* Track ID */}
            <span style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--ink-faint)',
            }}>
              ID:{event.track_id}
            </span>

            {/* Skor keyakinan — tampilkan untuk SEMUA tipe */}
            {event.skor != null && (
              <span className={`chip ${isFall ? 'chip-waspada' : 'chip-bantu'}`}>
                {(event.skor * 100).toFixed(0)}% yakin
              </span>
            )}

            {/* Penanda permintaan eksplisit — prioritas lebih tinggi */}
            {isAktif && (
              <span className="chip chip-bantu" style={{ fontWeight: 700 }}>
                permintaan eksplisit
              </span>
            )}

            {/* Durasi tangan ditahan */}
            {isAktif && event.durasi != null && (
              <span style={{ fontSize: 11, color: 'var(--ink-faint)', fontFamily: "'JetBrains Mono', monospace" }}>
                tahan {event.durasi.toFixed(1)}d
                {event.sisi_tangan ? ` · ${event.sisi_tangan}` : ''}
              </span>
            )}

            {/* Durasi butuh bantuan */}
            {!isFall && event.durasi_window != null && (
              <span style={{ fontSize: 11, color: 'var(--ink-faint)', fontFamily: "'JetBrains Mono', monospace" }}>
                ±{Math.round((event.t1 ?? event.t0) - event.t0)}d
              </span>
            )}

            {/* Sudut torso jatuh */}
            {isFall && event.sudut_torso != null && (
              <span style={{ fontSize: 11, color: 'var(--ink-faint)', fontFamily: "'JetBrains Mono', monospace" }}>
                torso {event.sudut_torso.toFixed(0)}°
              </span>
            )}
          </div>
        </div>

        {/* Hint klik */}
        <span style={{
          fontSize: 11,
          color: 'var(--ink-faint)',
          flexShrink: 0,
          alignSelf: 'center',
          transition: 'color var(--dur-fast)',
        }}>
          ▶
        </span>
      </div>
    </button>
  )
}

/* Badge ringkasan statistik — angka besar Fraunces */
function SummaryBadge({ count, type }) {
  const isFall = type === 'jatuh'
  const label  = isFall ? 'Jatuh terdeteksi'       : 'Tampak butuh bantuan'
  const icon   = isFall
    ? (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 3L3 15h14L10 3z" stroke="var(--waspada)" strokeWidth="1.8" strokeLinejoin="round" fill="none" />
        <line x1="10" y1="9"  x2="10" y2="12" stroke="var(--waspada)" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="10" cy="13.5" r="0.9" fill="var(--waspada)" />
      </svg>
    )
    : (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="6"  r="3" stroke="var(--bantu)" strokeWidth="1.8" />
        <line x1="10" y1="9" x2="10" y2="15" stroke="var(--bantu)" strokeWidth="1.8" strokeLinecap="round" />
        <line x1="10" y1="12" x2="6"  y2="14" stroke="var(--bantu)" strokeWidth="1.8" strokeLinecap="round" />
        <line x1="10" y1="12" x2="14" y2="14" stroke="var(--bantu)" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )

  return (
    <div className={`summary-badge ${isFall ? 'jatuh' : 'bantu'}`}>
      <span>{icon}</span>
      <div className="number font-display">{count}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-soft)', textAlign: 'center', lineHeight: 1.4 }}>
        {label}
      </div>
    </div>
  )
}

export default function ResultPage({ result, onReset }) {
  const videoRef = useRef(null)
  const [activeIdx, setActiveIdx] = useState(null)
  const [videoError, setVideoError] = useState(false)

  const {
    timeline: timelineAwal = [], summary: summaryAwal = {},
    annotated_video_url, video, fps, model_mode = {},
    fall_cache = [], ambang,
  } = result

  /* Hasil "proses ulang" dari panel Setting menimpa timeline & ringkasan.
     Kejadian butuh_bantuan tidak ikut dihitung ulang (panel ini khusus jatuh),
     jadi kejadian jatuh yang baru digabung dengan kejadian bantuan yang lama. */
  const [revisi, setRevisi] = useState(null)

  const timeline = revisi
    ? [...revisi.timeline, ...timelineAwal.filter(e => e.tipe !== 'jatuh')]
        .sort((a, b) => a.t0 - b.t0)
    : timelineAwal

  const summary = revisi
    ? { ...summaryAwal,
        jatuh: revisi.summary?.jatuh ?? 0,
        total_track: new Set(timeline.map(e => e.track_id)).size }
    : summaryAwal

  // Tambah cache-buster (timestamp) agar browser tidak load video lama yang di-cache
  const _ts = result._ts ?? Date.now()
  // Di Docker: nginx proxy /api/ → backend, dan /outputs/ sudah di-serve langsung
  // Di dev (Vite): ada proxy /outputs → backend:8000, dan /api → backend:8000 (strip /api)
  // Jadi: gunakan /outputs/... langsung — work di kedua mode
  const videoSrc = annotated_video_url?.startsWith('/')
    ? `${annotated_video_url}?t=${_ts}`
    : annotated_video_url



  function terimaRevisi(data) {
    setRevisi(data)
    setActiveIdx(null)   // indeks lama tidak lagi menunjuk kejadian yang sama
  }

  function seekTo(t0, idx) {
    setActiveIdx(idx)
    if (videoRef.current) {
      videoRef.current.currentTime = t0
      videoRef.current.play().catch(() => {})
    }
  }

  const hasEvents = timeline.length > 0

  /* Chip model status — ditampilkan di header hasil */
  function ModelChip({ active, label }) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        fontSize: 11, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace",
        padding: '3px 10px', borderRadius: 20,
        background: active ? 'rgba(44,93,75,0.10)' : 'rgba(26,28,24,0.04)',
        color: active ? 'var(--sigap)' : 'var(--ink-faint)',
        border: `1px solid ${active ? 'rgba(44,93,75,0.25)' : 'var(--garis)'}`,
      }}>
        <span style={{
          width: 5, height: 5, borderRadius: '50%',
          background: active ? 'var(--sigap)' : 'var(--ink-faint)',
          display: 'inline-block',
        }} />
        {label}
      </span>
    )
  }



  return (
    <main
      className="page-enter"
      style={{ width: '100%', maxWidth: 1200, margin: '0 auto', padding: '36px 20px 60px' }}
    >
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 32,
        flexWrap: 'wrap',
        gap: 16,
      }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 5, color: 'var(--ink)', letterSpacing: '-0.03em' }}>
            Hasil Analisis
          </h1>
          <div style={{
            fontSize: 13,
            color: 'var(--ink-faint)',
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: '0.02em',
            marginBottom: 10,
          }}>
            {video} · {fps?.toFixed(1) || '?'} fps
          </div>
          {/* Model mode chips */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <ModelChip active={model_mode.fall}        label="Deteksi Jatuh" />
            <ModelChip active={model_mode.interaction} label="Deteksi Interaksi" />
          </div>
        </div>
        <button
          id="analyze-again-btn"
          type="button"
          className="btn btn-ghost"
          onClick={onReset}
          style={{ fontSize: 14 }}
        >
          ← Analisis Video Baru
        </button>
      </div>


      {/* ── Panel Setting ambang jatuh ─────────────────────────────────── */}
      {model_mode.fall && (
        <PanelSetting
          fallCache={fall_cache}
          ambangAwal={ambang}
          jumlahJatuh={summary.jatuh ?? 0}
          onHasil={terimaRevisi}
        />
      )}

      {/* ── Ringkasan statistik ────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 36, flexWrap: 'wrap' }}>
        <SummaryBadge count={summary.jatuh ?? 0}         type="jatuh"  />
        <SummaryBadge count={summary.butuh_bantuan ?? 0} type="bantuan" />

        {/* Pecahan sinyal aktif vs pasif — hanya bila ada angkat tangan */}
        {(summary.angkat_tangan ?? 0) > 0 && (
          <div style={{
            padding: '20px 24px', borderRadius: 'var(--radius-lg)',
            background: 'var(--surface)', border: '1px solid var(--garis)',
            display: 'flex', flexDirection: 'column', gap: 6,
            justifyContent: 'center', minWidth: 150,
          }}>
            <div style={{ fontSize: 12.5, color: 'var(--ink)', fontWeight: 600 }}>
              {summary.angkat_tangan} angkat tangan
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', lineHeight: 1.45 }}>
              permintaan eksplisit
              {(summary.bantuan_pasif ?? 0) > 0
                ? ` · ${summary.bantuan_pasif} dari dwell`
                : ''}
            </div>
          </div>
        )}

        {/* Pesan saat tidak ada kejadian */}
        {!hasEvents && (
          <div style={{
            flex: '1 1 0',
            minWidth: 200,
            padding: '20px 24px',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--sigap-soft)',
            border: '1px solid rgba(47, 107, 88, 0.20)',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}>
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
              <circle cx="14" cy="14" r="12" stroke="var(--sigap)" strokeWidth="1.8" />
              <polyline points="9,14 12,17 19,11" stroke="var(--sigap)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 3, color: 'var(--ink)', fontSize: 14 }}>
                Tidak Ada Kejadian Terdeteksi
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                Tidak ditemukan jatuh atau pelanggan tampak butuh bantuan dalam klip ini.
              </div>
            </div>
          </div>
        )}

        {/* Jumlah track dianalisis */}
        {summary.total_track > 0 && (
          <div style={{
            padding: '20px 24px',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--surface)',
            border: '1px solid var(--garis)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            minWidth: 110,
          }}>
            <div className="font-display" style={{
              fontSize: 40,
              fontWeight: 600,
              color: 'var(--ink)',
              lineHeight: 1,
            }}>
              {summary.total_track}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', textAlign: 'center' }}>
              Orang terdeteksi
            </div>
          </div>
        )}
      </div>

      {/* ── Grid: video + timeline ─────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: hasEvents ? '1fr 360px' : '1fr',
        gap: 24,
        alignItems: 'start',
      }}>

        {/* ── Video player ─────────────────────────────────────────────── */}
        <div>
          <div style={{
            borderRadius: 'var(--radius-xl)',
            overflow: 'hidden',
            background: '#1A1A1A',
            border: '1px solid var(--garis)',
            boxShadow: 'var(--shadow-md)',
            position: 'relative',
          }}>
            {!videoError ? (
              <video
                ref={videoRef}
                id="annotated-video-player"
                controls
                style={{ width: '100%', display: 'block', maxHeight: 540 }}
                onError={() => setVideoError(true)}
              >
                <source src={videoSrc} type="video/mp4" />
                Browser Anda tidak mendukung pemutar video.
              </video>
            ) : (
              <div style={{
                padding: 56,
                textAlign: 'center',
                color: 'var(--ink-faint)',
              }}>
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none"
                  style={{ marginBottom: 14 }} aria-hidden="true">
                  <circle cx="24" cy="24" r="20" stroke="var(--garis)" strokeWidth="2" />
                  <line x1="16" y1="16" x2="32" y2="32" stroke="var(--ink-faint)" strokeWidth="2" strokeLinecap="round" />
                  <line x1="32" y1="16" x2="16" y2="32" stroke="var(--ink-faint)" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <div style={{ fontSize: 14, marginBottom: 10, color: 'var(--ink-soft)' }}>
                  Video tidak bisa dimuat
                </div>
                <a
                  href={videoSrc}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--sigap)', fontSize: 13, fontWeight: 600 }}
                >
                  Buka langsung di tab baru →
                </a>
              </div>
            )}
          </div>

          {/* Legenda warna kerangka */}
          <div style={{
            display: 'flex', gap: 16, flexWrap: 'wrap', margin: '10px 0 6px',
            fontSize: 12, color: 'var(--ink-soft)',
          }}>
            {[
              { bg: 'rgba(80,180,80,0.9)',   label: 'Hijau — gerakan normal' },
              { bg: 'rgba(240,140,30,0.95)', label: 'Oranye — tampak butuh bantuan' },
              { bg: 'rgba(200,60,200,0.95)', label: 'Ungu — angkat tangan (minta bantuan)' },
              { bg: 'rgba(210,40,40,0.95)',  label: 'Merah — jatuh terdeteksi' },
              { bg: 'rgba(150,150,150,0.95)',label: 'Abu — pegawai (dikecualikan dari bantuan)' },
            ].map(({ bg, label }) => (
              <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 18, height: 3, borderRadius: 99, background: bg, display: 'inline-block', flexShrink: 0 }} />
                {label}
              </span>
            ))}
          </div>

          {/* Privacy note */}
          <div className="privacy-note">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
              <circle cx="6.5" cy="4" r="2.5" stroke="var(--ink-faint)" strokeWidth="1.3" />
              <line x1="6.5" y1="6.5" x2="6.5" y2="11" stroke="var(--ink-faint)" strokeWidth="1.3" strokeLinecap="round" />
              <line x1="6.5" y1="9" x2="4" y2="10.5" stroke="var(--ink-faint)" strokeWidth="1.3" strokeLinecap="round" />
              <line x1="6.5" y1="9" x2="9" y2="10.5" stroke="var(--ink-faint)" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            Video menampilkan{' '}
            <strong style={{ color: 'var(--sigap)', fontWeight: 600 }}>kerangka sendi saja</strong>{' '}
            — wajah dan identitas tidak dikenali (privacy-by-design)
          </div>
        </div>


        {/* ── Timeline ─────────────────────────────────────────────────── */}
        {hasEvents && (
          <div>
            {/* Header timeline */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 12,
            }}>
              <div style={{
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--ink-soft)',
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
              }}>
                Timeline Kejadian
              </div>
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                color: 'var(--ink-faint)',
              }}>
                {timeline.length} kejadian
              </span>
            </div>

            {/* Daftar kartu kejadian */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              maxHeight: 490,
              overflowY: 'auto',
              paddingRight: 2,
            }}>
              {timeline.map((event, idx) => (
                <EventCard
                  key={idx}
                  event={event}
                  isActive={activeIdx === idx}
                  onClick={() => seekTo(event.t0, idx)}
                />
              ))}
            </div>

            {/* Hint klik */}
            <div className="info-box" style={{ marginTop: 14, fontSize: 12 }}>
              Klik kartu kejadian untuk melompat ke waktu tersebut di video.
            </div>
          </div>
        )}
      </div>

      {/* ── Prinsip ───────────────────────────────────────────────────── */}
      <div style={{
        marginTop: 40,
        padding: '20px 24px',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--sigap-soft)',
        border: '1px solid rgba(47, 107, 88, 0.18)',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
      }}>
        {/* Ikon tangan berjabat */}
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" flex-shrink="0" aria-hidden="true">
          <path d="M6 18c0 0 2-3 6-3h8c4 0 6 3 6 3" stroke="var(--sigap)" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="10" y1="15" x2="10" y2="8" stroke="var(--sigap)" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="14" y1="15" x2="14" y2="6" stroke="var(--sigap)" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="18" y1="15" x2="18" y2="8" stroke="var(--sigap)" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="22" y1="15" x2="22" y2="10" stroke="var(--sigap)" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M6 18v6h20v-6" stroke="var(--sigap)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{
            fontWeight: 700,
            marginBottom: 5,
            fontSize: 14,
            color: 'var(--sigap-dark)',
          }}>
            "AI Menandai, Manusia Memutuskan"
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-soft)', maxWidth: 640, lineHeight: 1.6 }}>
            Hasil analisis ini adalah <em>rekomendasi bantu</em> untuk karyawan — bukan keputusan otomatis.
            Selalu verifikasi secara langsung sebelum mengambil tindakan.
          </div>
        </div>
      </div>
    </main>
  )
}
