import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MilkdownProvider } from '@milkdown/react'
import App from './App'
import { loadExamStore } from './exam-store'
import { createExamWorkspaceService } from './exam-workspaces'
import './styles.css'

async function start() {
  if ('serviceWorker' in navigator) {
    await navigator.serviceWorker.register('/image-worker.js')
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) { window.location.reload(); return }
  }
  const workspaces = createExamWorkspaceService()
  const startingOnEditor = window.location.pathname === '/editor'
  // Home has no workspace to restore, so it also clears an active placeholder
  // that was abandoned by closing or leaving the editor. A bare editor reload
  // deliberately retains that active workspace long enough to restore it.
  await workspaces.cleanupPristine({ includeActive: !startingOnEditor })
  const launchId = new URLSearchParams(window.location.search).get('exam')
  let store = null
  let error: string | null = null
  if (startingOnEditor) {
    const requested = launchId ?? await workspaces.activeId()
    if (requested && await workspaces.open(requested)) {
      store = await loadExamStore(workspaces.backendFor(requested))
      window.history.replaceState(null, '', '/editor')
    } else {
      if (launchId) error = 'That Exam is unavailable on this device.'
      const fallback = await workspaces.activeId()
      if (fallback && await workspaces.exists(fallback)) {
        store = await loadExamStore(workspaces.backendFor(fallback))
        window.history.replaceState(null, '', '/editor')
      } else window.history.replaceState(null, '', '/')
    }
  }
  const exams = await workspaces.recent()
  createRoot(document.getElementById('root')!).render(<StrictMode><MilkdownProvider><App store={store} workspaces={workspaces} initialExams={exams} initialError={error} /></MilkdownProvider></StrictMode>)
}
void start()
