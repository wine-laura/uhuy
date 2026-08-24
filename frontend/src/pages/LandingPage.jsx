import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

/* ─────────────────────────────────────────────────────────────────────────────
   LandingPage — Editorial premium redesign
   Inspired by: Linear, Loom, Vercel, Arc Browser landing pages
   Key principles:
   - Asymmetry over symmetry
   - Texture & grain over flat
   - Unexpected type scales
   - Real whitespace rhythm
   - Micro-interactions everywhere
───────────────────────────────────────────────────────────────────────────── */

/* ── Noise texture overlay ──────────────────────────────────────────────────── */
const NoiseOverlay = () => (
  <div style={{
    position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 999,
    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
    opacity: 0.025,
  }} />
)

/* ── Interactive Mockup ─────────────────────────────────────────────────────── */
function ProductMockup() {
  const [coords, setCoords] = useState({ x: 0, y: 0 })
  const [hovered, setHovered] = useState(false)
  const containerRef = useRef(null)

  const handleMouseMove = (e) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 24 - 12
    const y = ((e.clientY - rect.top) / rect.height) * 24 - 12
    setCoords({ x, y })
  }

  const ox = hovered ? coords.x : 0
  const oy = hovered ? coords.y : 0

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setCoords({ x: 0, y: 0 }) }}
      style={{
        width: '100%',
        maxWidth: 420,
        background: 'var(--surface)',
        border: '1px solid var(--garis)',
        borderRadius: 20,
        boxShadow: hovered
          ? '0 32px 80px rgba(26,28,24,0.14), 0 8px 24px rgba(26,28,24,0.06)'
          : '0 16px 48px rgba(26,28,24,0.08), 0 2px 8px rgba(26,28,24,0.04)',
        overflow: 'hidden',
        flexShrink: 0,
        transition: 'box-shadow 400ms cubic-bezier(0.16,1,0.3,1)',
        transform: hovered ? `perspective(1000px) rotateX(${-oy * 0.3}deg) rotateY(${ox * 0.3}deg)` : 'none',
      }}
    >
      {/* Window bar */}
      <div style={{
        padding: '10px 14px',
        background: 'var(--paper-2)',
        borderBottom: '1px solid var(--garis)',
        display: 'flex',
        alignItems: 'center',
        gap: 5,
      }}>
        {['#E5715A', '#DEB94E', '#6CB96F'].map((c, i) => (
          <span key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: c, display: 'inline-block' }} />
        ))}
        <span style={{
          marginLeft: 'auto',
          fontSize: 9,
          fontFamily: "'JetBrains Mono', monospace",
          color: 'var(--ink-faint)',
          letterSpacing: '0.05em',
        }}>
          {hovered ? `X:${coords.x.toFixed(1)} Y:${coords.y.toFixed(1)}` : 'FEED_CCTV_02'}
        </span>
      </div>

      {/* CCTV dark frame */}
      <div style={{
        background: '#0D0F0C',
        padding: '16px 18px 12px',
        position: 'relative',
      }}>
        {/* Alert badge */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: 'var(--waspada)',
          color: 'white',
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.09em',
          padding: '4px 10px',
          borderRadius: 4,
          marginBottom: 18,
          textTransform: 'uppercase',
        }}>
          <span style={{
            width: 5, height: 5, borderRadius: '50%',
            background: 'rgba(255,255,255,0.8)',
            animation: 'pulse 1.5s ease-in-out infinite',
            display: 'inline-block',
          }} />
          Jatuh Terdeteksi
        </div>

        {/* Figure area */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 150, position: 'relative' }}>
          <svg width="100%" height="150" style={{ position: 'absolute', inset: 0, opacity: 0.04 }}>
            <defs>
              <pattern id="cctv-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="white" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#cctv-grid)" />
          </svg>

          <svg width="72" height="108" viewBox="0 0 72 108" fill="none" aria-hidden="true"
            style={{ transition: 'transform 200ms ease', transform: `translate(${ox * 0.12}px, ${oy * 0.08}px)` }}>
            <circle cx={36 + ox * 0.4} cy={12 + oy * 0.3} r="9" stroke="#DE9F3C" strokeWidth="1.8" />
            <line x1={36 + ox * 0.4} y1={21 + oy * 0.3} x2={36 + ox * 0.1} y2={52 + oy * 0.1} stroke="#DE9F3C" strokeWidth="1.8" strokeLinecap="round" />
            <line x1={36 + ox * 0.4} y1={32 + oy * 0.3} x2={16 + ox * 0.7} y2={44 + oy * 0.5} stroke="#DE9F3C" strokeWidth="1.8" strokeLinecap="round" />
            <line x1={36 + ox * 0.4} y1={32 + oy * 0.3} x2={56 + ox * 0.2} y2={40 + oy * 0.1} stroke="#DE9F3C" strokeWidth="1.8" strokeLinecap="round" />
            <line x1={36 + ox * 0.1} y1={52 + oy * 0.1} x2={26 + ox * 0.2} y2={78 + oy * 0.1} stroke="#DE9F3C" strokeWidth="1.8" strokeLinecap="round" />
            <line x1={36 + ox * 0.1} y1={52 + oy * 0.1} x2={48 + ox * 0.1} y2={76 + oy * 0.1} stroke="#DE9F3C" strokeWidth="1.8" strokeLinecap="round" />
            <line x1={26 + ox * 0.2} y1={78 + oy * 0.1} x2={22 + ox * 0.3} y2={96 + oy * 0.2} stroke="#DE9F3C" strokeWidth="1.8" strokeLinecap="round" />
            <line x1={48 + ox * 0.1} y1={76 + oy * 0.1} x2={52 + ox * 0.2} y2={94 + oy * 0.2} stroke="#DE9F3C" strokeWidth="1.8" strokeLinecap="round" />
            {[
              [36 + ox * 0.4, 21 + oy * 0.3], [16 + ox * 0.7, 44 + oy * 0.5],
              [56 + ox * 0.2, 40 + oy * 0.1], [26 + ox * 0.2, 78 + oy * 0.1],
              [48 + ox * 0.1, 76 + oy * 0.1],
            ].map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r="2.8" fill="#DE9F3C" opacity="0.9" />)}
          </svg>

          {/* Confidence label */}
          <div style={{
            position: 'absolute', right: 8, bottom: 4,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9, color: 'rgba(222,159,60,0.7)', letterSpacing: '0.05em',
          }}>
            conf: 0.91
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderTop: '1px solid var(--garis)' }}>
        {[
          { val: '2', label: 'butuh bantuan' },
          { val: '1', label: 'deteksi jatuh' },
          { val: '02:14', label: 'durasi', mono: true },
        ].map((s, i) => (
          <div key={i} style={{
            padding: '12px 14px',
            borderRight: i < 2 ? '1px solid var(--garis)' : 'none',
          }}>
            <div style={{
              fontSize: 20,
              fontWeight: 700,
              fontFamily: s.mono ? "'JetBrains Mono', monospace" : "'Instrument Serif', Georgia, serif",
              color: 'var(--ink)',
              letterSpacing: s.mono ? '0.02em' : '-0.02em',
              marginBottom: 2,
              lineHeight: 1,
            }}>
              {s.val}
            </div>
            <div style={{ fontSize: 10, color: 'var(--ink-faint)', fontWeight: 500, lineHeight: 1.3 }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Privacy badge */}
      <div style={{
        padding: '8px 14px 12px',
        display: 'flex',
        justifyContent: 'flex-end',
        borderTop: '1px solid var(--garis-soft)',
      }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          background: 'var(--sigap-soft)',
          border: '1px solid rgba(44,93,75,0.15)',
          borderRadius: 20, padding: '3px 10px',
          fontSize: 9, fontWeight: 600, color: 'var(--sigap-dark)',
        }}>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--sigap)', display: 'inline-block' }} />
          Wajah tidak dikenali
        </div>
      </div>
    </div>
  )
}

