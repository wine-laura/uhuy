import { useEffect, useRef, useState } from 'react'

/* ─────────────────────────────────────────────────────────────────────────────
   PanelDeteksiOrang — setting dua fitur rule-based sebelum analisis:
     1. Angkat tangan minta bantuan  (menyaring stretching / tos / meraih rak)
     2. Exclude pegawai via seragam  (Level 1.5: warna + pola)

   Kenapa di halaman UNGGAH, bukan di panel hasil: kedua fitur ini memengaruhi
   cara pose & piksel dibaca saat analisis, jadi tidak bisa dihitung ulang dari
   cache seperti ambang jatuh. Mengubahnya berarti menganalisis ulang video.
───────────────────────────────────────────────────────────────────────────── */

function Slider({ label, hint, value, batas, suffix = '', onChange, disabled }) {
  return (
    <div style={{ marginBottom: 14, opacity: disabled ? 0.45 : 1, transition: 'opacity 150ms' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
        <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>{label}</label>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 600,
          color: 'var(--ink)', background: 'rgba(26,28,24,0.05)',
          padding: '2px 8px', borderRadius: 6,
        }}>
          {Number(value).toFixed(batas.step < 1 ? 2 : 0)}{suffix}
        </span>
      </div>
      <input
        type="range"
        min={batas.min} max={batas.max} step={batas.step}
        value={value} disabled={disabled}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--bantu)', cursor: disabled ? 'default' : 'pointer' }}
      />
      {hint && (
        <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 3, lineHeight: 1.45 }}>
          {hint}
        </div>
      )}
    </div>
  )
}

function Toggle({ checked, onChange, label, hint }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'flex-start', gap: 9, cursor: 'pointer',
      padding: '10px 12px', borderRadius: 8, marginBottom: 12,
      border: `1px solid ${checked ? 'rgba(47,107,88,0.35)' : 'var(--garis)'}`,
      background: checked ? 'rgba(47,107,88,0.05)' : 'transparent',
      transition: 'all 150ms',
    }}>
      <input
        type="checkbox" checked={checked}
        onChange={e => onChange(e.target.checked)}
        style={{ marginTop: 2, accentColor: 'var(--sigap)' }}
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>{label}</span>
        {hint && (
          <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-soft)', marginTop: 2, lineHeight: 1.45 }}>
            {hint}
          </span>
        )}
      </span>
    </label>
  )
}

