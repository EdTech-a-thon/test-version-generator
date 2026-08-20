import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MilkdownProvider } from '@milkdown/react'
import App from './App'
import './styles.css'

async function start() {
  if ('serviceWorker' in navigator) {
    await navigator.serviceWorker.register('/image-worker.js')
    await navigator.serviceWorker.ready

    if (!navigator.serviceWorker.controller) {
      window.location.reload()
      return
    }
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MilkdownProvider>
        <App />
      </MilkdownProvider>
    </StrictMode>,
  )
}

void start()
