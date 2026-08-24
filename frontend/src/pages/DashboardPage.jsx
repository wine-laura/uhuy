import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

/* ─────────────────────────────────────────────────────────────────────────────
   DashboardPage — Dashboard operator mode produksi CCTV

   Sumber data:
     WS   /api/ws/produksi/alert    → snapshot awal + alert langsung + denyut
     GET  /api/produksi/kesehatan   → kesehatan tiap kamera (polling 5 dtk)
     POST /api/produksi/kejadian/{id}/tanggapi
     POST /api/produksi/kamera/{id}/{mulai|berhenti}

   Prefiks /api dibuang oleh nginx (produksi) dan proxy Vite (dev) sebelum
   diteruskan ke backend — lihat docs/PRODUKSI.md.

   Prinsip yang tercermin di UI (KONTEKS §3):
   "AI menandai, manusia memutuskan" — tidak ada tindakan otomatis. Setiap alert
   menunggu staf menekan Konfirmasi atau Abaikan, dan alert yang belum ditanggapi
   sengaja dibuat menonjol agar tidak menumpuk diam-diam.
───────────────────────────────────────────────────────────────────────────── */

const POLL_KESEHATAN_MS = 5000

function buildWsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/api/ws/produksi/alert`
}

function waktuJam(epoch) {
  if (!epoch) return '—'
  return new Date(epoch * 1000).toLocaleTimeString('id-ID', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function waktuRelatif(epoch) {
  if (!epoch) return ''
  const detik = Math.max(0, Math.floor(Date.now() / 1000 - epoch))
  if (detik < 60)   return `${detik} dtk lalu`
  if (detik < 3600) return `${Math.floor(detik / 60)} mnt lalu`
  if (detik < 86400) return `${Math.floor(detik / 3600)} jam lalu`
  return `${Math.floor(detik / 86400)} hari lalu`
}

function durasi(detik) {
  if (detik == null) return '—'
  const j = Math.floor(detik / 3600)
  const m = Math.floor((detik % 3600) / 60)
  if (j > 0) return `${j}j ${m}m`
  if (m > 0) return `${m}m`
  return `${Math.floor(detik)}d`
}

/* Bunyi alert kritis (KONTEKS §6 — jatuh perlu perhatian segera).
   Dibangkitkan lewat WebAudio agar tidak perlu berkas audio eksternal. */
function bunyikanAlarm() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const now = ctx.currentTime
    // Dua nada pendek — cukup menarik perhatian tanpa membuat panik.
    for (let i = 0; i < 2; i++) {
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, now + i * 0.22)
      gain.gain.setValueAtTime(0.0001, now + i * 0.22)
      gain.gain.exponentialRampToValueAtTime(0.25, now + i * 0.22 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.22 + 0.18)
      osc.connect(gain); gain.connect(ctx.destination)
      osc.start(now + i * 0.22)
      osc.stop(now + i * 0.22 + 0.2)
    }
    setTimeout(() => ctx.close(), 1200)
  } catch { /* bunyi bersifat pelengkap — kegagalannya tidak boleh mengganggu UI */ }
}

/* ── Kartu statistik ringkas ────────────────────────────────────────────── */
function StatTile({ label, nilai, satuan, warna, tekanan }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--garis)',
      borderRadius: 'var(--radius-lg)', padding: '14px 16px',
      boxShadow: 'var(--shadow-xs)', flex: '1 1 150px', minWidth: 140,
      borderLeft: `3px solid ${warna || 'var(--garis)'}`,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: 'var(--ink-faint)',
        letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6,
      }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        <span style={{
          fontFamily: "'DM Sans', sans-serif", fontSize: 26, fontWeight: 800,
          color: tekanan ? warna : 'var(--ink)', letterSpacing: '-0.03em', lineHeight: 1,
        }}>{nilai}</span>
        {satuan && <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{satuan}</span>}
      </div>
    </div>
  )
}

/* ── Kartu satu kamera ──────────────────────────────────────────────────── */
function KartuKamera({ k, onMulai, onBerhenti, sibuk }) {
  const [lihatPratinjau, setLihatPratinjau] = useState(false)

  const berjalan  = !!k.berjalan
  const terhubung = !!k.stream?.terhubung
  const isRak     = k.jenis === 'rak'

  // Kamera yang berjalan tapi stream-nya putus adalah kondisi yang paling perlu
  // terlihat: sistem hidup, tapi kamera itu buta.
  const bermasalah = berjalan && !terhubung

  const warnaStatus = bermasalah ? 'var(--waspada)'
    : berjalan ? 'var(--sigap)' : 'var(--ink-faint)'
  const labelStatus = bermasalah ? 'Terputus' : berjalan ? 'Aktif' : 'Berhenti'

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--garis)',
      borderRadius: 'var(--radius-lg)', padding: 14,
      boxShadow: 'var(--shadow-xs)',
      borderLeft: `3px solid ${warnaStatus}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontWeight: 700, fontSize: 14, color: 'var(--ink)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{k.nama}</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 2 }}>
            {k.kamera_id}{k.lokasi ? ` · ${k.lokasi}` : ''}
          </div>
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          fontSize: 11, fontWeight: 700, color: warnaStatus, whiteSpace: 'nowrap',
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%', background: warnaStatus,
            boxShadow: berjalan && terhubung ? `0 0 7px ${warnaStatus}` : 'none',
            animation: berjalan && terhubung ? 'pulse 1.6s ease-in-out infinite' : 'none',
          }} />
          {labelStatus}
        </span>
      </div>

      {/* Jenis kamera → fitur yang aktif. Ditampilkan karena inilah sumber
          kesalahan pemasangan paling sering (KONTEKS §5). */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        <span className={isRak ? 'chip chip-bantu' : 'chip chip-sigap'} style={{ fontSize: 10.5 }}>
          {isRak ? 'Rak (atas)' : 'Lorong (samping)'}
        </span>
        <span className="chip" style={{
          fontSize: 10.5,
          background: k.fall_aktif ? 'var(--waspada-soft)' : 'var(--paper-3)',
          color: k.fall_aktif ? 'var(--waspada-dark)' : 'var(--ink-faint)',
        }}>
          Jatuh {k.fall_aktif ? 'ON' : 'off'}
        </span>
        <span className="chip" style={{
          fontSize: 10.5,
          background: k.interaksi_aktif ? 'var(--bantu-soft)' : 'var(--paper-3)',
          color: k.interaksi_aktif ? 'var(--bantu-dark)' : 'var(--ink-faint)',
        }}>
          Bantuan {k.interaksi_aktif ? 'ON' : 'off'}
        </span>
      </div>

      {/* Kesehatan stream */}
      {berjalan && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(66px,1fr))',
          gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--garis-soft)',
          fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--ink-soft)',
        }}>
          <div><span style={{ color: 'var(--ink-faint)' }}>fps</span><br/>{k.stream?.fps_terukur ?? '—'}</div>
          <div><span style={{ color: 'var(--ink-faint)' }}>uptime</span><br/>{durasi(k.uptime_detik)}</div>
          <div><span style={{ color: 'var(--ink-faint)' }}>alert</span><br/>{k.alert_dikeluarkan ?? 0}</div>
          <div><span style={{ color: 'var(--ink-faint)' }}>reconnect</span><br/>{k.stream?.jumlah_reconnect ?? 0}</div>
        </div>
      )}

      {k.error_terakhir && (
        <div style={{
          marginTop: 10, fontSize: 11.5, color: 'var(--waspada-dark)',
          background: 'var(--waspada-soft)', border: '1px solid var(--waspada-border)',
          borderRadius: 'var(--radius-sm)', padding: '6px 8px', wordBreak: 'break-word',
        }}>⚠ {k.error_terakhir}</div>
      )}

      {/* Pratinjau — dibuka manual. Backend hanya menggambar pratinjau selama
          ada penonton, jadi membiarkannya tertutup benar-benar menghemat CPU. */}
      {lihatPratinjau && berjalan && (
        <div style={{
          marginTop: 10, borderRadius: 'var(--radius-md)', overflow: 'hidden',
          background: '#111', aspectRatio: '16/9',
        }}>
          <img
            src={`/api/produksi/kamera/${encodeURIComponent(k.kamera_id)}/pratinjau`}
            alt={`Pratinjau kerangka ${k.nama}`}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        {berjalan ? (
          <button className="btn btn-ghost" disabled={sibuk}
            onClick={() => onBerhenti(k.kamera_id)}
            style={{ fontSize: 12, padding: '5px 12px' }}>■ Hentikan</button>
        ) : (
          <button className="btn btn-primary" disabled={sibuk}
            onClick={() => onMulai(k.kamera_id)}
            style={{ fontSize: 12, padding: '5px 12px' }}>▶ Jalankan</button>
        )}
        {berjalan && (
          <button className="btn btn-outline"
            onClick={() => setLihatPratinjau(v => !v)}
            style={{ fontSize: 12, padding: '5px 12px' }}>
            {lihatPratinjau ? 'Tutup pratinjau' : 'Lihat pratinjau'}
          </button>
        )}
      </div>
    </div>
  )
}