export default function PanelDeteksiOrang({ nilai, onUbah }) {
  const [terbuka, setTerbuka]   = useState(false)
  const [batas, setBatas]       = useState(null)
  const [seragam, setSeragam]   = useState([])
  const [catatanS, setCatatanS] = useState('')
  const [sibuk, setSibuk]       = useState(false)
  const [pesan, setPesan]       = useState(null)
  const [nama, setNama]         = useState('Seragam Toko')
  const fileRef = useRef(null)

  /* Ambang & daftar seragam diambil dari backend — sumber kebenarannya ada di
     pipeline/gestures.py & pipeline/uniform.py, bukan disalin ke frontend. */
  useEffect(() => {
    let batal = false
    fetch('/api/preset')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { if (!batal && d.angkat) setBatas(d.angkat.batas) })
      .catch(() => {})
    muatSeragam()
    return () => { batal = true }
  }, [])

  function muatSeragam() {
    fetch('/api/seragam')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { setSeragam(d.seragam ?? []); if (d.catatan) setCatatanS(d.catatan) })
      .catch(() => {})
  }

  function set(k, v) { onUbah({ ...nilai, [k]: v }) }

  async function unggahSeragam(file) {
    if (!file) return
    setSibuk(true); setPesan(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('nama', nama || 'Seragam')
      const res = await fetch('/api/seragam', { method: 'POST', body: fd })
      if (!res.ok) {
        const e = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(e.detail || `HTTP ${res.status}`)
      }
      const d = await res.json()
      setPesan({
        tipe: 'ok',
        teks: `"${d.nama}" terdaftar — ${d.n_dominan} warna dominan`
            + `${d.terbagi ? ', ada pembagian blok warna' : ''}.`,
      })
      muatSeragam()
      if (!nilai.seragam_aktif) set('seragam_aktif', true)
    } catch (err) {
      setPesan({ tipe: 'galat', teks: err.message || 'Gagal mendaftarkan seragam.' })
    } finally {
      setSibuk(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function hapusSeragam(id) {
    try {
      const res = await fetch(`/api/seragam/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      muatSeragam()
      setPesan(null)
    } catch (err) {
      setPesan({ tipe: 'galat', teks: 'Gagal menghapus seragam.' })
    }
  }

  const B = batas ?? {
    angkat_min_durasi: { min: 1.0, max: 6.0, step: 0.5 },
    angkat_maks_gerak: { min: 0.1, max: 1.0, step: 0.05 },
  }

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--garis)',
      borderRadius: 'var(--radius-lg)', marginBottom: 24, overflow: 'hidden',
      textAlign: 'left',
    }}>
      <button
        id="toggle-panel-deteksi-orang"
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
          <circle cx="9" cy="4.5" r="2.6" stroke="var(--ink-soft)" strokeWidth="1.6" />
          <path d="M3.5 16c0-3 2.5-5.2 5.5-5.2s5.5 2.2 5.5 5.2" stroke="var(--ink-soft)" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: 'var(--ink)' }}>
          Deteksi Orang — Angkat Tangan &amp; Pegawai
        </span>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
          color: 'var(--ink-faint)', marginRight: 4,
        }}>
          {nilai.angkat_aktif ? 'angkat: on' : 'angkat: off'}
          {' · '}
          {nilai.seragam_aktif ? `pegawai: ${seragam.length}` : 'pegawai: off'}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"
             style={{ transform: terbuka ? 'rotate(180deg)' : 'none', transition: 'transform 180ms' }}>
          <path d="M2 4.5L6 8.5l4-4" stroke="var(--ink-soft)" strokeWidth="1.6"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {!terbuka ? null : (
        <div style={{ padding: '16px 20px 20px', borderTop: '1px solid var(--garis)' }}>

          {/* ── 1. Angkat tangan ─────────────────────────────────────────── */}
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>
            1. Angkat tangan minta bantuan
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '0 0 10px', lineHeight: 1.55 }}>
            Berbasis aturan, tanpa model. Tangan terangkat saja tidak cukup —
            harus <strong>ditahan</strong> dan <strong>stabil</strong>, dan orangnya tidak sedang
            meraih rak. Itu yang memisahkannya dari stretching, tos, dan melambai.
          </p>

          <Toggle
            checked={!!nilai.angkat_aktif}
            onChange={v => set('angkat_aktif', v)}
            label="Aktifkan deteksi angkat tangan"
            hint="Kejadiannya masuk timeline sebagai butuh-bantuan sinyal AKTIF (prioritas lebih tinggi dari dwell)."
          />

          <Slider
            label="Durasi tangan ditahan"
            hint="Lebih panjang = lebih ketat. Tos dan melambai gagal di syarat ini."
            value={nilai.angkat_min_durasi} batas={B.angkat_min_durasi} suffix=" s"
            disabled={!nilai.angkat_aktif}
            onChange={v => set('angkat_min_durasi', v)}
          />
          <Slider
            label="Toleransi gerak tangan"
            hint="Perpindahan wrist antar-frame (satuan panjang torso). Lebih kecil = harus lebih diam."
            value={nilai.angkat_maks_gerak} batas={B.angkat_maks_gerak}
            disabled={!nilai.angkat_aktif}
            onChange={v => set('angkat_maks_gerak', v)}
          />

          <div style={{ height: 1, background: 'var(--garis)', margin: '18px 0' }} />

          {/* ── 2. Seragam pegawai ───────────────────────────────────────── */}
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>
            2. Kecualikan pegawai (via seragam)
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '0 0 10px', lineHeight: 1.55 }}>
            Pegawai yang berdiri lama menata barang tidak seharusnya ter-flag
            sebagai pelanggan butuh bantuan. Daftarkan seragamnya sekali, lalu
            sistem mencocokkan warna <em>dan</em> pola di area torso.
          </p>

          <div className="info-box" style={{ fontSize: 11.5, marginBottom: 12, lineHeight: 1.5 }}>
            <strong>Pegawai tetap dicek untuk deteksi jatuh.</strong> Pengecualian
            ini hanya berlaku untuk butuh-bantuan — pegawai yang jatuh tetap darurat.
          </div>

          <Toggle
            checked={!!nilai.seragam_aktif}
            onChange={v => set('seragam_aktif', v)}
            label="Aktifkan exclude pegawai"
            hint={seragam.length === 0
              ? 'Belum ada seragam terdaftar — daftarkan dulu di bawah.'
              : `${seragam.length} seragam terdaftar.`}
          />

          {/* Daftar seragam terdaftar */}
          {seragam.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {seragam.map(s => (
                <div key={s.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 11px', marginBottom: 6,
                  border: '1px solid var(--garis)', borderRadius: 8,
                }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
                      {s.nama}
                    </span>
                    <span style={{
                      display: 'block', fontSize: 10.5, color: 'var(--ink-faint)',
                      fontFamily: "'JetBrains Mono', monospace", marginTop: 2,
                    }}>
                      {s.n_dominan} warna dominan{s.terbagi ? ' · blok terbagi' : ''}
                      {Array.isArray(s.rasio) && s.rasio.length
                        ? ` · utama ${Math.round(s.rasio[0] * 100)}%`
                        : ''}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => hapusSeragam(s.id)}
                    style={{
                      background: 'none', border: '1px solid var(--garis)',
                      borderRadius: 6, color: 'var(--waspada)',
                      fontSize: 11, fontWeight: 600, padding: '4px 10px',
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    Hapus
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Registrasi seragam baru */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <input
              type="text"
              value={nama}
              onChange={e => setNama(e.target.value)}
              placeholder="Nama seragam"
              style={{
                flex: '1 1 140px', minWidth: 120,
                padding: '8px 11px', fontSize: 12.5, fontFamily: 'inherit',
                border: '1px solid var(--garis)', borderRadius: 8,
                background: 'var(--surface)', color: 'var(--ink)',
              }}
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={e => unggahSeragam(e.target.files?.[0])}
              style={{ display: 'none' }}
            />
            <button
              id="btn-unggah-seragam"
              type="button"
              className="btn btn-ghost"
              onClick={() => fileRef.current?.click()}
              disabled={sibuk}
              style={{ opacity: sibuk ? 0.55 : 1 }}
            >
              {sibuk ? 'Memproses…' : '+ Upload foto seragam'}
            </button>
          </div>

          {pesan && (
            <div style={{
              fontSize: 11.5, marginBottom: 10, lineHeight: 1.5,
              color: pesan.tipe === 'galat' ? 'var(--waspada)' : 'var(--ink-soft)',
            }}>
              {pesan.teks}
            </div>
          )}

          <Slider
            label="Ambang kemiripan seragam"
            hint="Lebih tinggi = lebih ketat. Turunkan bila pencahayaan toko berbeda jauh dari foto."
            value={nilai.seragam_ambang}
            batas={{ min: 0.30, max: 0.95, step: 0.05 }}
            disabled={!nilai.seragam_aktif || seragam.length === 0}
            onChange={v => set('seragam_ambang', v)}
          />

          {catatanS && (
            <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 8, lineHeight: 1.5 }}>
              {catatanS}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
