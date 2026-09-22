import { useEffect, useRef, useState } from 'react'

/* ─────────────────────────────────────────────────────────────────────────────
   PanelSeragam — registrasi seragam pegawai, dipakai di Mode Live.

   Daftarnya SATU untuk seluruh aplikasi (backend menyimpannya di
   data/seragam.json), jadi seragam yang didaftarkan di sini juga langsung
   terpakai di jalur unggah-klip, dan sebaliknya.

   Berbeda dari PanelDeteksiOrang di halaman unggah, panel ini tidak punya
   slider ambang: mode Live memakai nilai default dari backend supaya operator
   tidak perlu menyetel apa pun saat kamera sedang berjalan.
───────────────────────────────────────────────────────────────────────────── */

export default function PanelSeragam({ onBerubah }) {
  const [seragam, setSeragam] = useState([])
  const [terbuka, setTerbuka] = useState(false)
  const [nama, setNama]       = useState('Seragam Toko')
  const [sibuk, setSibuk]     = useState(false)
  const [pesan, setPesan]     = useState(null)
  const fileRef = useRef(null)

  useEffect(() => { muat({ pertama: true }) }, [])

  function muat({ pertama = false } = {}) {
    fetch('/api/seragam')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => {
        const daftar = d.seragam ?? []
        setSeragam(daftar)
        onBerubah?.(daftar.length)
        // Buka sekali saja bila belum ada seragam — menuntun setup pertama
        // tanpa membuka sendiri tiap kali user menghapus yang terakhir.
        if (pertama && daftar.length === 0) setTerbuka(true)
      })
      .catch(() => {})
  }

  async function unggah(files) {
    const daftar = Array.from(files || []).slice(0, 3)
    if (!daftar.length) return
    setSibuk(true); setPesan(null)
    try {
      const fd = new FormData()
      daftar.forEach(f => fd.append('file', f))
      fd.append('nama', nama || 'Seragam')
      const res = await fetch('/api/seragam', { method: 'POST', body: fd })
      if (!res.ok) {
        const e = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(e.detail || `HTTP ${res.status}`)
      }
      const d = await res.json()
      setPesan({
        tipe: 'ok',
        teks: `"${d.nama}" terdaftar dari ${d.n_foto} foto — ${d.n_dominan} warna dominan.`
            + (d.n_dominan === 1
                ? ' Catatan: hanya 1 warna dominan, pencocokan kurang tajam.'
                : ''),
      })
      muat()
    } catch (err) {
      setPesan({ tipe: 'galat', teks: err.message || 'Gagal mendaftarkan seragam.' })
    } finally {
      setSibuk(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function hapus(id) {
    try {
      const res = await fetch(`/api/seragam/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      muat(); setPesan(null)
    } catch {
      setPesan({ tipe: 'galat', teks: 'Gagal menghapus seragam.' })
    }
  }

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--garis)',
      borderRadius: 'var(--radius-lg)', marginBottom: 20, overflow: 'hidden',
      textAlign: 'left',
    }}>
      <button
        id="toggle-panel-seragam-live"
        type="button"
        onClick={() => setTerbuka(o => !o)}
        aria-expanded={terbuka}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '13px 18px', background: 'none', border: 'none',
          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M6 2.5L3 4v4l1.5.5V15h9V8.5L15 8V4l-3-1.5-3 1.5-3-1.5z"
                stroke="var(--ink-soft)" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
        </svg>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
          Seragam Pegawai
        </span>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
          color: seragam.length ? 'var(--sigap)' : 'var(--ink-faint)', marginRight: 4,
        }}>
          {seragam.length ? `${seragam.length} terdaftar · aktif` : 'belum ada'}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"
             style={{ transform: terbuka ? 'rotate(180deg)' : 'none', transition: 'transform 180ms' }}>
          <path d="M2 4.5L6 8.5l4-4" stroke="var(--ink-soft)" strokeWidth="1.6"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {!terbuka ? null : (
        <div style={{ padding: '4px 18px 18px', borderTop: '1px solid var(--garis)' }}>
          <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '12px 0 10px', lineHeight: 1.55 }}>
            Pegawai yang berdiri lama menata barang tidak ter-flag sebagai
            pelanggan butuh bantuan. Daftar ini <strong>dipakai bersama</strong> dengan
            halaman Unggah Video — daftarkan sekali, terpakai di mana saja.
          </p>

          <div className="info-box" style={{ fontSize: 11.5, marginBottom: 12, lineHeight: 1.5 }}>
            <strong>Pegawai tetap dicek untuk deteksi jatuh.</strong> Pengecualian
            hanya berlaku untuk butuh-bantuan.
          </div>

          {seragam.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {seragam.map(s => (
                <div key={s.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '7px 10px', marginBottom: 6,
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
                      {(s.n_foto ?? 1) > 1 ? `${s.n_foto} foto · ` : ''}
                      {s.n_dominan} warna dominan{s.terbagi ? ' · blok terbagi' : ''}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => hapus(s.id)}
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

          <input
            type="text"
            value={nama}
            onChange={e => setNama(e.target.value)}
            placeholder="Nama seragam"
            style={{
              width: '100%', marginBottom: 8, boxSizing: 'border-box',
              padding: '8px 11px', fontSize: 12.5, fontFamily: 'inherit',
              border: '1px solid var(--garis)', borderRadius: 8,
              background: 'var(--surface)', color: 'var(--ink)',
            }}
          />
          <input
            ref={fileRef} type="file" accept="image/*" multiple
            onChange={e => unggah(e.target.files)}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => fileRef.current?.click()}
            disabled={sibuk}
            style={{ opacity: sibuk ? 0.55 : 1, width: '100%' }}
          >
            {sibuk ? 'Memproses…' : '+ Pilih 1–3 foto seragam'}
          </button>

          {pesan && (
            <div style={{
              fontSize: 11.5, marginTop: 9, lineHeight: 1.5,
              color: pesan.tipe === 'galat' ? 'var(--waspada)' : 'var(--ink-soft)',
            }}>
              {pesan.teks}
            </div>
          )}

          <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 9, lineHeight: 1.45 }}>
            Pakai foto <strong>close-up bajunya</strong>. Seragam multi-warna lebih
            andal. Pegawai hanya dikenali bila cukup dekat ke kamera — torso yang
            terlalu kecil dilewati agar tidak menebak dari data yang tak memadai.
          </div>
        </div>
      )}
    </div>
  )
}