/* ── Marquee strip ──────────────────────────────────────────────────────────── */
function MarqueeStrip() {
  const items = [
    'Privacy-by-Design', '17 Titik Sendi', '0 Wajah Dikenali',
    'BiLSTM Model', 'CCTV Analytics', 'Real-time Detection',
    'UU PDP Selaras', 'Human-in-the-Loop', 'On-premise Ready',
  ]
  return (
    <div style={{
      borderTop: '1px solid var(--garis)',
      borderBottom: '1px solid var(--garis)',
      background: 'var(--paper)',
      overflow: 'hidden',
      padding: '10px 0',
      position: 'relative',
    }}>
      <div style={{
        display: 'flex',
        gap: 0,
        animation: 'marqueeScroll 28s linear infinite',
        width: 'max-content',
      }}>
        {[...items, ...items].map((item, i) => (
          <span key={i} style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 16,
            paddingRight: 40,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: i % 3 === 1 ? 'var(--sigap)' : 'var(--ink-faint)',
            whiteSpace: 'nowrap',
          }}>
            {item}
            <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--garis)', display: 'inline-block', flexShrink: 0 }} />
          </span>
        ))}
      </div>
    </div>
  )
}

/* ── Navbar ──────────────────────────────────────────────────────────────────── */
function LandingNav({ onCTA, onLive }) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav style={{
      position: 'sticky', top: 0, zIndex: 100,
      padding: '0 32px', height: 56,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: 'var(--sigap)',
      borderBottom: '1px solid rgba(255,255,255,0.1)',
      transition: 'background 300ms, border-color 300ms',
    }}>
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
          background: '#ffffff',
          padding: 3,
          boxShadow: '0 2px 6px rgba(0, 0, 0, 0.12)',
          border: '1.5px solid rgba(255, 255, 255, 0.4)',
        }}>
          <img src="/sapa.png" alt="SAPA Logo" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        </div>
        <span style={{
          fontFamily: "'Instrument Serif', Georgia, serif",
          fontSize: 22, fontWeight: 600, color: 'white', letterSpacing: '-0.02em',
        }}>
          SAPA
        </span>
      </div>

      {/* Center nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {[
          { label: 'Cara Kerja', href: '#cara-kerja' },
          { label: 'Privasi', href: '#privasi' },
        ].map(link => (
          <a key={link.label} href={link.href} style={{
            fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.8)',
            textDecoration: 'none', padding: '5px 13px', borderRadius: 20,
            transition: 'color 120ms, background 120ms',
          }}
          onMouseOver={e => { e.target.style.color = 'white'; e.target.style.background = 'rgba(255,255,255,0.12)' }}
          onMouseOut={e => { e.target.style.color = 'rgba(255,255,255,0.8)'; e.target.style.background = 'transparent' }}>
            {link.label}
          </a>
        ))}
        <button type="button" onClick={onLive}
          style={{
            fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.8)',
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '5px 13px', borderRadius: 20, fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 5,
            transition: 'color 120ms, background 120ms',
          }}
          onMouseOver={e => { e.currentTarget.style.color = 'white'; e.currentTarget.style.background = 'rgba(255,255,255,0.12)' }}
          onMouseOut={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.8)'; e.currentTarget.style.background = 'transparent' }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: '#FFB3AF', display: 'inline-block',
            animation: 'pulse 1.5s ease-in-out infinite',
          }} />
          Mode Live
        </button>
      </div>

      {/* CTA */}
      <button id="nav-cta-btn" type="button" onClick={onCTA} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: 'rgba(255,255,255,0.18)', color: 'white',
        fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
        padding: '8px 18px', borderRadius: 50, border: '1.5px solid rgba(255,255,255,0.3)', cursor: 'pointer',
        boxShadow: 'none',
        transition: 'all 200ms cubic-bezier(0.16,1,0.3,1)',
        letterSpacing: '-0.01em',
      }}
      onMouseOver={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.28)'; e.currentTarget.style.transform = 'translateY(-1px)' }}
      onMouseOut={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.18)'; e.currentTarget.style.transform = 'translateY(0)' }}>
        Mulai Analisis →
      </button>
    </nav>
  )
}

