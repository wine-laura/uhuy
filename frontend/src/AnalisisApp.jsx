import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import UploadPage from './components/UploadPage.jsx'
import ProcessingPage from './components/ProcessingPage.jsx'
import ResultPage from './components/ResultPage.jsx'
import JamLangsung from './components/JamLangsung.jsx'

/* ─────────────────────────────────────────────────────────────────────────────
   AnalisisApp — state machine: upload → processing → result
   Dipakai di route /analisis
───────────────────────────────────────────────────────────────────────────── */



export default function AnalisisApp() {
  const navigate = useNavigate()
  const [page, setPage]     = useState('upload')   // 'upload' | 'processing' | 'result'
  const [result, setResult] = useState(null)
  const [error, setError]   = useState(null)
  const [fileSizeMB, setFileSizeMB] = useState(0)
  const abortRef = useRef(null)

  async function handleAnalyze(file, cameraType, setting = {}) {
    setError(null)
    setPage('processing')
    setFileSizeMB(file.size ? +(file.size / 1024 / 1024).toFixed(1) : 0)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('camera_type', cameraType)
    // Setting dua fitur rule-based (angkat tangan & exclude pegawai). Keduanya
    // harus dikirim saat analisis karena memengaruhi pembacaan pose/piksel —
    // beda dari ambang jatuh yang bisa dihitung ulang dari cache.
    Object.entries(setting).forEach(([k, v]) => {
      formData.append(k, typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v))
    })

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(errData.detail || `HTTP ${res.status}`)
      }

      const data = await res.json()
      setResult(data)
      setPage('result')
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('Analisis dibatalkan.')
      } else {
        setError(err.message || 'Terjadi kesalahan tak terduga.')
      }
      setPage('upload')
    }
  }

  function handleReset() {
    setResult(null)
    setError(null)
    setPage('upload')
  }

  function handleCancel() {
    if (abortRef.current) abortRef.current.abort()
  }

  return (
    <div className="page-container">
      {/* ── Navbar ─────────────────────────────────────────────────── */}
      <nav className="navbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Back button */}
          <button
            id="back-home-btn"
            onClick={() => navigate('/')}
            aria-label="Kembali ke halaman utama"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'rgba(255,255,255,0.14)',
              border: '1.5px solid rgba(255,255,255,0.28)',
              borderRadius: 50,
              color: 'white',
              fontSize: 13, fontWeight: 600,
              padding: '6px 14px 6px 10px',
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'background 150ms',
            }}
            onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.24)'}
            onMouseOut={e => e.currentTarget.style.background = 'rgba(255,255,255,0.14)'}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M9 2L4 7l5 5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Home
          </button>

          {/* Brand */}
          <button
            className="navbar-brand"
            onClick={() => navigate('/')}
            style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
            aria-label="Kembali ke halaman utama"
          >
            <div className="navbar-logo">
              <img src="/sapa.png" alt="SAPA Logo" />
            </div>
            <div>
              <div className="navbar-title">SAPA</div>
              <div className="navbar-subtitle">Melihat Kebutuhan, Bukan Wajah</div>
            </div>
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Timestamp wajib untuk video proof of work — lihat JamLangsung.jsx */}
          <JamLangsung />
          <button
            onClick={() => navigate('/live')}
            style={{
              background: 'rgba(255,255,255,0.12)',
              border: '1.5px solid rgba(255,255,255,0.3)',
              borderRadius: 20,
              color: 'rgba(255,255,255,0.85)',
              fontSize: 12,
              fontWeight: 600,
              padding: '5px 14px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all var(--dur-fast) var(--ease)',
            }}
            onMouseOver={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.22)'; e.currentTarget.style.color = 'white' }}
            onMouseOut={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = 'rgba(255,255,255,0.85)' }}
          >
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: '#FFB3AF',
              animation: 'pulse 1.5s ease-in-out infinite',
              display: 'inline-block',
            }} />
            Mode Live
          </button>
          <div className="navbar-badge">Privacy-by-Design · COMPFEST 18</div>
        </div>
      </nav>

      {/* ── Konten halaman ─────────────────────────────────────────── */}
      {page === 'upload' && (
        <UploadPage
          onAnalyze={handleAnalyze}
          error={error}
          onClearError={() => setError(null)}
        />
      )}
      {page === 'processing' && (
        <ProcessingPage onCancel={handleCancel} fileSizeMB={fileSizeMB} />
      )}
      {page === 'result' && result && (
        <ResultPage result={result} onReset={handleReset} />
      )}
    </div>
  )
}
