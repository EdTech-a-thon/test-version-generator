import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MilkdownProvider } from '@milkdown/react'
import App from './App'
import {
  loadExamStore,
} from './exam-store'
import { createIndexedDBAuthoringBackend } from './indexeddb-authoring'
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

  // The authoring state is restored before the first render, so the teacher
  // never sees an empty exam flash into their saved one.
  const store = await loadExamStore(createIndexedDBAuthoringBackend())

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MilkdownProvider>
        <App store={store} />
      </MilkdownProvider>
    </StrictMode>,
  )
}

void start()
