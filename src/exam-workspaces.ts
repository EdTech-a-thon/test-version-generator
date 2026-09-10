import type { Question } from './exam'
import type { ProseMirrorJSON } from './question-doc'
import type { AuthoringState, SaveAsSnapshot } from './exam-store'
import { createIndexedDBAuthoringBackend } from './indexeddb-authoring'
import { withCanonicalQuestionProjection } from './canonical-question-projection'
import { withoutQuestions } from './question-deletion'
import { createExamDraft } from './question-bank'
import {
  CANONICAL_QUESTION_STORE,
  EDITOR_WORKSPACE_STORE,
  EXAM_STORE,
  EXAM_WORKSPACE_STORE,
  QUESTION_BANK_REGISTRY_STORE,
  QUESTION_BANK_WORKSPACE_STORE,
  MEDIA_ASSET_STORE,
  VERSIONED_STORAGE_NAME,
  VERSIONED_STORAGE_VERSION,
} from './storage-schema'

export type ExamSummary = { id: string; createdAt: string; lastOpenedAt: string }
type ActiveWorkspace = { key: 'active'; examId: string }
export type RecentExam = ExamSummary & {
  title: string
  questionCount: number
  preview: readonly (readonly ProseMirrorJSON[])[] | null
  unsaved: boolean
}

export type QuestionUsage = {
  examId: string
  title: string
  saved: boolean
  workingCopy: boolean
}

export type QuestionDeletionImpact = QuestionUsage & {
  questionCount: number
}

export type ForcedDeletionCommit = {
  rollback(): Promise<void>
  finalize(): Promise<void>
}

export function resourceUsageOf(
  exam: ExamSummary,
  working: AuthoringState | null,
  saved: Omit<AuthoringState, 'dirty'> | null,
  questionIds: ReadonlySet<string>,
): QuestionUsage | null {
  const inWorkingCopy = working?.examDraft.questionIds.some((id) => questionIds.has(id)) ?? false
  const inSaved = saved?.examDraft.questionIds.some((id) => questionIds.has(id)) ?? false
  if (!inWorkingCopy && !inSaved) return null
  return {
    examId: exam.id,
    title: working?.examDraft.title ?? saved?.examDraft.title ?? 'Untitled Exam',
    saved: inSaved,
    workingCopy: inWorkingCopy,
  }
}

/** Only the disposable placeholder shape may be collected. Any authored
 * change, including a rename without Questions, makes an Exam durable. */