/* ── Satu baris alert ───────────────────────────────────────────────────── */
function BarisAlert({ ev, onTanggapi, sibuk }) {
  const isJatuh  = ev.tipe === 'jatuh'
  const belum    = ev.status === 'baru'
  const warna    = isJatuh ? 'var(--waspada)' : 'var(--bantu)'
  const warnaBg  = isJatuh ? 'var(--waspada-soft)' : 'var(--bantu-soft)'
  const judul    = isJatuh ? '⚠ Jatuh terdeteksi' : '🙋 Tampak butuh bantuan'

  return (
    <div style={{
      padding: '11px 13px',
      borderBottom: '1px solid var(--garis-soft)',
      background: belum ? warnaBg : 'transparent',
      borderLeft: `3px solid ${belum ? warna : 'transparent'}`,
      opacity: belum ? 1 : 0.62,
      transition: 'all 0.25s var(--ease)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: warna }}>{judul}</span>
        <span className="font-mono" style={{ fontSize: 10, color: 'var(--ink-faint)', whiteSpace: 'nowrap' }}>
          {waktuJam(ev.t_mulai)}
        </span>
      </div>

      <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 3 }}>
        {ev.kamera_nama}
      </div>

      <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', marginTop: 5 }}>
        <span className="font-mono" style={{ fontSize: 10.5, color: 'var(--ink-faint)' }}>
          ID:{ev.track_id}
        </span>
        <span className="font-mono" style={{ fontSize: 10.5, color: 'var(--ink-faint)' }}>
          {Math.round((ev.skor ?? 0) * 100)}% yakin
        </span>
        {ev.detail?.sudut_torso != null && (
          <span className="font-mono" style={{ fontSize: 10.5, color: 'var(--ink-faint)' }}>
            torso {ev.detail.sudut_torso}°
          </span>
        )}
        <span className="font-mono" style={{ fontSize: 10.5, color: 'var(--ink-faint)' }}>
          {waktuRelatif(ev.t_mulai)}
        </span>
      </div>

      {belum ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
          <button className="btn btn-primary" disabled={sibuk}
            onClick={() => onTanggapi(ev.id, 'dikonfirmasi')}
            style={{ fontSize: 11.5, padding: '4px 11px' }}>Konfirmasi</button>
          <button className="btn btn-ghost" disabled={sibuk}
            onClick={() => onTanggapi(ev.id, 'diabaikan')}
            style={{ fontSize: 11.5, padding: '4px 11px' }}>Abaikan</button>
        </div>
      ) : (
        <div style={{ marginTop: 7, fontSize: 11, color: 'var(--ink-faint)' }}>
          {ev.status === 'dikonfirmasi' ? '✓ Dikonfirmasi' : '✕ Diabaikan'}
          {ev.ditanggapi_oleh ? ` oleh ${ev.ditanggapi_oleh}` : ''}
        </div>
      )}
    </div>
  )
}