/* ── Hero ────────────────────────────────────────────────────────────────────── */
function HeroSection({ onCTA, onScrollHow }) {
  return (
    <section style={{ padding: '72px 40px 64px', maxWidth: 1160, margin: '0 auto' }}>
      {/* Top row: eyebrow + mockup floating */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 48, flexWrap: 'wrap' }}>
        {/* Left */}
        <div style={{ flex: '0 0 520px', maxWidth: 520 }}>
          {/* Eyebrow */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            marginBottom: 32,
          }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'var(--sigap-soft)', border: '1px solid rgba(44,93,75,0.2)',
              borderRadius: 4, padding: '4px 10px',
              fontSize: 10, fontWeight: 700, color: 'var(--sigap-dark)',
              letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
              <span style={{
                width: 5, height: 5, borderRadius: '50%',
                background: 'var(--sigap)', display: 'inline-block',
                animation: 'pulse 2s ease-in-out infinite',
              }} />
              COMPFEST 18 · AI Innovation
            </span>
          </div>

          {/* Big headline — editorial style */}
          <h1 style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 'clamp(48px, 5.8vw, 72px)',
            fontWeight: 400,
            lineHeight: 1.02,
            letterSpacing: '-0.025em',
            color: 'var(--ink)',
            marginBottom: 0,
          }}>
            Staf lebih sigap,
          </h1>
          <h1 style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 'clamp(48px, 5.8vw, 72px)',
            fontWeight: 400,
            lineHeight: 1.02,
            letterSpacing: '-0.025em',
            color: 'var(--ink)',
            marginBottom: 4,
          }}>
            tanpa{' '}
            <span style={{
              color: 'var(--sigap)',
              fontStyle: 'italic',
              display: 'inline-block',
            }}>
              mengintai.
            </span>
          </h1>

          {/* Rule */}
          <div style={{ width: 40, height: 2, background: 'var(--sigap)', borderRadius: 2, marginBottom: 24, marginTop: 20 }} />

          {/* Body */}
          <p style={{
            fontSize: 15.5,
            color: 'var(--ink-soft)',
            lineHeight: 1.74,
            marginBottom: 40,
            maxWidth: 420,
          }}>
            SAPA membaca gerak tubuh dari rekaman CCTV — bukan wajah, bukan identitas — untuk{' '}
            <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>menandai pelanggan yang butuh bantuan</strong>
            , dan memberi tahu lebih cepat saat ada yang jatuh.
          </p>

          {/* CTAs */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button id="hero-cta-primary" type="button" onClick={onCTA} style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: 'var(--sigap)', color: 'white',
              fontSize: 15, fontWeight: 600, fontFamily: 'inherit',
              padding: '13px 28px', borderRadius: 50, border: 'none', cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(44,93,75,0.28)',
              transition: 'all 240ms cubic-bezier(0.16,1,0.3,1)',
              letterSpacing: '-0.01em',
            }}
            onMouseOver={e => {
              e.currentTarget.style.background = 'var(--sigap-dark)'
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 8px 28px rgba(44,93,75,0.36)'
            }}
            onMouseOut={e => {
              e.currentTarget.style.background = 'var(--sigap)'
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 20px rgba(44,93,75,0.28)'
            }}>
              Coba dengan Video Sendiri
            </button>
            <button id="hero-cta-how" type="button" onClick={onScrollHow} style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: 'transparent', color: 'var(--ink-soft)',
              fontSize: 14, fontWeight: 500, fontFamily: 'inherit',
              padding: '12px 20px', borderRadius: 50, border: 'none', cursor: 'pointer',
              transition: 'color 120ms',
            }}
            onMouseOver={e => e.currentTarget.style.color = 'var(--ink)'}
            onMouseOut={e => e.currentTarget.style.color = 'var(--ink-soft)'}>
              Lihat cara kerja ↓
            </button>
          </div>

          {/* Trust strip */}
          <div style={{
            marginTop: 28,
            display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
          }}>
            {['Gratis', 'Tanpa akun', 'Video dihapus otomatis'].map((t, i) => (
              <span key={i} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 12, color: 'var(--ink-faint)', fontWeight: 500,
              }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <circle cx="5" cy="5" r="4" stroke="var(--sigap)" strokeWidth="1.2" />
                  <polyline points="3,5 4.5,6.5 7,3.5" stroke="var(--sigap)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* Right — mockup */}
        <div style={{ flex: '1 1 360px', display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
          <ProductMockup />
        </div>
      </div>
    </section>
  )
}

/* ── Big number row ──────────────────────────────────────────────────────────── */
function NumbersSection() {
  const nums = [
    { big: '17', tiny: 'titik sendi', sub: 'dianalisis per orang' },
    { big: '0', tiny: 'wajah', sub: 'pernah dikenali', green: true },
    { big: '3s', tiny: 'window', sub: 'deteksi insiden', mono: true },
    { big: '2', tiny: 'model', sub: 'BiLSTM terlatih' },
  ]
  return (
    <div style={{
      borderTop: '1px solid var(--garis)',
      borderBottom: '1px solid var(--garis)',
      background: 'var(--paper)',
    }}>
      <div style={{ maxWidth: 1160, margin: '0 auto', padding: '0 40px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {nums.map((n, i) => (
            <div key={i} style={{
              padding: '36px 24px',
              borderRight: i < 3 ? '1px solid var(--garis)' : 'none',
              position: 'relative',
            }}>
              <div style={{
                fontFamily: n.mono ? "'JetBrains Mono', monospace" : "'Instrument Serif', Georgia, serif",
                fontSize: n.mono ? 44 : 52,
                fontWeight: 400,
                letterSpacing: '-0.03em',
                color: n.green ? 'var(--sigap)' : 'var(--ink)',
                lineHeight: 1,
                marginBottom: 8,
              }}>
                {n.big}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', marginBottom: 2 }}>{n.tiny}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{n.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Feature cards — Editorial, asymmetric ──────────────────────────────────── */
function FiturSection() {
  return (
    <section style={{ padding: '100px 40px 80px' }}>
      <div style={{ maxWidth: 1160, margin: '0 auto' }}>
        {/* Eyebrow */}
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: 'var(--sigap)',
          marginBottom: 16,
        }}>
          Kemampuan
        </div>

        {/* Headline */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 56, flexWrap: 'wrap', gap: 16 }}>
          <h2 style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 'clamp(32px, 4vw, 48px)',
            fontWeight: 400, letterSpacing: '-0.025em', color: 'var(--ink)',
            lineHeight: 1.08, maxWidth: 480, margin: 0,
          }}>
            Dua hal yang paling sering luput
          </h2>
          <p style={{ fontSize: 14, color: 'var(--ink-faint)', maxWidth: 300, lineHeight: 1.65, margin: 0 }}>
            Staf sibuk. Kamera jadi rekaman yang hanya ditonton setelah masalah terjadi.
          </p>
        </div>

        {/* Asymmetric 2-col + 1 tall col */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Card 1 — Pelayanan */}
          <div style={{
            background: 'var(--bantu-soft)',
            border: '1px solid var(--bantu-border)',
            borderRadius: 20, padding: '40px 36px',
            display: 'flex', flexDirection: 'column', gap: 24,
          }}>
            <div style={{
              display: 'inline-block',
              fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase',
              color: 'var(--bantu-dark)', background: 'rgba(217,138,41,0.15)',
              padding: '4px 10px', borderRadius: 4,
              alignSelf: 'flex-start',
            }}>
              Pelayanan
            </div>
            <div>
              <h3 style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em',
                color: 'var(--ink)', marginBottom: 12, lineHeight: 1.2,
              }}>
                Pelanggan ragu di depan rak
              </h3>
              <p style={{ fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.75 }}>
                Berdiri lama, menimbang produk berulang — tapi tak ada staf yang menghampiri.
                Sering berujung pergi tanpa membeli.
              </p>
            </div>

            {/* Mini visualization */}
            <div style={{
              marginTop: 'auto',
              background: 'rgba(217,138,41,0.08)',
              border: '1px solid var(--bantu-border)',
              borderRadius: 12, padding: '18px 20px',
              display: 'flex', alignItems: 'center', gap: 16,
            }}>
              <svg width="44" height="60" viewBox="0 0 44 60" fill="none" aria-hidden="true">
                <circle cx="22" cy="8" r="6" stroke="var(--bantu)" strokeWidth="1.8" />
                <line x1="22" y1="14" x2="22" y2="32" stroke="var(--bantu)" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="22" y1="21" x2="9" y2="27" stroke="var(--bantu)" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="22" y1="21" x2="37" y2="25" stroke="var(--bantu)" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="22" y1="32" x2="16" y2="50" stroke="var(--bantu)" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="22" y1="32" x2="28" y2="50" stroke="var(--bantu)" strokeWidth="1.8" strokeLinecap="round" />
                {[[22,14],[9,27],[37,25],[16,50],[28,50]].map(([cx,cy],i) => (
                  <circle key={i} cx={cx} cy={cy} r="2.8" fill="var(--bantu)" />
                ))}
              </svg>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--bantu-dark)', marginBottom: 4 }}>
                  Diam + interaksi tangan terdeteksi
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
                  Kamera top-down · BiLSTM Interaksi
                </div>
              </div>
            </div>
          </div>

          {/* Card 2 — Keselamatan */}
          <div style={{
            background: 'var(--waspada-soft)',
            border: '1px solid var(--waspada-border)',
            borderRadius: 20, padding: '40px 36px',
            display: 'flex', flexDirection: 'column', gap: 24,
          }}>
            <div style={{
              display: 'inline-block',
              fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase',
              color: 'var(--waspada-dark)', background: 'rgba(179,59,50,0.12)',
              padding: '4px 10px', borderRadius: 4,
              alignSelf: 'flex-start',
            }}>
              Keselamatan
            </div>
            <div>
              <h3 style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em',
                color: 'var(--ink)', marginBottom: 12, lineHeight: 1.2,
              }}>
                Kejadian jatuh yang telat diketahui
              </h3>
              <p style={{ fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.75 }}>
                Lorong sepi, tak ada yang melihat langsung — padahal setiap detik penting
                untuk lansia atau kondisi darurat.
              </p>
            </div>

            <div style={{
              marginTop: 'auto',
              background: 'rgba(179,59,50,0.06)',
              border: '1px solid var(--waspada-border)',
              borderRadius: 12, padding: '18px 20px',
              display: 'flex', alignItems: 'center', gap: 16,
            }}>
              <svg width="64" height="40" viewBox="0 0 64 40" fill="none" aria-hidden="true">
                <circle cx="9" cy="18" r="6" stroke="var(--waspada)" strokeWidth="1.8" />
                <line x1="15" y1="18" x2="38" y2="18" stroke="var(--waspada)" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="24" y1="18" x2="24" y2="8" stroke="var(--waspada)" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="24" y1="8" x2="40" y2="6" stroke="var(--waspada)" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="38" y1="18" x2="50" y2="30" stroke="var(--waspada)" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="38" y1="18" x2="52" y2="14" stroke="var(--waspada)" strokeWidth="1.8" strokeLinecap="round" />
                {[[15,18],[24,18],[24,8],[40,6],[50,30],[52,14]].map(([cx,cy],i) => (
                  <circle key={i} cx={cx} cy={cy} r="2.8" fill="var(--waspada)" />
                ))}
              </svg>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--waspada-dark)', marginBottom: 4 }}>
                  Sudut torso berubah drastis
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
                  Kamera samping lorong · BiLSTM Jatuh
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ── How it works — editorial numbered list ──────────────────────────────────── */
function CaraKerjaSection() {
  const steps = [
    {
      num: '01',
      title: 'Unggah klip CCTV',
      desc: 'Ambil rekaman dari kamera lorong atau rak. Pilih jenis kamera dan unggah — tidak perlu konfigurasi teknis apapun.',
      note: 'Mendukung .mp4, .avi, .mov',
      icon: (
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
          <rect x="1.5" y="4" width="13" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
          <polygon points="14.5,8 20,6 20,15 14.5,13" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
        </svg>
      ),
    },
    {
      num: '02',
      title: 'SAPA membaca gerak tubuh',
      desc: 'AI mengekstrak 17 titik sendi per orang per frame, lalu menganalisis pola gerak dengan BiLSTM yang dilatih khusus.',
      note: '~3 menit untuk klip 2 menit',
      icon: (
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
          <circle cx="11" cy="3.5" r="2.2" stroke="currentColor" strokeWidth="1.5" />
          <line x1="11" y1="5.7" x2="11" y2="11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="11" y1="8.5" x2="6.5" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="11" y1="8.5" x2="15.5" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="11" y1="11.5" x2="8.5" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="11" y1="11.5" x2="13.5" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      num: '03',
      title: 'Lihat hasilnya',
      desc: 'Video beranotasi + timeline kejadian. Klik tiap event untuk langsung lompat ke momen tersebut dalam video.',
      note: 'Export JSON tersedia',
      icon: (
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
          <rect x="1.5" y="3.5" width="19" height="15" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
          <line x1="1.5" y1="8.5" x2="20.5" y2="8.5" stroke="currentColor" strokeWidth="1" opacity="0.4" />
          <rect x="3.5" y="10.5" width="3" height="5" rx="0.8" fill="var(--bantu)" opacity="0.9" />
          <rect x="9" y="12" width="3" height="3.5" rx="0.8" fill="var(--waspada)" opacity="0.9" />
          <rect x="14.5" y="10" width="3" height="5.5" rx="0.8" fill="var(--sigap)" opacity="0.9" />
        </svg>
      ),
    },
  ]

  return (
    <section id="cara-kerja" style={{
      padding: '80px 40px 100px',
      background: 'var(--paper-2)',
      borderTop: '1px solid var(--garis)',
      borderBottom: '1px solid var(--garis)',
    }}>
      <div style={{ maxWidth: 1160, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 64, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
              textTransform: 'uppercase', color: 'var(--sigap)', marginBottom: 14,
            }}>
              Cara Kerja
            </div>
            <h2 style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 'clamp(30px, 3.8vw, 44px)',
              fontWeight: 400, letterSpacing: '-0.025em', color: 'var(--ink)',
              lineHeight: 1.1, margin: 0,
            }}>
              Tiga langkah,
              <br />satu klip video
            </h2>
          </div>
          <p style={{ fontSize: 13, color: 'var(--ink-faint)', maxWidth: 280, lineHeight: 1.65, margin: 0 }}>
            Tidak perlu instalasi software. Tidak perlu training data sendiri. Cukup rekaman CCTV yang sudah ada.
          </p>
        </div>

        {/* Steps — horizontal with connecting line */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0, position: 'relative' }}>
          {/* Horizontal line */}
          <div style={{
            position: 'absolute',
            top: 30, left: '16.66%', right: '16.66%',
            height: 1,
            background: 'linear-gradient(90deg, transparent, var(--garis) 20%, var(--garis) 80%, transparent)',
            zIndex: 0,
          }} />

          {steps.map((step, i) => (
            <div key={i} style={{
              background: 'var(--surface)',
              borderTop: '1px solid var(--garis)',
              borderBottom: '1px solid var(--garis)',
              borderLeft: '1px solid var(--garis)',
              borderRight: i === 2 ? '1px solid var(--garis)' : 'none',
              borderRadius: i === 0 ? '14px 0 0 14px' : i === 2 ? '0 14px 14px 0' : '0',
              padding: '36px 28px',
              position: 'relative',
              zIndex: 1,
              transition: 'background 200ms',
            }}
            onMouseOver={e => e.currentTarget.style.background = 'var(--paper)'}
            onMouseOut={e => e.currentTarget.style.background = 'var(--surface)'}>
              {/* Step number + icon */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11, fontWeight: 600, color: 'var(--sigap)',
                  letterSpacing: '0.06em',
                }}>
                  {step.num}
                </div>
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: 'var(--sigap-soft)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--sigap)',
                }}>
                  {step.icon}
                </div>
              </div>
              <h3 style={{
                fontSize: 16, fontWeight: 700, color: 'var(--ink)',
                marginBottom: 10, letterSpacing: '-0.01em', lineHeight: 1.3,
              }}>
                {step.title}
              </h3>
              <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.7, marginBottom: 16 }}>
                {step.desc}
              </p>
              <div style={{
                fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                color: 'var(--ink-faint)', letterSpacing: '0.02em',
              }}>
                {step.note}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── Live mode teaser ────────────────────────────────────────────────────────── */