export function isPristineExam(
  working: AuthoringState | null,
  saved: Omit<AuthoringState, 'dirty'> | null,
  history: { records: readonly unknown[] },
): boolean {
  return Boolean(
    working
    && saved
    && !working.dirty
    && working.examDraft.title === 'Untitled Exam'
    && working.examDraft.questionIds.length === 0
    && saved.examDraft.title === 'Untitled Exam'
    && saved.examDraft.questionIds.length === 0
    && history.records.length === 0,
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
      if (!database.objectStoreNames.contains(QUESTION_BANK_REGISTRY_STORE)) database.createObjectStore(QUESTION_BANK_REGISTRY_STORE, { keyPath: 'id' })
      if (!database.objectStoreNames.contains(CANONICAL_QUESTION_STORE)) database.createObjectStore(CANONICAL_QUESTION_STORE, { keyPath: 'id' })
      if (!database.objectStoreNames.contains(QUESTION_BANK_WORKSPACE_STORE)) database.createObjectStore(QUESTION_BANK_WORKSPACE_STORE, { keyPath: 'key' })
      if (!database.objectStoreNames.contains(EDITOR_WORKSPACE_STORE)) database.createObjectStore(EDITOR_WORKSPACE_STORE, { keyPath: 'key' })
      if (!database.objectStoreNames.contains(MEDIA_ASSET_STORE)) database.createObjectStore(MEDIA_ASSET_STORE, { keyPath: 'hash' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export function examDatabaseName(id: string) { return `${VERSIONED_STORAGE_NAME}-exam-${id}` }
function previewOf(state: AuthoringState): readonly (readonly ProseMirrorJSON[])[] | null {
  const byId = new Map(state.questionBank.questions.map((question) => [question.id, question]))
  const documents = state.examDraft.questionIds.flatMap((id) => {
    const content = byId.get(id)?.doc.content
    return Array.isArray(content) ? [content] : []
  })
  return documents.length > 0 ? documents : null
}

/** Registry and active workspace selection for the multi-Exam shell. */
export function createExamWorkspaceService(options: { now?: () => Date; createId?: () => string } = {}) {
  const now = options.now ?? (() => new Date())
  const createId = options.createId ?? (() => crypto.randomUUID())
  const registry = openRegistry()
  const backendFor = (id: string) => createIndexedDBAuthoringBackend(examDatabaseName(id))
  const transact = async <T>(stores: string | string[], mode: IDBTransactionMode, operation: (transaction: IDBTransaction) => Promise<T> | T) => {
    const transaction = (await registry).transaction(stores, mode)
    const completed = complete(transaction)
    try {
      const result = await operation(transaction)
      await completed
      return result
    } catch (error) {
      try { transaction.abort() } catch { /* The transaction already settled. */ }
      await completed.catch(() => undefined)
      throw error
    }
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
    async create(firstQuestion?: Question): Promise<ExamSummary> {
      const timestamp = now().toISOString()
      const exam = { id: createId(), createdAt: timestamp, lastOpenedAt: timestamp }
      const initial: AuthoringState = {
        questionBank: { questions: firstQuestion ? [firstQuestion] : [] },
        examDraft: {
          ...createExamDraft('Untitled Exam'),
          questionIds: firstQuestion ? [firstQuestion.id] : [],
          ...(firstQuestion?.type === 'multiple-choice'
            ? { columns: { [firstQuestion.id]: 1 as const } }
            : {}),
        },
        dirty: Boolean(firstQuestion),
      }
      // A newly created Exam starts with an explicit empty saved composition,
      // not merely a clean-looking Working Copy.
      const backend = backendFor(exam.id)
      await backend.initialize(
        {
          questionBank: initial.questionBank,
          examDraft: createExamDraft('Untitled Exam'),
        },
        initial,
      )
      await transact([EXAM_STORE, EXAM_WORKSPACE_STORE, EDITOR_WORKSPACE_STORE], 'readwrite', (transaction) => {
        transaction.objectStore(EXAM_STORE).put(exam)
        transaction.objectStore(EXAM_WORKSPACE_STORE).put({ key: 'active', examId: exam.id } satisfies ActiveWorkspace)
        transaction.objectStore(EDITOR_WORKSPACE_STORE).put({ key: 'active', mode: 'exam', resourceId: exam.id })
      })
      return exam
    },
    async open(id: string): Promise<boolean> {
      const exam = await transact(EXAM_STORE, 'readonly', (transaction) =>
        requestOf(transaction.objectStore(EXAM_STORE).get(id)) as Promise<ExamSummary | undefined>,
      )
      if (!exam) return false
      await transact([EXAM_STORE, EXAM_WORKSPACE_STORE, EDITOR_WORKSPACE_STORE], 'readwrite', (transaction) => {
        transaction.objectStore(EXAM_STORE).put({ ...exam, lastOpenedAt: now().toISOString() })
        transaction.objectStore(EXAM_WORKSPACE_STORE).put({ key: 'active', examId: id } satisfies ActiveWorkspace)
        transaction.objectStore(EDITOR_WORKSPACE_STORE).put({ key: 'active', mode: 'exam', resourceId: id })
      })
      return true
    },
    /**
     * The registry transaction makes the newly saved Exam visible and switches
     * the active editor as one operation. The Exam stores are independent
     * IndexedDB databases in this storage generation, so writes around that
     * registry commit are compensated on failure before this promise rejects.
     */
    async saveAs(sourceId: string, snapshot: SaveAsSnapshot): Promise<ExamSummary> {
      const source = await transact(EXAM_STORE, 'readonly', (transaction) =>
        requestOf(transaction.objectStore(EXAM_STORE).get(sourceId)) as Promise<ExamSummary | undefined>,
      )
      if (!source) throw new Error('The source Exam is unavailable.')
      const timestamp = now().toISOString()
      const target = { id: createId(), createdAt: timestamp, lastOpenedAt: timestamp }
      const sourceBackend = backendFor(sourceId)
      const targetBackend = backendFor(target.id)
      const previousWorking = await sourceBackend.read()
      let targetStarted = false
      let sourceWritten = false
      try {
        targetStarted = true
        await targetBackend.commitSaved({
          questionBank: snapshot.targetInitial.questionBank,
          examDraft: snapshot.targetInitial.examDraft,
        })
        await sourceBackend.write(snapshot.sourceRestored)
        sourceWritten = true
        await transact([EXAM_STORE, EXAM_WORKSPACE_STORE, EDITOR_WORKSPACE_STORE], 'readwrite', (transaction) => {
          transaction.objectStore(EXAM_STORE).put(target)
          transaction.objectStore(EXAM_WORKSPACE_STORE).put({ key: 'active', examId: target.id } satisfies ActiveWorkspace)
          transaction.objectStore(EDITOR_WORKSPACE_STORE).put({ key: 'active', mode: 'exam', resourceId: target.id })
        })
        return target
      } catch (error) {
        // Neither source state nor a target workspace may escape a failed Save
        // As. The only operations outside the registry transaction are the two
        // per-Exam stores, so restore/remove those before reporting failure.
        if (sourceWritten && previousWorking) await sourceBackend.write(previousWorking).catch(() => undefined)
        if (targetStarted) {
          await new Promise<void>((resolve) => {
            const request = indexedDB.deleteDatabase(examDatabaseName(target.id))
            request.onsuccess = request.onblocked = request.onerror = () => resolve()
          })
        }
        throw error
      }
    },
    async recent(): Promise<RecentExam[]> {
      const exams = await transact(EXAM_STORE, 'readonly', (transaction) =>
        requestOf(transaction.objectStore(EXAM_STORE).getAll()) as Promise<ExamSummary[]>,
      )
      const records = await Promise.all(exams.map(async (exam) => {
        const state = await backendFor(exam.id).read()
        return {
          ...exam,
          title: state?.examDraft.title ?? 'Untitled Exam',
          questionCount: state?.examDraft.questionIds.length ?? 0,
          preview: state ? previewOf(state) : null,
          unsaved: state?.dirty ?? false,
        }
      }))
      return records.sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt))
    },
    async questionUsage(questionId: string): Promise<QuestionUsage[]> {
      return service.resourceUsage([questionId])
    },
    async resourceUsage(questionIds: readonly string[]): Promise<QuestionUsage[]> {
      const impact = await service.deletionImpact(questionIds)
      return impact.map((item) => ({
        examId: item.examId,
        title: item.title,
        saved: item.saved,
        workingCopy: item.workingCopy,
      }))
    },
    async deletionImpact(questionIds: readonly string[]): Promise<QuestionDeletionImpact[]> {
      const exams = await transact(EXAM_STORE, 'readonly', (transaction) =>
        requestOf(transaction.objectStore(EXAM_STORE).getAll()) as Promise<ExamSummary[]>,
      )
      const ids = new Set(questionIds)
      const usage = await Promise.all(exams.map(async (exam) => {
        const backend = backendFor(exam.id)
        const [working, saved] = await Promise.all([backend.read(), backend.readSaved()])
        const item = resourceUsageOf(exam, working, saved, ids)
        if (!item) return null
        const referenced = new Set([
          ...(working?.examDraft.questionIds ?? []),
          ...(saved?.examDraft.questionIds ?? []),
        ])
        return {
          ...item,
          questionCount: questionIds.filter((id) => referenced.has(id)).length,
        }
      }))
      return usage.filter((item): item is QuestionDeletionImpact => item !== null)
    },
    /** Force canonical deletion through saved and Working Copy state. Every
     * per-Exam write is compensated if any later write fails. Export stores are
     * deliberately outside these transactions. */
    async forceDeleteQuestions(questionIds: readonly string[]): Promise<ForcedDeletionCommit> {
      const exams = await transact(EXAM_STORE, 'readonly', (transaction) =>
        requestOf(transaction.objectStore(EXAM_STORE).getAll()) as Promise<ExamSummary[]>,
      )
      const ids = new Set(questionIds)
      const snapshots = (await Promise.all(exams.map(async (exam) => {
        const backend = backendFor(exam.id)
        const [working, saved] = await Promise.all([backend.read(), backend.readSaved()])
        if (!working) return null
        const usage = resourceUsageOf(exam, working, saved, ids)
        const hasCanonical = working.questionBank.questions.some(({ id }) => ids.has(id))
          || saved?.questionBank.questions.some(({ id }) => ids.has(id))
        if (!usage && !hasCanonical) return null
        return { exam, backend, working, saved }
      }))).filter((item): item is NonNullable<typeof item> => item !== null)
      const restore = async () => {
        await Promise.all(snapshots.map(({ backend, working, saved }) =>
          backend.commitCanonicalProjection({ working, saved }).catch(() => undefined),
        ))
      }
      try {
        for (const item of snapshots) {
          await item.backend.commitCanonicalProjection(withoutQuestions(item.working, item.saved, ids))
        }
      } catch (error) {
        await restore()
        throw error
      }
      return {
        rollback: restore,
        finalize: async () => {
          for (const { exam } of snapshots) await service.removePristine(exam.id)
        },
      }
    },
    /** Project a committed canonical record into every referencing Exam. The
     * registry commit happens first; each Exam write is atomic across its saved
     * state and Working Copy and does not touch registry recency metadata. */
    async propagateCanonicalQuestion(question: Question): Promise<void> {
      const exams = await transact(EXAM_STORE, 'readonly', (transaction) =>
        requestOf(transaction.objectStore(EXAM_STORE).getAll()) as Promise<ExamSummary[]>,
      )
      const affected = (await Promise.all(exams.map(async (exam) => {
        const backend = backendFor(exam.id)
        const [working, saved] = await Promise.all([backend.read(), backend.readSaved()])
        if (!working) return null
        const referenced = working.examDraft.questionIds.includes(question.id)
          || saved?.examDraft.questionIds.includes(question.id)
        return referenced ? { backend, before: { working, saved } } : null
      }))).filter((item): item is NonNullable<typeof item> => item !== null)
      try {
        // Keep this ordered so compensation never races a still-running write.
        for (const item of affected) {
          await item.backend.commitCanonicalProjection(
            withCanonicalQuestionProjection(item.before.working, item.before.saved, question),
          )
        }
      } catch (error) {
        await Promise.all(affected.map((item) =>
          item.backend.commitCanonicalProjection(item.before).catch(() => undefined),
        ))
        throw error
      }
    },
    async removePristine(id: string): Promise<boolean> {
      const backend = backendFor(id)
      const [state, saved, history] = await Promise.all([
        backend.read(),
        backend.readSaved(),
        backend.readExportHistory(),
      ])
      if (!isPristineExam(state, saved, history)) return false
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
