import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { makeQueryClient } from './api/queries'
import { App } from './App'
import { initTheme } from './lib/theme'
import './index.css'

// Before the first paint, so no frame renders in the wrong theme.
initTheme()

// Safari is the one browser that pinch-zooms a page whose CSS has ruled it
// out, and it announces the pinch through events nobody else fires. Refusing
// them is the only thing that holds a phone-sized layout still while a thumb
// and finger are on it. `passive: false` because a listener that cannot
// preventDefault is decoration.
for (const e of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(e, (ev) => ev.preventDefault(), { passive: false })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={makeQueryClient()}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
