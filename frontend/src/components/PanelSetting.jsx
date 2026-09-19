import { useEffect, useState } from 'react'

/* ─────────────────────────────────────────────────────────────────────────────
   PanelSetting — atur ambang deteksi jatuh saat inference, tanpa restart.

   Panel ini HANYA menyentuh lapisan keputusan (threshold), bukan model. Karena
   itu mengubah slider tidak pernah memuat ulang bobot dan tidak pernah
   mengekstrak pose ulang: backend menyimpan fitur tiap jendela (probabilitas,
   sudut torso, kecepatan) di "fall_cache" saat analisis, dan /api/rethreshold
   hanya membandingkan angka-angka itu dengan ambang baru.

   Keempat preset memakai bobot model yang SAMA — yang berbeda cuma ambangnya.
───────────────────────────────────────────────────────────────────────────── */

const FALLBACK_BATAS = {
  fall_thr:   { min: 0.30, max: 0.95, step: 0.05 },
  fall_angle: { min: 0,    max: 80,   step: 5    },
  fall_speed: { min: 0,    max: 10,   step: 0.25 },
}

function Slider({ label, hint, value, batas, suffix, onChange, disabled }) {
  return (
    <div style={{ marginBottom: 16, opacity: disabled ? 0.45 : 1, transition: 'opacity 150ms' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
        <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>{label}</label>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12, fontWeight: 600, color: 'var(--ink)',
          background: 'rgba(26,28,24,0.05)', padding: '2px 8px', borderRadius: 6,
        }}>
          {Number(value).toFixed(batas.step < 1 ? 2 : 0)}{suffix}
        </span>
      </div>
      <input
        type="range"
        min={batas.min} max={batas.max} step={batas.step}
        value={value}
        disabled={disabled}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--waspada)', cursor: disabled ? 'default' : 'pointer' }}
      />
      {hint && (
        <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 3, lineHeight: 1.45 }}>
          {hint}
        </div>
      )}
    </div>
  )
}

