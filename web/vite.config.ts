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
      // 'autoUpdate', on purpose and after trying 'prompt': a new build
      // activates the moment it is installed (skipWaiting), takes the open
      // pages (clientsClaim) and the client reloads on `activated`. The
      // prompt flow left the operator's iPhone showing the "reload" toast on
      // every deploy: a worker already waiting when the page registers
      // reports its takeover without `isUpdate`, and the prompt-mode client
      // only reloads on `isUpdate`, so the auto-apply activated the new
      // worker and then nothing happened. A reload mid-action is the price,
      // and the owner chose to pay it. src/lib/update.ts still polls the
      // server's version as the fallback for a client with no worker.
      registerType: 'autoUpdate',
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
        // What 'autoUpdate' implies, spelled out so nobody has to know.
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // ArgoCD state is never cached, and the way to guarantee that is to
        // give /api/ no route at all rather than a NetworkOnly one. Workbox
        // only calls `event.respondWith()` when some route matches, so with
        // none the browser fetches /api/ itself and the worker is never in
        // the response path. That is strictly stronger than NetworkOnly --
        // and NetworkOnly was actively harmful here. MazeCD holds one
        // never-ending watch stream open per instance; routed through the
        // worker, those are fetch events that never complete, so the active
        // worker never has "no work", and Chromium will not activate a
        // waiting worker over an active one that is still working -- however
        // many times it is sent SKIP_WAITING. That is what kept a running
        // client on the old bundle after a deploy. Nothing else routes /api/
        // either: the navigation fallback below denylists it, and the
        // precache manifest is build assets only.
        cleanupOutdatedCaches: true,
        // One flat sw.js instead of an AMD shim plus a workbox-*.js chunk.
        // In the split form the whole worker body -- the SKIP_WAITING
        // listener included -- lives inside an async `define([...])`
        // callback, so the listener is registered a microtask *after* the
        // script is evaluated. A worker sits in `waiting` unrunning, and the
        // spec only starts one for an event type its initial, synchronous
        // evaluation registered a listener for: once the waiting worker has
        // been evicted for idleness, SKIP_WAITING would never wake it. That
        // is a race, not the bug above, but it is a race on the one thing
        // this app must never get wrong.
        inlineWorkboxRuntime: true,
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
