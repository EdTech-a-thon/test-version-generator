import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MilkdownProvider } from '@milkdown/react'
import App from './App'
import { loadExamStore } from './exam-store'
import { createExamWorkspaceService } from './exam-workspaces'
import {
  createQuestionBankWorkspaceService,
  type QuestionBankResource,
} from './question-bank-workspaces'
import { persistentStorageStatus } from './durable-storage'
import { questionBankCollection } from './resource-collections'
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
  const startingOnBank = window.location.pathname === '/question-bank'
  // The bank page's own bank is the active one, so it must survive the sweep
  // that disposes abandoned Untitled placeholders.
  await bankWorkspaces.cleanupPristine({ includeActive: !startingOnEditor && !startingOnBank })
  const parameters = new URLSearchParams(window.location.search)
  let store = null
  let bank: QuestionBankResource | null = null
  let editorId: string | null = null
  let error: string | null = null

  if (startingOnBank) {
    // Unlike the editor's one-time launch parameters, the bank page keeps its
    // id in the URL: a Question Bank is a place with an address, and reload
    // and Back both have to find their way to the same one.
    const id = parameters.get('id')
    bank = id ? await bankWorkspaces.open(id) : null
    if (!bank) {
      error = 'That Question Bank is unavailable on this device.'
      window.history.replaceState(null, '', '/question-banks')
    }
  } else if (startingOnEditor) {
    const launchId = parameters.get('exam')
    // The editor edits an Exam. A bare `/editor` restores the one it was last
    // on, and goes Home when there is none.
    const restore = async () => {
      const activeEditor = await bankWorkspaces.activeEditor()
      if (!activeEditor || !await workspaces.exists(activeEditor.resourceId)) return false
      editorId = activeEditor.resourceId
      store = await loadExamStore(workspaces.backendFor(activeEditor.resourceId))
      return true
    }
    if (launchId) {
      if (await workspaces.open(launchId)) {
        editorId = launchId
        store = await loadExamStore(workspaces.backendFor(launchId))
        window.history.replaceState(null, '', '/editor')
      } else {
        error = 'That Exam is unavailable on this device.'
        window.history.replaceState(null, '', await restore() ? '/editor' : '/')
      }
    } else {
      window.history.replaceState(null, '', await restore() ? '/editor' : '/')
    }
  }

  const [exams, banks, storageStatus] = await Promise.all([
    workspaces.recent(),
    bankWorkspaces.recent(),
    persistentStorageStatus(),
  ])
  const collection = await questionBankCollection(banks, bankWorkspaces, workspaces)
  createRoot(document.getElementById('root')!).render(<StrictMode><MilkdownProvider><App store={store} bank={bank} workspaces={workspaces} bankWorkspaces={bankWorkspaces} initialExams={exams} initialBankCollection={collection} persistentStorage={storageStatus} initialEditorId={editorId} initialError={error} /></MilkdownProvider></StrictMode>)
}
void start()
