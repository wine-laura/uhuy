import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import JamLangsung from '../components/JamLangsung.jsx'

/* ─────────────────────────────────────────────────────────────────────────────
   LivePage — Mode Live Demo (WebSocket webcam)
   Konek ke /api/ws/live → nginx proxy → backend:8000/ws/live
───────────────────────────────────────────────────────────────────────────── */

const COCO_SKELETON = [
  [0,1],[0,2],[1,3],[2,4],          // wajah
  [5,6],                             // bahu
  [5,7],[7,9],[6,8],[8,10],         // lengan
  [5,11],[6,12],[11,12],            // torso
  [11,13],[13,15],[12,14],[14,16],  // kaki
]

// Warna sama dengan render.py (tapi dalam format CSS)
const C_NORMAL = 'rgba(80,180,80,0.9)'    // hijau — gerakan normal
const C_FALL   = 'rgba(210,40,40,0.95)'   // merah — jatuh
const C_HELP   = 'rgba(240,140,30,0.95)'  // oranye — butuh bantuan (dwell/pasif)
const C_ANGKAT = 'rgba(200,60,200,0.95)'  // ungu  — angkat tangan (permintaan eksplisit)
const C_PEGAWAI= 'rgba(150,150,150,0.95)' // abu   — pegawai (dikecualikan dari bantuan)

function buildWsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/api/ws/live`
}

function trackColor(trackId, activeEvents, pegawai = false) {
  const evs = activeEvents.filter(e => e.track_id === trackId)
  // Jatuh selalu menang. Angkat tangan (sinyal aktif) dibedakan dari dwell
  // supaya permintaan eksplisit terlihat berbeda saat demo.
  if (evs.some(e => e.tipe === 'jatuh'))         return C_FALL
  if (evs.some(e => e.tipe === 'butuh_bantuan' && e.sinyal === 'aktif')) return C_ANGKAT
  if (evs.some(e => e.tipe === 'butuh_bantuan')) return C_HELP
  if (pegawai) return C_PEGAWAI
  return C_NORMAL
}

function drawSkeleton(ctx, keypoints, color) {
  ctx.strokeStyle = color
  ctx.fillStyle   = color
  ctx.lineWidth   = 2.5

  for (const [j1, j2] of COCO_SKELETON) {
    const [x1,y1,c1] = keypoints[j1]
    const [x2,y2,c2] = keypoints[j2]
    if (c1 > 0.25 && c2 > 0.25) {
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
    }
  }
  for (const [x, y, c] of keypoints) {
    if (c > 0.25) {
      ctx.beginPath()
      ctx.arc(x, y, 5, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function drawLabel(ctx, text, x, y, color) {
  ctx.font = 'bold 13px "DM Sans", sans-serif'
  const m   = ctx.measureText(text)
  const pad = 5
  const bx  = x - pad
  const by  = y - 16
  const bw  = m.width + pad * 2
  const bh  = 20

  ctx.fillStyle = 'rgba(0,0,0,0.75)'
  ctx.beginPath()
  ctx.roundRect(bx, by, bw, bh, 4)
  ctx.fill()

  ctx.strokeStyle = color
  ctx.lineWidth   = 1
  ctx.stroke()

  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, x, y)
}

export default function LivePage() {
  const navigate = useNavigate()

  const videoRef     = useRef(null)
  const canvasRef    = useRef(null)
  const wsRef        = useRef(null)
  const timerRef     = useRef(null)
  const rafRef       = useRef(null)
  const startTimeRef = useRef(null)
  const poseRef      = useRef({})    // mutable ref — tidak trigger re-render
  const pegawaiRef   = useRef([])    // track_id yang dikenali pegawai
  const eventsRef    = useRef([])

  // Default 'both': satu kamera webcam biasanya menangkap lorong sekaligus
  // area rak, dan operator tidak perlu memilih mana bahaya yang mau diabaikan.
  const [cameraType, setCameraType] = useState('both')
  const [wsState, setWsState]       = useState('idle')
  const [events,  setEvents]        = useState([])
  const [errorMsg, setErrorMsg]     = useState('')

  const getT = () => startTimeRef.current ? (Date.now() - startTimeRef.current) / 1000 : 0

  /* RAF loop — gambar skeleton terus-menerus */
  function startRafLoop() {
    function loop() {
      const canvas = canvasRef.current
      const video  = videoRef.current
      if (!canvas || !video || video.videoWidth === 0) {
        rafRef.current = requestAnimationFrame(loop)
        return
      }

      // Sinkronkan ukuran canvas dengan video
      if (canvas.width !== video.videoWidth)  canvas.width  = video.videoWidth
      if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight

      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const t = getT()
      const active = eventsRef.current.filter(e => e.t0 <= t && t <= (e.t1 ?? t + 5))

      for (const [trackId, kps] of Object.entries(poseRef.current)) {
        const tid = Number(trackId)
        const col = trackColor(tid, active, pegawaiRef.current.includes(Number(tid)))
        drawSkeleton(ctx, kps, col)

        // Label di atas kepala / bahu
        const [nx, ny, nc] = kps[0]
        const cx = nc > 0.25 ? nx : (kps[5][0] + kps[6][0]) / 2
        const cy = nc > 0.25 ? ny : (kps[5][1] + kps[6][1]) / 2

        const isPegawai = pegawaiRef.current.includes(Number(tid))
        const hasFall   = active.some(e => e.track_id === tid && e.tipe === 'jatuh')
        const hasAngkat = active.some(e => e.track_id === tid && e.tipe === 'butuh_bantuan' && e.sinyal === 'aktif')
        const hasHelp   = active.some(e => e.track_id === tid && e.tipe === 'butuh_bantuan')
        const statusTxt = hasFall ? 'JATUH!'
          : hasAngkat ? 'ANGKAT TANGAN'
          : hasHelp ? 'BUTUH BANTUAN'
          : isPegawai ? 'Pegawai' : 'Normal'
        const prefix = isPegawai ? 'PEGAWAI ' : ''
        drawLabel(ctx, `${prefix}ID:${tid}  ${statusTxt}`, cx - 30, cy - 12, col)
      }

      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
  }

  function stopRafLoop() {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
  }

  /* Mulai live */
  const startLive = useCallback(async () => {
    setErrorMsg('')
    setWsState('connecting')
    setEvents([])
    poseRef.current  = {}
    eventsRef.current = []

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'environment' },
        audio: false,
      })
    } catch {
      setErrorMsg('Tidak bisa mengakses kamera. Pastikan izin kamera sudah diberikan.')
      setWsState('error')
      return
    }

    const video = videoRef.current
    video.srcObject = stream
    await new Promise(res => { video.onloadedmetadata = res })
    video.play()

    // Mulai RAF loop langsung setelah video ready
    startRafLoop()

    const ws = new WebSocket(buildWsUrl())
    wsRef.current    = ws
    startTimeRef.current = Date.now()

    ws.onopen = () => {
      setWsState('connected')

      const offscreen = document.createElement('canvas')
      const octx = offscreen.getContext('2d')

      timerRef.current = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return
        const v = videoRef.current
        if (!v || v.videoWidth === 0) return

        offscreen.width  = v.videoWidth
        offscreen.height = v.videoHeight
        octx.drawImage(v, 0, 0)
        const image = offscreen.toDataURL('image/jpeg', 0.65)

        ws.send(JSON.stringify({ type: 'frame', image, t: getT(), camera_type: cameraType }))
      }, 200)
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'pose') {
          poseRef.current = msg.tracks ?? {}  // update langsung, RAF loop ambil sendiri
          pegawaiRef.current = msg.pegawai ?? []
        } else if (msg.type === 'event') {
          eventsRef.current = [msg, ...eventsRef.current].slice(0, 50)
          setEvents(ev => [msg, ...ev].slice(0, 50))  // update UI
        } else if (msg.type === 'error') {
          setErrorMsg(msg.detail ?? 'Error dari server.')
        }
      } catch {}
    }

    ws.onerror = () => {
      setErrorMsg('Koneksi WebSocket gagal. Pastikan backend berjalan.')
      setWsState('error')
      stopLive()
    }

    ws.onclose = () => {
      setWsState(st => st === 'connected' ? 'idle' : st)
    }
  }, [cameraType])

  /* Hentikan live */
  const stopLive = useCallback(() => {
    clearInterval(timerRef.current)
    timerRef.current = null
    stopRafLoop()

    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    const video = videoRef.current
    if (video?.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop())
      video.srcObject = null
    }

    poseRef.current   = {}
    eventsRef.current = []
    setWsState('idle')

    // Bersihkan canvas
    const canvas = canvasRef.current
    if (canvas) {
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [])

  /* Bersihkan saat unmount */
  useEffect(() => () => stopLive(), [])

  const isRunning = wsState === 'connected'
  const isLoading = wsState === 'connecting'

  function formatTime(sec) {
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return `${m}:${String(s).padStart(2,'0')}`
  }

  return (
    <div className="page-container" style={{ background: 'var(--paper)' }}>
      {/* ── Navbar ─────────────────────────────────────────────────── */}
      <nav className="navbar">
        <button
          className="navbar-brand"
          onClick={() => { stopLive(); navigate('/') }}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Timestamp wajib untuk video proof of work — lihat JamLangsung.jsx */}
          <JamLangsung ringkas />
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: isRunning ? '#ef4444' : 'var(--ink-faint)',
            boxShadow: isRunning ? '0 0 8px #ef4444' : 'none',
            animation: isRunning ? 'pulse 1.2s ease-in-out infinite' : 'none',
            display: 'inline-block',
          }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: isRunning ? '#ef4444' : 'var(--ink-faint)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {isRunning ? 'LIVE' : 'Mode Live (Demo)'}
          </span>
          <div className="navbar-badge" style={{ marginLeft: 8 }}>Privacy-by-Design</div>
        </div>
      </nav>

      <main style={{ flex: 1, maxWidth: 1200, width: '100%', margin: '0 auto', padding: '32px 20px 60px' }}>
        <div style={{ marginBottom: 24, textAlign: 'center' }}>
          <h1 style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 'clamp(22px,4vw,36px)',
            fontWeight: 800, marginBottom: 10, color: 'var(--ink)', letterSpacing: '-0.03em',
          }}>
            Mode Kamera Real-time
          </h1>
          <p style={{ color: 'var(--ink-soft)', fontSize: 15, maxWidth: 480, margin: '0 auto', lineHeight: 1.6 }}>
            Deteksi real-time via WebSocket — hanya dari kerangka tubuh, tanpa mengenali wajah.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 310px', gap: 24, alignItems: 'start' }}>
          {/* ── Video + Canvas overlay ──────────────────────────────── */}
          <div>
            <div style={{
              borderRadius: 'var(--radius-xl)', overflow: 'hidden',
              background: '#111', border: '1px solid var(--garis)',
              boxShadow: 'var(--shadow-md)', position: 'relative',
              aspectRatio: '16/9',
            }}>
              <video
                ref={videoRef}
                muted playsInline
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              <canvas
                ref={canvasRef}
                style={{
                  position: 'absolute', top: 0, left: 0,
                  width: '100%', height: '100%', pointerEvents: 'none',
                }}
              />

              {/* Placeholder */}
              {!isRunning && !isLoading && (
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(245,243,234,0.93)', gap: 14,
                }}>
                  <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
                    <circle cx="28" cy="28" r="24" stroke="var(--garis)" strokeWidth="1.5" fill="var(--paper-2)" />
                    <circle cx="28" cy="18" r="6" stroke="var(--ink-faint)" strokeWidth="1.8" />
                    <path d="M16 40c0-6.6 5.4-12 12-12s12 5.4 12 12" stroke="var(--ink-faint)" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                  <span style={{ fontSize: 14, color: 'var(--ink-soft)', fontWeight: 500 }}>
                    Klik "Mulai Live" untuk mengaktifkan kamera
                  </span>
                </div>
              )}
              {isLoading && (
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(245,243,234,0.93)', gap: 12,
                }}>
                  <div className="progress-track" style={{ width: 160 }}>
                    <div className="progress-sweep" />
                  </div>
                  <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Menghubungkan…</span>
                </div>
              )}
            </div>

            {/* Legenda warna */}
            <div style={{
              marginTop: 10, display: 'flex', gap: 16, flexWrap: 'wrap',
              fontSize: 12, color: 'var(--ink-soft)',
            }}>
              {[
                { color: C_NORMAL, label: 'Hijau = Gerakan normal' },
                { color: C_HELP,   label: 'Oranye = Butuh bantuan' },
                { color: C_ANGKAT, label: 'Ungu = Angkat tangan' },
                { color: C_FALL,   label: 'Merah = Jatuh terdeteksi' },
                { color: C_PEGAWAI,label: 'Abu = Pegawai (tetap dicek jatuh)' },
              ].map(({ color, label }) => (
                <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 12, height: 4, borderRadius: 99, background: color, display: 'inline-block' }} />
                  {label}
                </span>
              ))}
            </div>

            {/* Kontrol */}
            <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {[
                  { id:'both',   label:'Semua Fitur' },
                  { id:'lorong', label:'Lorong (Samping)' },
                  { id:'rak',    label:'Rak (Atas)' },
                ].map(opt => (
                  <button
                    key={opt.id} type="button"
                    onClick={() => setCameraType(opt.id)}
                    disabled={isRunning || isLoading}
                    style={{
                      padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                      fontFamily: 'inherit', cursor: isRunning || isLoading ? 'not-allowed' : 'pointer',
                      border: `1.5px solid ${cameraType === opt.id ? 'var(--sigap)' : 'var(--garis)'}`,
                      background: cameraType === opt.id ? 'var(--sigap-soft)' : 'var(--surface)',
                      color: cameraType === opt.id ? 'var(--sigap-dark)' : 'var(--ink-soft)',
                      transition: 'all 0.2s', opacity: isRunning ? 0.5 : 1,
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {!isRunning ? (
                <button
                  id="start-live-btn" type="button"
                  className="btn btn-primary"
                  onClick={startLive} disabled={isLoading}
                  style={{ fontSize: 14, padding: '8px 22px' }}
                >
                  {isLoading ? 'Menghubungkan…' : '▶ Mulai Live'}
                </button>
              ) : (
                <button
                  id="stop-live-btn" type="button"
                  className="btn btn-ghost"
                  onClick={stopLive}
                  style={{ fontSize: 14, padding: '8px 22px' }}
                >
                  ■ Hentikan
                </button>
              )}

              {errorMsg && (
                <span style={{ fontSize: 13, color: 'var(--waspada-dark)', fontWeight: 500 }}>
                  ⚠ {errorMsg}
                </span>
              )}
            </div>

            <div className="privacy-note" style={{ marginTop: 10 }}>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                <path d="M6.5 1L1.5 3v3.5c0 3 2.2 5.8 5 6.5 2.8-.7 5-3.5 5-6.5V3L6.5 1z"
                  stroke="var(--ink-faint)" strokeWidth="1.3" fill="none" strokeLinejoin="round" />
              </svg>
              Video hanya diproses di server lokal — tidak direkam atau disimpan
            </div>
          </div>

          {/* ── Log kejadian live ────────────────────────────────────── */}
          <div>
            <div style={{
              fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)',
              letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 10,
            }}>
              Kejadian Live
            </div>

            <div style={{
              background: 'var(--surface)', border: '1px solid var(--garis)',
              borderRadius: 'var(--radius-lg)', padding: '4px 0',
              maxHeight: 440, overflowY: 'auto',
            }}>
              {events.length === 0 ? (
                <div style={{ padding: '36px 24px', textAlign: 'center', color: 'var(--ink-faint)', fontSize: 13 }}>
                  {isRunning ? (
                    <span>🔍 Memantau...<br/><span style={{ fontSize: 11, marginTop: 4, display: 'block' }}>skeleton akan muncul di kamera saat terdeteksi</span></span>
                  ) : 'Belum ada kejadian'}
                </div>
              ) : events.map((ev, i) => {
                const isFall   = ev.tipe === 'jatuh'
                const isAngkat = !isFall && ev.sinyal === 'aktif'
                const color   = isFall ? 'var(--waspada)'      : 'var(--bantu)'
                const bgColor = isFall ? 'var(--waspada-soft)' : 'var(--bantu-soft)'
                const label   = isFall ? '⚠ Jatuh Terdeteksi'
                  : isAngkat ? '🙋 Angkat Tangan — Minta Bantuan'
                  : '👀 Tampak Butuh Bantuan'
                return (
                  <div key={i} style={{
                    padding: '10px 14px',
                    borderBottom: i < events.length - 1 ? '1px solid var(--garis-soft)' : 'none',
                    background: i === 0 ? bgColor : 'transparent',
                    transition: 'background 0.3s',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color }}>{label}</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--ink-faint)' }}>
                        {formatTime(ev.t0)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--ink-faint)' }}>
                        ID:{ev.track_id}
                      </span>
                      {ev.skor != null && (
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--ink-faint)' }}>
                          {Math.round(ev.skor * 100)}% yakin
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="info-box" style={{ marginTop: 10, fontSize: 12 }}>
              Overlay kerangka sendi langsung digambar di atas video — wajah tidak dikenali.
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
