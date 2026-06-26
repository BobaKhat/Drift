import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        // Proxies SoundNet calls to avoid CORS; API key stays server-side
        '/api/soundnet': {
          target: 'https://track-analysis.p.rapidapi.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/soundnet/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('X-RapidAPI-Key', env.VITE_RAPIDAPI_KEY || '')
              proxyReq.setHeader('X-RapidAPI-Host', 'track-analysis.p.rapidapi.com')
            })
          },
        },
      },
    },
  }
})
