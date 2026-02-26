import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/mlb-proxy': {
        target: 'https://statsapi.mlb.com/api/v1',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/mlb-proxy/, ''),
      },
      '/savant': {
        target: 'https://baseballsavant.mlb.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/savant/, ''),
      }
    }
  }
})