function LiveTeaserSection({ onLive }) {
  return (
    <div style={{ padding: '0 40px 72px', background: 'var(--paper-2)' }}>
      <div style={{
        maxWidth: 1160, margin: '0 auto',
        padding: '20px 28px',
        borderRadius: 14,
        background: 'var(--surface)',
        border: '1px solid var(--garis)',
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        boxShadow: '0 2px 12px rgba(26,28,24,0.04)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: 'var(--waspada)', boxShadow: '0 0 6px rgba(179,59,50,0.5)',
            animation: 'pulse 1.5s ease-in-out infinite', display: 'inline-block',
          }} />
          <span style={{
            fontSize: 10, fontWeight: 800, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: 'var(--waspada)',
          }}>
            Mode Live (Demo)
          </span>
        </div>
        <p style={{ flex: 1, fontSize: 13.5, color: 'var(--ink-soft)', minWidth: 200, lineHeight: 1.55, margin: 0 }}>
          Analisis langsung dari webcam — pipeline yang sama, tanpa upload file.
        </p>
        <button id="live-teaser-btn" type="button" onClick={onLive}
          style={{
            background: 'none', border: '1px solid var(--garis)',
            borderRadius: 50, color: 'var(--ink-soft)',
            fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
            padding: '7px 18px', cursor: 'pointer', flexShrink: 0,
            transition: 'all 120ms',
          }}
          onMouseOver={e => {
            e.currentTarget.style.borderColor = 'var(--sigap)'
            e.currentTarget.style.color = 'var(--sigap)'
          }}
          onMouseOut={e => {
            e.currentTarget.style.borderColor = 'var(--garis)'
            e.currentTarget.style.color = 'var(--ink-soft)'
          }}>
          Coba Mode Live →
        </button>
      </div>
    </div>
  )
}

