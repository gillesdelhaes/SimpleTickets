import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        // Point at the docker stack's nginx during dev: VITE_PROXY_TARGET=http://localhost:3000
        target: (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.VITE_PROXY_TARGET ?? 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
