import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MilkdownProvider } from '@milkdown/react'
import App from './App'
import { loadExamStore } from './exam-store'
import { createExamWorkspaceService } from './exam-workspaces'
import {
  createQuestionBankResourceStore,
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
  await bankWorkspaces.cleanupPristine({ includeActive: !startingOnEditor })
  const launchId = new URLSearchParams(window.location.search).get('exam')
  const launchBankId = new URLSearchParams(window.location.search).get('bank')
  let store = null
  let bankStore = null
  let editorId: string | null = null
  let editorMode: 'bank' | 'exam' | null = null
  let error: string | null = null
  if (startingOnEditor) {
    const activeEditor = await bankWorkspaces.activeEditor()
    const restore = async () => {
      if (activeEditor?.mode === 'bank') {
        const context = { mode: 'bank' as const, resourceId: activeEditor.resourceId }
        const workspace = await bankWorkspaces.workspace(context)
        const loaded = await Promise.all(workspace.openBankIds.map((id) => bankWorkspaces.read(id)))
        const valid = loaded.filter((bank): bank is QuestionBankResource => bank !== null)
        if (valid.length === 0 && workspace.openBankIds.length > 0) return false
        const validIds = valid.map((bank) => bank.id)
        const activeBank = valid.find((bank) => bank.id === workspace.activeBankId) ?? valid[0] ?? null
        if (validIds.length !== workspace.openBankIds.length || workspace.activeBankId !== activeBank?.id) {
          await bankWorkspaces.saveWorkspace(context, {
            ...workspace,
            openBankIds: validIds,
            activeBankId: activeBank?.id ?? null,
            filters: Object.fromEntries(validIds.map((id) => [id, workspace.filters[id]]).filter((entry) => entry[1] !== undefined)),
          })
        }
        await bankWorkspaces.resumeBankWorkspace(activeBank?.id ?? null)
        editorMode = 'bank'
        editorId = activeBank?.id ?? null
        if (activeBank) {
          bankStore = createQuestionBankResourceStore(
            activeBank,
            (change) => bankWorkspaces.commit(activeBank.id, change),
          )
        }
        return true
      }
      if (activeEditor?.mode === 'exam' && await workspaces.exists(activeEditor.resourceId)) {
        editorMode = 'exam'
        editorId = activeEditor.resourceId
        store = await loadExamStore(workspaces.backendFor(activeEditor.resourceId))
        return true
      }
      return false
    }

    if (launchBankId) {
      const bank = await bankWorkspaces.open(launchBankId)
      if (bank) {
        editorMode = 'bank'
        editorId = bank.id
        bankStore = createQuestionBankResourceStore(
          bank,
          (change) => bankWorkspaces.commit(bank.id, change),
        )
        window.history.replaceState(null, '', '/editor')
      } else {
        error = 'That Question Bank is unavailable on this device.'
        window.history.replaceState(null, '', await restore() ? '/editor' : '/')
      }
    } else if (launchId) {
      if (await workspaces.open(launchId)) {
        editorMode = 'exam'
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
  createRoot(document.getElementById('root')!).render(<StrictMode><MilkdownProvider><App store={store} bankStore={bankStore} workspaces={workspaces} bankWorkspaces={bankWorkspaces} initialExams={exams} initialBankCollection={collection} persistentStorage={storageStatus} initialEditorId={editorId} initialEditorMode={editorMode} initialError={error} /></MilkdownProvider></StrictMode>)
}
void start()