/* ── Privacy section ─────────────────────────────────────────────────────────── */
function PrivasiSection() {
  const poin = [
    {
      title: 'Pose-only, bukan wajah',
      desc: 'SAPA hanya memproses koordinat sendi. Tidak ada modul pengenalan wajah secara arsitektur.',
    },
    {
      title: 'Video tidak disimpan permanen',
      desc: 'File video dihapus otomatis setelah diproses. Hanya metadata kejadian yang disimpan.',
    },
    {
      title: 'Bisa dijalankan on-premise',
      desc: 'Seluruh sistem bisa dipasang di server toko sendiri — video mentah tidak perlu keluar dari lokasi.',
    },
    {
      title: 'AI menandai, manusia memutuskan',
      desc: 'Setiap alert hanya rekomendasi untuk staf. Human-in-the-loop adalah arsitektur, bukan fitur tambahan.',
    },
  ]

  return (
    <section id="privasi" style={{
      padding: '100px 40px',
      background: 'var(--sigap)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Decorative background circles */}
      <div style={{
        position: 'absolute', top: -100, right: -100,
        width: 400, height: 400, borderRadius: '50%',
        background: 'rgba(255,255,255,0.04)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: -60, left: -60,
        width: 260, height: 260, borderRadius: '50%',
        background: 'rgba(255,255,255,0.03)',
        pointerEvents: 'none',
      }} />

      <div style={{ maxWidth: 1160, margin: '0 auto', position: 'relative' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 80, alignItems: 'start' }}>
          {/* Left */}
          <div>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.5)', marginBottom: 20,
            }}>
              Privasi & Governance
            </div>
            <h2 style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 'clamp(32px, 4vw, 50px)',
              fontWeight: 400, letterSpacing: '-0.025em',
              color: 'white', marginBottom: 24, lineHeight: 1.08,
            }}>
              Privasi bukan pilihan —
              <br />ini arsitekturnya.
            </h2>
            <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.68)', lineHeight: 1.78, marginBottom: 36 }}>
              Privacy-by-design bukan fitur yang bisa dinonaktifkan di SAPA.
              Sistem tidak pernah mencoba mengenali siapa yang ada di video.
            </p>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.16)',
              borderRadius: 8, padding: '10px 16px',
              fontSize: 12, color: 'rgba(255,255,255,0.78)',
              fontWeight: 500,
            }}>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <circle cx="6.5" cy="6.5" r="5.5" stroke="rgba(255,255,255,0.6)" strokeWidth="1.2" />
                <line x1="6.5" y1="3.5" x2="6.5" y2="6.5" stroke="rgba(255,255,255,0.6)" strokeWidth="1.2" strokeLinecap="round" />
                <circle cx="6.5" cy="9" r="0.7" fill="rgba(255,255,255,0.6)" />
              </svg>
              Selaras prinsip UU PDP Indonesia
            </div>
          </div>

          {/* Right — points */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {poin.map((p, i) => (
              <div key={i} style={{
                display: 'flex', gap: 16, alignItems: 'flex-start',
                padding: '20px 22px',
                borderRadius: 12,
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.11)',
                transition: 'background 200ms',
              }}
              onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
              onMouseOut={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}>
                <div style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: 'rgba(255,255,255,0.5)',
                  flexShrink: 0, marginTop: 6,
                }} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'white', marginBottom: 5, lineHeight: 1.3 }}>
                    {p.title}
                  </div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.62)', lineHeight: 1.65 }}>
                    {p.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

/* ── CTA Final ───────────────────────────────────────────────────────────────── */
function CTAFinal({ onCTA }) {
  return (
    <section style={{ padding: '100px 40px 120px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
        {/* Decorative line */}
        <div style={{
          width: 1, height: 56, background: 'linear-gradient(180deg, transparent, var(--garis))',
          margin: '0 auto 40px',
        }} />

        <h2 style={{
          fontFamily: "'Instrument Serif', Georgia, serif",
          fontSize: 'clamp(36px, 5vw, 58px)',
          fontWeight: 400, letterSpacing: '-0.025em',
          color: 'var(--ink)', lineHeight: 1.06, marginBottom: 20,
        }}>
          Siap mencoba
          <br />dengan video Anda?
        </h2>
        <p style={{ fontSize: 15, color: 'var(--ink-soft)', lineHeight: 1.72, marginBottom: 44 }}>
          Unggah klip CCTV toko. SAPA mengembalikan video beranotasi
          + timeline kejadian dalam hitungan menit.
        </p>
        <button id="final-cta-btn" type="button" onClick={onCTA} style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          background: 'var(--sigap)', color: 'white',
          fontSize: 16, fontWeight: 600, fontFamily: 'inherit',
          padding: '15px 40px', borderRadius: 50, border: 'none', cursor: 'pointer',
          boxShadow: '0 4px 24px rgba(44,93,75,0.30)',
          transition: 'all 240ms cubic-bezier(0.16,1,0.3,1)',
          letterSpacing: '-0.01em',
        }}
        onMouseOver={e => {
          e.currentTarget.style.background = 'var(--sigap-dark)'
          e.currentTarget.style.transform = 'translateY(-2px)'
          e.currentTarget.style.boxShadow = '0 8px 32px rgba(44,93,75,0.36)'
        }}
        onMouseOut={e => {
          e.currentTarget.style.background = 'var(--sigap)'
          e.currentTarget.style.transform = 'translateY(0)'
          e.currentTarget.style.boxShadow = '0 4px 24px rgba(44,93,75,0.30)'
        }}>
          Mulai Analisis Sekarang
        </button>
        <div style={{ marginTop: 18, fontSize: 12, color: 'var(--ink-faint)', display: 'flex', justifyContent: 'center', gap: 16 }}>
          <span>Gratis</span>
          <span>·</span>
          <span>Tanpa akun</span>
          <span>·</span>
          <span>Video dihapus setelah diproses</span>
        </div>
      </div>
    </section>
  )
}

/* ── Footer ──────────────────────────────────────────────────────────────────── */
function Footer() {
  return (
    <footer style={{
      padding: '20px 40px',
      borderTop: '1px solid var(--garis)',
      background: 'var(--paper-2)',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      flexWrap: 'wrap', gap: 8,
    }}>
      <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>
        <strong style={{ color: 'var(--ink-soft)', fontWeight: 600 }}>SAPA</strong>
        {' '}— Safety and Assistance through Pose Analytics
      </span>
      <span style={{ fontSize: 11, color: 'var(--ink-faint)', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.02em' }}>
        COMPFEST 18 · AI Innovation Challenge
      </span>
    </footer>
  )
}

/* ── Landing Page ────────────────────────────────────────────────────────────── */
export default function LandingPage() {
  const navigate = useNavigate()

  const goCTA = () => navigate('/analisis')
  const goLive = () => navigate('/live')
  const scrollHow = () =>
    document.getElementById('cara-kerja')?.scrollIntoView({ behavior: 'smooth' })

  return (
    <div style={{ background: 'var(--paper)', minHeight: '100vh' }}>
      <NoiseOverlay />
      <LandingNav onCTA={goCTA} onLive={goLive} />
      <HeroSection onCTA={goCTA} onScrollHow={scrollHow} />
      <MarqueeStrip />
      <NumbersSection />
      <FiturSection />
      <CaraKerjaSection />
      <LiveTeaserSection onLive={goLive} />
      <PrivasiSection />
      <CTAFinal onCTA={goCTA} />
      <Footer />
    </div>
  )
}
