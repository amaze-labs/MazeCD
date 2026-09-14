/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt' rather than 'autoUpdate': src/lib/update.ts drives the
      // reload so an operation in flight is never interrupted.
      registerType: 'prompt',
      filename: 'sw.js',
      manifest: {
        name: 'MazeCD',
        short_name: 'MazeCD',
        description: 'Multi-instance ArgoCD control',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // ArgoCD state is never cached: a stale sync status shown as current
        // is an operational hazard, not a convenience. Workbox's RegExpRoute
        // matches against the full url.href, not just the pathname, so an
        // anchored `/^\/api\//` regex here would never match `https://...`
        // and silently never fire.
        runtimeCaching: [
          { urlPattern: ({ url }) => url.pathname.startsWith('/api/'), handler: 'NetworkOnly' },
        ],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  define: {
    __BUILD_VERSION__: JSON.stringify(process.env.MAZECD_VERSION ?? 'dev'),
  },
  build: {
    outDir: '../internal/web/dist',
    emptyOutDir: true,
  },
  server: {
    proxy: { '/api': 'http://localhost:8080' },
  },
  test: { environment: 'node' },
})
