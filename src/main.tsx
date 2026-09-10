import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MilkdownProvider } from '@milkdown/react'
import App from './App'
import { loadExamStore } from './exam-store'
import { createExamWorkspaceService } from './exam-workspaces'
import {
  createQuestionBankResourceStore,
  createQuestionBankWorkspaceService,
} from './question-bank-workspaces'
import './styles.css'

async function start() {
  if ('serviceWorker' in navigator) {
    await navigator.serviceWorker.register('/image-worker.js')
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) { window.location.reload(); return }
  }
  const workspaces = createExamWorkspaceService()
  const bankWorkspaces = createQuestionBankWorkspaceService()
  const startingOnEditor = window.location.pathname === '/editor'
  // Home has no workspace to restore, so it also clears an active placeholder
  // that was abandoned by closing or leaving the editor. A bare editor reload
  // deliberately retains that active workspace long enough to restore it.
  await workspaces.cleanupPristine({ includeActive: !startingOnEditor })
  await bankWorkspaces.cleanupPristine({ includeActive: !startingOnEditor })
  const launchId = new URLSearchParams(window.location.search).get('exam')
  const launchBankId = new URLSearchParams(window.location.search).get('bank')
  let store = null
  let bankStore = null
  let error: string | null = null
  if (startingOnEditor) {
    const activeEditor = await bankWorkspaces.activeEditor()
    if (launchBankId || (!launchId && activeEditor?.mode === 'bank')) {
      const requested = launchBankId ?? activeEditor?.resourceId ?? await bankWorkspaces.activeId()
      const bank = requested ? await bankWorkspaces.open(requested) : null
      if (bank) {
        bankStore = createQuestionBankResourceStore(
          bank,
          (change) => bankWorkspaces.commit(bank.id, change),
        )
        window.history.replaceState(null, '', '/editor')
      } else {
        if (launchBankId) error = 'That Question Bank is unavailable on this device.'
        window.history.replaceState(null, '', '/')
      }
    } else {
      const requested = launchId ?? activeEditor?.resourceId ?? await workspaces.activeId()
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
  }
  const [exams, banks] = await Promise.all([workspaces.recent(), bankWorkspaces.recent()])
  createRoot(document.getElementById('root')!).render(<StrictMode><MilkdownProvider><App store={store} bankStore={bankStore} workspaces={workspaces} bankWorkspaces={bankWorkspaces} initialExams={exams} initialBanks={banks} initialError={error} /></MilkdownProvider></StrictMode>)
}
void start()