/* ── Halaman ────────────────────────────────────────────────────────────── */
export default function DashboardPage() {
  const navigate = useNavigate()

  const wsRef       = useRef(null)
  const bisuRef     = useRef(false)
  const reconnectRef = useRef(null)

  const [kesehatan, setKesehatan] = useState(null)
  const [kejadian,  setKejadian]  = useState([])
  const [wsState,   setWsState]   = useState('connecting')
  const [produksiOff, setProduksiOff] = useState(false)
  const [galat,     setGalat]     = useState('')
  const [bisu,      setBisu]      = useState(false)
  const [sibuk,     setSibuk]     = useState(false)
  const [saring,    setSaring]    = useState('semua')
  const [, tick] = useState(0)   // memaksa render ulang agar "x mnt lalu" ikut jalan

  useEffect(() => { bisuRef.current = bisu }, [bisu])

  /* Detak untuk memperbarui label waktu relatif */
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 15000)
    return () => clearInterval(id)
  }, [])

  /* ── Polling kesehatan ─────────────────────────────────────────────────── */
  const ambilKesehatan = useCallback(async () => {
    try {
      const res = await fetch('/api/produksi/kesehatan')
      if (res.status === 503) { setProduksiOff(true); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setProduksiOff(false)
      setKesehatan(await res.json())
      setGalat('')
    } catch (e) {
      setGalat('Backend tidak terjangkau. Pastikan server berjalan di port 8000.')
    }
  }, [])

  useEffect(() => {
    ambilKesehatan()
    const id = setInterval(ambilKesehatan, POLL_KESEHATAN_MS)
    return () => clearInterval(id)
  }, [ambilKesehatan])

  /* ── WebSocket alert ───────────────────────────────────────────────────── */
  const sambungWs = useCallback(() => {
    if (wsRef.current) { try { wsRef.current.close() } catch {} }
    setWsState('connecting')

    let ws
    try { ws = new WebSocket(buildWsUrl()) }
    catch { setWsState('error'); return }
    wsRef.current = ws

    ws.onopen = () => setWsState('connected')

    ws.onmessage = (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }

      if (msg.type === 'awal') {
        setKejadian(msg.kejadian ?? [])
      } else if (msg.type === 'alert' && msg.kejadian) {
        setKejadian(prev => [msg.kejadian, ...prev].slice(0, 200))
        if (msg.kejadian.prioritas === 'kritis' && !bisuRef.current) bunyikanAlarm()
      } else if (msg.type === 'error') {
        setProduksiOff(true)
      }
    }

    ws.onclose = () => {
      setWsState('idle')
      // Dashboard operator harus bertahan semalaman tanpa ditengok. Sambung
      // ulang sendiri, jangan menuntut operator menekan refresh.
      clearTimeout(reconnectRef.current)
      reconnectRef.current = setTimeout(sambungWs, 4000)
    }
    ws.onerror = () => setWsState('error')
  }, [])

  useEffect(() => {
    sambungWs()
    return () => {
      clearTimeout(reconnectRef.current)
      if (wsRef.current) { try { wsRef.current.close() } catch {} }
    }
  }, [sambungWs])

  /* ── Aksi ──────────────────────────────────────────────────────────────── */
  async function tanggapi(id, status) {
    setSibuk(true)
    try {
      const res = await fetch(`/api/produksi/kejadian/${id}/tanggapi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, oleh: 'operator' }),
      })
      if (res.ok) {
        const baru = await res.json()
        setKejadian(prev => prev.map(k => (k.id === id ? baru : k)))
      }
    } catch { /* diabaikan — polling kesehatan tetap menunjukkan kondisi nyata */ }
    finally { setSibuk(false) }
  }

  async function kendaliKamera(id, aksi) {
    setSibuk(true)
    try {
      await fetch(`/api/produksi/kamera/${encodeURIComponent(id)}/${aksi}`, { method: 'POST' })
      await ambilKesehatan()
    } catch { /* sama seperti di atas */ }
    finally { setSibuk(false) }
  }

  /* ── Turunan ───────────────────────────────────────────────────────────── */
  const kamera      = kesehatan?.kamera ?? []
  const belumTanggap = kejadian.filter(k => k.status === 'baru')
  const nJatuh      = kejadian.filter(k => k.tipe === 'jatuh').length
  const nBantuan    = kejadian.filter(k => k.tipe === 'butuh_bantuan').length

  const kejadianTampil = kejadian.filter(k => {
    if (saring === 'belum')   return k.status === 'baru'
    if (saring === 'jatuh')   return k.tipe === 'jatuh'
    if (saring === 'bantuan') return k.tipe === 'butuh_bantuan'
    return true
  })

  const wsHidup = wsState === 'connected'

  return (
    <div className="page-container" style={{ background: 'var(--paper)' }}>
      {/* ── Navbar ─────────────────────────────────────────────────────────── */}
      <nav className="navbar">
        <button className="navbar-brand" onClick={() => navigate('/')}
          style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
          aria-label="Kembali ke halaman utama">
          <div className="navbar-logo">
            <img src="/sapa.png" alt="SAPA Logo" />
          </div>
          <div>
            <div className="navbar-title">SAPA</div>
            <div className="navbar-subtitle">Dashboard Operator</div>
          </div>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: wsHidup ? 'var(--sigap)' : 'var(--waspada)',
              boxShadow: wsHidup ? '0 0 8px var(--sigap)' : 'none',
              animation: wsHidup ? 'pulse 1.6s ease-in-out infinite' : 'none',
            }} />
            <span style={{
              fontSize: 11.5, fontWeight: 700, letterSpacing: '0.05em',
              color: wsHidup ? 'var(--sigap)' : 'var(--waspada)', textTransform: 'uppercase',
            }}>{wsHidup ? 'Terhubung' : 'Terputus'}</span>
          </span>

          <button onClick={() => setBisu(b => !b)}
            title={bisu ? 'Nyalakan bunyi alert' : 'Bisukan bunyi alert'}
            style={{
              background: 'none', border: '1px solid var(--garis)', cursor: 'pointer',
              borderRadius: 20, padding: '4px 11px', fontSize: 12, fontFamily: 'inherit',
              color: bisu ? 'var(--ink-faint)' : 'var(--sigap)', fontWeight: 600,
            }}>
            {bisu ? '🔇 Bisu' : '🔔 Bunyi'}
          </button>

          <div className="navbar-badge">Privacy-by-Design</div>
        </div>
      </nav>

      <main style={{ flex: 1, maxWidth: 1280, width: '100%', margin: '0 auto', padding: '24px 20px 60px' }}>

        {/* ── Mode produksi belum aktif ────────────────────────────────────── */}
        {produksiOff && (
          <div style={{
            background: 'var(--bantu-soft)', border: '1px solid var(--bantu-border)',
            borderRadius: 'var(--radius-lg)', padding: '18px 20px', marginBottom: 22,
          }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--bantu-dark)', marginBottom: 6 }}>
              Mode produksi belum aktif
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.65, marginBottom: 10 }}>
              Backend berjalan, tapi lapisan CCTV sengaja dimatikan secara default agar
              perilaku MVP lomba tidak berubah. Nyalakan dengan:
            </p>
            <pre className="font-mono" style={{
              background: 'var(--surface)', border: '1px solid var(--garis)',
              borderRadius: 'var(--radius-sm)', padding: '10px 12px',
              fontSize: 12, overflowX: 'auto', color: 'var(--ink)', margin: 0,
            }}>{`cd backend
cp data/cameras.example.json data/cameras.json
SAPA_PRODUKSI=1 uvicorn app:app --port 8000`}</pre>
            <p style={{ fontSize: 12.5, color: 'var(--ink-faint)', marginTop: 10 }}>
              Panduan lengkap: <code className="font-mono">docs/PRODUKSI.md</code>
            </p>
          </div>
        )}

        {galat && !produksiOff && (
          <div style={{
            background: 'var(--waspada-soft)', border: '1px solid var(--waspada-border)',
            borderRadius: 'var(--radius-lg)', padding: '12px 16px', marginBottom: 20,
            fontSize: 13.5, color: 'var(--waspada-dark)',
          }}>⚠ {galat}</div>
        )}

        {/* ── Ringkasan ────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
          <StatTile label="Kamera aktif"
            nilai={`${kesehatan?.kamera_berjalan ?? 0}/${kesehatan?.jumlah_kamera ?? 0}`}
            warna="var(--sigap)" />
          <StatTile label="Belum ditanggapi" nilai={belumTanggap.length}
            warna="var(--bantu)" tekanan={belumTanggap.length > 0} />
          <StatTile label="Jatuh" nilai={nJatuh} satuan="kejadian"
            warna="var(--waspada)" tekanan={nJatuh > 0} />
          <StatTile label="Butuh bantuan" nilai={nBantuan} satuan="kejadian"
            warna="var(--bantu)" />
          <StatTile label="Retensi log"
            nilai={kesehatan?.kejadian?.retensi_jam ?? '—'} satuan="jam"
            warna="var(--ink-faint)" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 350px', gap: 22, alignItems: 'start' }}>

          {/* ── Kamera ────────────────────────────────────────────────────── */}
          <section>
            <h2 style={{
              fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)',
              letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 12,
            }}>Kamera</h2>

            {kamera.length === 0 ? (
              <div style={{
                background: 'var(--surface)', border: '1px dashed var(--ink-hairline)',
                borderRadius: 'var(--radius-lg)', padding: '38px 24px', textAlign: 'center',
              }}>
                <div style={{ fontSize: 14, color: 'var(--ink-soft)', marginBottom: 6, fontWeight: 600 }}>
                  Belum ada kamera terdaftar
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', lineHeight: 1.6 }}>
                  Tambahkan lewat <code className="font-mono">backend/data/cameras.json</code>,
                  lalu jalankan ulang backend.
                </div>
              </div>
            ) : (
              <div style={{
                display: 'grid', gap: 12,
                gridTemplateColumns: 'repeat(auto-fill,minmax(268px,1fr))',
              }}>
                {kamera.map(k => (
                  <KartuKamera key={k.kamera_id} k={k} sibuk={sibuk}
                    onMulai={id => kendaliKamera(id, 'mulai')}
                    onBerhenti={id => kendaliKamera(id, 'berhenti')} />
                ))}
              </div>
            )}

            <div className="privacy-note" style={{ marginTop: 14 }}>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                <path d="M6.5 1L1.5 3v3.5c0 3 2.2 5.8 5 6.5 2.8-.7 5-3.5 5-6.5V3L6.5 1z"
                  stroke="var(--ink-faint)" strokeWidth="1.3" fill="none" strokeLinejoin="round" />
              </svg>
              Pratinjau default hanya mengirim kerangka sendi — video mentah tidak keluar dari server.
            </div>
          </section>

          {/* ── Alert ─────────────────────────────────────────────────────── */}
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{
                fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)',
                letterSpacing: '0.07em', textTransform: 'uppercase', margin: 0,
              }}>Alert langsung</h2>
              {belumTanggap.length > 0 && (
                <span className="chip chip-waspada" style={{ fontSize: 10.5 }}>
                  {belumTanggap.length} baru
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap' }}>
              {[
                { id: 'semua',   label: 'Semua' },
                { id: 'belum',   label: 'Belum ditanggapi' },
                { id: 'jatuh',   label: 'Jatuh' },
                { id: 'bantuan', label: 'Bantuan' },
              ].map(o => (
                <button key={o.id} onClick={() => setSaring(o.id)}
                  style={{
                    padding: '4px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 600,
                    fontFamily: 'inherit', cursor: 'pointer',
                    border: `1.5px solid ${saring === o.id ? 'var(--sigap)' : 'var(--garis)'}`,
                    background: saring === o.id ? 'var(--sigap-soft)' : 'var(--surface)',
                    color: saring === o.id ? 'var(--sigap-dark)' : 'var(--ink-soft)',
                    transition: 'all 0.2s',
                  }}>{o.label}</button>
              ))}
            </div>

            <div style={{
              background: 'var(--surface)', border: '1px solid var(--garis)',
              borderRadius: 'var(--radius-lg)', overflow: 'hidden',
              maxHeight: 620, overflowY: 'auto',
            }}>
              {kejadianTampil.length === 0 ? (
                <div style={{ padding: '40px 22px', textAlign: 'center', color: 'var(--ink-faint)', fontSize: 13 }}>
                  {kejadian.length === 0
                    ? <>Belum ada kejadian.<br/>
                        <span style={{ fontSize: 11.5, display: 'block', marginTop: 5 }}>
                          Alert muncul di sini begitu terdeteksi.
                        </span></>
                    : 'Tidak ada kejadian pada saringan ini.'}
                </div>
              ) : kejadianTampil.map(ev => (
                <BarisAlert key={ev.id} ev={ev} sibuk={sibuk} onTanggapi={tanggapi} />
              ))}
            </div>

            <div className="info-box" style={{ marginTop: 10, fontSize: 12 }}>
              AI menandai, manusia memutuskan — sistem tidak pernah bertindak otomatis.
              Setiap alert menunggu konfirmasi staf.
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