export default function PanelSetting({ fallCache = [], ambangAwal, onHasil, jumlahJatuh }) {
  const [preset, setPreset]   = useState(ambangAwal?.preset ?? 'prob_sudut')
  const [thr, setThr]         = useState(ambangAwal?.fall_thr ?? 0.65)
  const [angle, setAngle]     = useState(ambangAwal?.fall_angle ?? 5)
  const [speed, setSpeed]     = useState(ambangAwal?.fall_speed ?? 0)
  const [daftar, setDaftar]   = useState([])
  const [batas, setBatas]     = useState(FALLBACK_BATAS)
  const [catatan, setCatatan] = useState('')
  const [sibuk, setSibuk]     = useState(false)
  const [pesan, setPesan]     = useState(null)
  const [terbuka, setTerbuka] = useState(false)

  /* Ambil daftar preset dari backend — sumber kebenaran ada di
     pipeline/thresholds.py, bukan disalin ke frontend. */
  useEffect(() => {
    let batal = false
    fetch('/api/preset')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => {
        if (batal) return
        setDaftar(d.preset ?? [])
        if (d.batas) setBatas(d.batas)
        if (d.catatan) setCatatan(d.catatan)
      })
      .catch(() => { /* panel tetap bisa dipakai dengan nilai fallback */ })
    return () => { batal = true }
  }, [])

  const custom = preset === 'custom'

  function pilihPreset(id) {
    setPreset(id)
    setPesan(null)
    const p = daftar.find(x => x.id === id)
    if (p) { setThr(p.fall_thr); setAngle(p.fall_angle); setSpeed(p.fall_speed) }
  }

  /* Mengubah slider berarti pindah ke mode custom — nilainya tidak lagi
     cocok dengan preset mana pun. */
  function ubahSlider(setter) {
    return v => { setter(v); setPreset('custom'); setPesan(null) }
  }

  async function prosesUlang() {
    if (!fallCache.length) {
      setPesan({ tipe: 'kosong', teks: 'Tidak ada jendela jatuh pada klip ini untuk dihitung ulang.' })
      return
    }
    setSibuk(true); setPesan(null)
    try {
      const res = await fetch('/api/rethreshold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fall_cache: fallCache,
          preset,
          fall_thr: thr, fall_angle: angle, fall_speed: speed,
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(e.detail || `HTTP ${res.status}`)
      }
      const data = await res.json()
      const sebelum = jumlahJatuh ?? 0
      const sesudah = data.summary?.jatuh ?? 0
      onHasil?.(data)
      setPesan({
        tipe: 'ok',
        teks: `${sesudah} kejadian jatuh dari ${data.summary?.total_window ?? 0} jendela `
            + `(sebelumnya ${sebelum}).`,
      })
    } catch (err) {
      setPesan({ tipe: 'galat', teks: err.message || 'Gagal memproses ulang.' })
    } finally {
      setSibuk(false)
    }
  }

  const aktif = daftar.find(p => p.id === preset)

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--garis)',
      borderRadius: 'var(--radius-lg)',
      marginBottom: 28,
      overflow: 'hidden',
    }}>
      {/* ── Header (klik untuk buka/tutup) ───────────────────────────── */}
      <button
        id="toggle-panel-setting"
        type="button"
        onClick={() => setTerbuka(o => !o)}
        aria-expanded={terbuka}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 20px', background: 'none', border: 'none',
          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
        }}
      >
        <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <circle cx="9" cy="9" r="2.6" stroke="var(--ink-soft)" strokeWidth="1.6" />
          <path d="M9 1.6v2.2M9 14.2v2.2M16.4 9h-2.2M3.8 9H1.6M14.2 3.8l-1.6 1.6M5.4 12.6l-1.6 1.6M14.2 14.2l-1.6-1.6M5.4 5.4L3.8 3.8"
                stroke="var(--ink-soft)" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: 'var(--ink)' }}>
          Setting Deteksi Jatuh
        </span>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
          color: 'var(--ink-faint)', marginRight: 4,
        }}>
          {custom ? 'custom' : (aktif?.label ?? preset)}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"
             style={{ transform: terbuka ? 'rotate(180deg)' : 'none', transition: 'transform 180ms' }}>
          <path d="M2 4.5L6 8.5l4-4" stroke="var(--ink-soft)" strokeWidth="1.6"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {!terbuka ? null : (
        <div style={{ padding: '4px 20px 20px', borderTop: '1px solid var(--garis)' }}>
          <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '14px 0 16px', lineHeight: 1.55 }}>
            Ambang di bawah hanya memengaruhi keputusan, bukan model — semua preset
            memakai bobot yang sama. Menggesernya tidak mengekstrak pose ulang,
            jadi hasilnya muncul seketika.
          </p>

          {/* ── Pilihan mode ──────────────────────────────────────────── */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
              Mode deteksi
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {daftar.map(p => (
                <label
                  key={p.id}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 9,
                    padding: '9px 11px', borderRadius: 8, cursor: 'pointer',
                    border: `1px solid ${preset === p.id ? 'rgba(210,40,40,0.35)' : 'var(--garis)'}`,
                    background: preset === p.id ? 'rgba(210,40,40,0.05)' : 'transparent',
                    transition: 'all 150ms',
                  }}
                >
                  <input
                    type="radio" name="preset-jatuh" value={p.id}
                    checked={preset === p.id}
                    onChange={() => pilihPreset(p.id)}
                    style={{ marginTop: 2, accentColor: 'var(--waspada)' }}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
                      {p.label}
                    </span>
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5,
                      color: 'var(--ink-faint)', marginLeft: 7,
                    }}>
                      F1 {p.metrik?.f1?.toFixed(3)}
                    </span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-soft)', marginTop: 2, lineHeight: 1.45 }}>
                      {p.catatan}
                    </span>
                  </span>
                </label>
              ))}

              {/* Custom */}
              <label style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '9px 11px', borderRadius: 8, cursor: 'pointer',
                border: `1px solid ${custom ? 'rgba(210,40,40,0.35)' : 'var(--garis)'}`,
                background: custom ? 'rgba(210,40,40,0.05)' : 'transparent',
                transition: 'all 150ms',
              }}>
                <input
                  type="radio" name="preset-jatuh" value="custom"
                  checked={custom}
                  onChange={() => { setPreset('custom'); setPesan(null) }}
                  style={{ accentColor: 'var(--waspada)' }}
                />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
                  Custom — atur sendiri lewat slider
                </span>
              </label>
            </div>
          </div>

          {/* ── Slider ────────────────────────────────────────────────── */}
          <Slider
            label="Ambang probabilitas"
            hint="Seberapa yakin model sebelum sebuah jendela dihitung jatuh."
            value={thr} batas={batas.fall_thr} suffix=""
            onChange={ubahSlider(setThr)}
          />
          <Slider
            label="Ambang sudut torso"
            hint="0° = tegak, 90° = rebah. Setel 0 untuk mematikan syarat ini."
            value={angle} batas={batas.fall_angle} suffix="°"
            onChange={ubahSlider(setAngle)}
          />
          <Slider
            label="Ambang kecepatan"
            hint="0 = syarat dimatikan (default)."
            value={speed} batas={batas.fall_speed} suffix=""
            onChange={ubahSlider(setSpeed)}
          />

          {catatan && (
            <div className="info-box" style={{ fontSize: 11.5, marginBottom: 14, lineHeight: 1.5 }}>
              {catatan}
            </div>
          )}

          {/* ── Aksi ──────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button
              id="btn-proses-ulang"
              type="button"
              className="btn btn-primary"
              onClick={prosesUlang}
              disabled={sibuk || !fallCache.length}
              style={{ opacity: (sibuk || !fallCache.length) ? 0.55 : 1 }}
            >
              {sibuk ? 'Memproses…' : 'Proses ulang'}
            </button>

            {pesan && (
              <span style={{
                fontSize: 12,
                color: pesan.tipe === 'galat' ? 'var(--waspada)' : 'var(--ink-soft)',
              }}>
                {pesan.teks}
              </span>
            )}
          </div>

          {!fallCache.length && (
            <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 9, lineHeight: 1.5 }}>
              Klip ini tidak menghasilkan jendela jatuh (mis. kamera rak, atau
              model jatuh tidak aktif), jadi tidak ada yang bisa dihitung ulang.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
