import type { AuthoringState } from './exam-store'
import { createIndexedDBAuthoringBackend } from './indexeddb-authoring'
import { createExamDraft } from './question-bank'
import {
  EXAM_STORE,
  EXAM_WORKSPACE_STORE,
  VERSIONED_STORAGE_NAME,
  VERSIONED_STORAGE_VERSION,
} from './storage-schema'

export type ExamSummary = { id: string; createdAt: string; lastOpenedAt: string }
type ActiveWorkspace = { key: 'active'; examId: string }
export type RecentExam = ExamSummary & {
  title: string
  questionCount: number
  preview: string | null
}

/** Only the disposable placeholder shape may be collected. Any authored
 * change, including a rename without Questions, makes an Exam durable. */
export function isPristineExam(
  state: AuthoringState | null,
  history: { versions: readonly unknown[] },
): boolean {
  return Boolean(
    state
    && state.examDraft.title === 'Untitled Exam'
    && state.examDraft.questionIds.length === 0
    && state.questionBank.questions.length === 0
    && history.versions.length === 0,
  )
}

function requestOf<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })
}
function openRegistry(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VERSIONED_STORAGE_NAME, VERSIONED_STORAGE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(EXAM_STORE)) database.createObjectStore(EXAM_STORE, { keyPath: 'id' })
      if (!database.objectStoreNames.contains(EXAM_WORKSPACE_STORE)) database.createObjectStore(EXAM_WORKSPACE_STORE, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export function examDatabaseName(id: string) { return `${VERSIONED_STORAGE_NAME}-exam-${id}` }
function previewOf(state: AuthoringState): string | null {
  const question = state.questionBank.questions.find((item) => state.examDraft.questionIds.includes(item.id))
  const content = question?.doc.content
  if (!Array.isArray(content)) return null
  for (const node of content) {
    if (typeof node !== 'object' || node === null || node.type !== 'paragraph' || !Array.isArray(node.content)) continue
    const text = (node.content as unknown[])
      .filter((child: unknown): child is { type: string; text?: unknown } =>
        typeof child === 'object' && child !== null && (child as { type?: unknown }).type === 'text',
      )
      .map((child) => typeof child.text === 'string' ? child.text : '')
      .join('')
    if (text) return text
  }
  return null
}

/** Registry and active workspace selection for the multi-Exam shell. */
export function createExamWorkspaceService(options: { now?: () => Date; createId?: () => string } = {}) {
  const now = options.now ?? (() => new Date())
  const createId = options.createId ?? (() => crypto.randomUUID())
  const registry = openRegistry()
  const backendFor = (id: string) => createIndexedDBAuthoringBackend(examDatabaseName(id))
  const transact = async <T>(stores: string | string[], mode: IDBTransactionMode, operation: (transaction: IDBTransaction) => Promise<T> | T) => {
    const transaction = (await registry).transaction(stores, mode)
    const result = await operation(transaction)
    await complete(transaction)
    return result
  }
  const service = {
    backendFor,
    async exists(id: string) {
      return Boolean(await transact(EXAM_STORE, 'readonly', (transaction) =>
        requestOf(transaction.objectStore(EXAM_STORE).get(id)) as Promise<ExamSummary | undefined>,
      ))
    },
    async activeId(): Promise<string | null> {
      return await transact(EXAM_WORKSPACE_STORE, 'readonly', async (transaction) => {
        const record = await requestOf(transaction.objectStore(EXAM_WORKSPACE_STORE).get('active')) as ActiveWorkspace | undefined
        return record?.examId ?? null
      })
    },
    async create(): Promise<ExamSummary> {
      const timestamp = now().toISOString()
      const exam = { id: createId(), createdAt: timestamp, lastOpenedAt: timestamp }
      await backendFor(exam.id).write({
        questionBank: { questions: [] }, examDraft: createExamDraft('Untitled Exam'), dirty: false,
      })
      await transact([EXAM_STORE, EXAM_WORKSPACE_STORE], 'readwrite', (transaction) => {
        transaction.objectStore(EXAM_STORE).put(exam)
        transaction.objectStore(EXAM_WORKSPACE_STORE).put({ key: 'active', examId: exam.id } satisfies ActiveWorkspace)
      })
      return exam
    },
    async open(id: string): Promise<boolean> {
      const exam = await transact(EXAM_STORE, 'readonly', (transaction) =>
        requestOf(transaction.objectStore(EXAM_STORE).get(id)) as Promise<ExamSummary | undefined>,
      )
      if (!exam) return false
      await transact([EXAM_STORE, EXAM_WORKSPACE_STORE], 'readwrite', (transaction) => {
        transaction.objectStore(EXAM_STORE).put({ ...exam, lastOpenedAt: now().toISOString() })
        transaction.objectStore(EXAM_WORKSPACE_STORE).put({ key: 'active', examId: id } satisfies ActiveWorkspace)
      })
      return true
    },
    async recent(): Promise<RecentExam[]> {
      const exams = await transact(EXAM_STORE, 'readonly', (transaction) =>
        requestOf(transaction.objectStore(EXAM_STORE).getAll()) as Promise<ExamSummary[]>,
      )
      const records = await Promise.all(exams.map(async (exam) => {
        const state = await backendFor(exam.id).read()
        return { ...exam, title: state?.examDraft.title ?? 'Untitled Exam', questionCount: state?.examDraft.questionIds.length ?? 0, preview: state ? previewOf(state) : null }
      }))
      return records.sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt))
    },
    async removePristine(id: string): Promise<boolean> {
      const backend = backendFor(id)
      const state = await backend.read()
      const history = await backend.readPublicationHistory()
      if (!isPristineExam(state, history)) return false
      await transact([EXAM_STORE, EXAM_WORKSPACE_STORE], 'readwrite', async (transaction) => {
        transaction.objectStore(EXAM_STORE).delete(id)
        const active = await requestOf(transaction.objectStore(EXAM_WORKSPACE_STORE).get('active')) as ActiveWorkspace | undefined
        if (active?.examId === id) transaction.objectStore(EXAM_WORKSPACE_STORE).delete('active')
      })
      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase(examDatabaseName(id))
        request.onsuccess = request.onblocked = () => resolve()
        request.onerror = () => resolve()
      })
      return true
    },
    /** Removes abandoned placeholders. A bare editor reload retains its active
     * workspace; Home owns no workspace and therefore also collects it. */
    async cleanupPristine({ includeActive = false }: { includeActive?: boolean } = {}) {
      const active = await service.activeId()
      const exams = await transact(EXAM_STORE, 'readonly', (transaction) => requestOf(transaction.objectStore(EXAM_STORE).getAll()) as Promise<ExamSummary[]>)
      await Promise.all(
        exams
          .filter((exam) => includeActive || exam.id !== active)
          .map((exam) => service.removePristine(exam.id)),
      )
    },
  }
  return service
}
export type ExamWorkspaceService = ReturnType<typeof createExamWorkspaceService>
