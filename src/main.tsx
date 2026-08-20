import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MilkdownProvider } from '@milkdown/react'
import App from './App'
import {
  createLocalStorageBackend,
  createIndexedDBBackend,
  loadExamStore,
  DRAFT_STORAGE_KEY,
} from './exam-store'
import type { SavedState, WorkingDraft } from './exam-store'
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

  // The working draft is restored before the first render, so the teacher never
  // sees an empty exam flash into their saved one.
  const store = await loadExamStore(
    createLocalStorageBackend<WorkingDraft>(DRAFT_STORAGE_KEY),
    createIndexedDBBackend<SavedState>(),
  )

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MilkdownProvider>
        <App store={store} />
      </MilkdownProvider>
    </StrictMode>,
  )
}

void start()
