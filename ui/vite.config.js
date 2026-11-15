import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const simulationProxy = {
  '/hexlab-api': {
    target: 'http://127.0.0.1:3002',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/hexlab-api/, '/api'),
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true, open: !process.env.NO_OPEN, proxy: simulationProxy },
  preview: { port: 5173, strictPort: true, proxy: simulationProxy },
})
