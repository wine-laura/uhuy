import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Teruskan /api/* ke backend FastAPI (dev mode)
      //
      // ws:true WAJIB ada di sini. Browser menyambung ke /api/ws/live dan
      // /api/ws/produksi/alert, yang cocok dengan aturan '/api' ini lebih dulu
      // (bukan aturan '/ws' di bawah). Tanpa ws:true, Vite tidak memasang
      // handler upgrade untuk aturan ini sehingga seluruh WebSocket gagal di
      // mode dev — padahal jalan normal di Docker karena nginx menanganinya
      // lewat blok `location /api/ws/` terpisah.
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // Proxy video beranotasi langsung dari backend (dev mode)
      '/outputs': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // Teruskan WebSocket /ws/* ke backend (mode live)
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5173,
  },
})

