// The working draft and the store that owns it.
//
// The draft — the exam, every version, which version is being viewed, and the
// dirty flag — is mirrored to a backend on every change, so a refresh loses
// nothing. The backend is a narrow injectable interface: the app hands the
// store a localStorage-backed one, tests hand it an in-memory one, and the
// saved-state store (IndexedDB) implements the same two methods.

import {
  createExam,
  createVersion,
  withQuestionAppended,
  withQuestionRemoved,
  type ColumnSetting,
  type Exam,
  type Question,
  type Version,
} from './exam'

export type WorkingDraft = {
  exam: Exam
  versions: Version[]
  currentVersionId: string
  dirty: boolean
}

// The whole persistence surface: read the last value written, write a new one.
// Both are asynchronous so that an IndexedDB implementation fits behind the
// same interface as a localStorage one.
export interface Backend<T> {
  read(): Promise<T | null>
  write(value: T): Promise<void>
}

export type MemoryBackend<T> = Backend<T> & {
  /** The last value written, for assertions. */
  value: T | null
  /** How many writes have landed, for assertions. */
  writes: number
}

// A backend that keeps the value in a variable. Used by tests, so neither
// fake-indexeddb nor a localStorage shim is needed to exercise the store.
export function createMemoryBackend<T>(
  initial: T | null = null,
): MemoryBackend<T> {
  const backend: MemoryBackend<T> = {
    value: initial,
    writes: 0,
    read: async () => backend.value,
    write: async (value: T) => {
      backend.value = structuredClone(value)
      backend.writes += 1
    },
  }
  return backend
}

export function createLocalStorageBackend<T>(key: string): Backend<T> {
  return {
    read: async () => {
      const stored = localStorage.getItem(key)
      if (stored == null) return null
      try {
        return JSON.parse(stored) as T
      } catch {
        return null
      }
    },
    write: async (value: T) => {
      localStorage.setItem(key, JSON.stringify(value))
    },
  }
}

// Nothing reads the previous app's `exam-questions-v1`: no migration is
// performed, the app starts clean.
export const DRAFT_STORAGE_KEY = 'exam-draft-v1'

export function createWorkingDraft(): WorkingDraft {
  const version = createVersion('A')
  return {
    exam: createExam(),
    versions: [version],
    currentVersionId: version.id,
    dirty: false,
  }
}

function isVersion(value: unknown): value is Version {
  const version = value as Version | null
  return (
    typeof version === 'object' &&
    version !== null &&
    typeof version.id === 'string' &&
    typeof version.letter === 'string' &&
    Array.isArray(version.questionOrder) &&
    typeof version.choiceOrder === 'object' &&
    version.choiceOrder !== null
  )
}

// A stored draft is trusted only as far as its shape; anything else is treated
// as absent, so a corrupt entry costs the teacher their draft rather than the
// whole app.
function isWorkingDraft(value: unknown): value is WorkingDraft {
  const draft = value as WorkingDraft | null
  return (
    typeof draft === 'object' &&
    draft !== null &&
    typeof draft.exam === 'object' &&
    draft.exam !== null &&
    typeof draft.exam.title === 'string' &&
    Array.isArray(draft.exam.questions) &&
    Array.isArray(draft.versions) &&
    draft.versions.length > 0 &&
    draft.versions.every(isVersion) &&
    typeof draft.dirty === 'boolean' &&
    draft.versions.some((version) => version.id === draft.currentVersionId)
  )
}

export type ExamStore = {
  /** The current draft. A new object on every change, safe as a snapshot. */
  getState(): WorkingDraft
  /** The version being viewed. */
  currentVersion(): Version
  subscribe(listener: () => void): () => void

  setTitle(title: string): void
  /** Appends the question to the exam and to every version's ordering. */
  addQuestion(question: Question): void
  /** Replaces the question's content in place, adding it if it is unknown. */
  updateQuestion(question: Question): void
  removeQuestion(questionId: string): void
  setQuestionColumns(questionId: string, columns: ColumnSetting): void

  /** Replaces the version with this id, or adds it if there is none. */
  putVersion(version: Version): void
  /** Rewrites the version being viewed — how shuffles record an ordering. */
  updateCurrentVersion(update: (version: Version) => Version): void
  selectVersion(versionId: string): void

  /** Resolves once every mirrored write has landed. For tests and shutdown. */
  whenSettled(): Promise<void>
}

export function createExamStore(options: {
  backend: Backend<WorkingDraft>
  initial?: WorkingDraft
}): ExamStore {
  const { backend } = options
  let state: WorkingDraft = options.initial ?? createWorkingDraft()
  const listeners = new Set<() => void>()
  let pending: Promise<void> = Promise.resolve()

  // Writes are chained rather than fired in parallel, so the last change is the
  // last thing written no matter how fast the teacher types.
  const mirror = () => {
    const snapshot = state
    pending = pending.then(() =>
      backend.write(snapshot).catch((error: unknown) => {
        console.error('Could not mirror the working draft', error)
      }),
    )
  }

  // Every write goes through here: it is the single place the draft is
  // mirrored and subscribers are told.
  const apply = (
    next: (draft: WorkingDraft) => WorkingDraft,
    dirty: boolean,
  ) => {
    const updated = next(state)
    state = dirty ? { ...updated, dirty: true } : updated
    mirror()
    for (const listener of listeners) listener()
  }

  // An edit: the single place the dirty flag is raised. Which version is being
  // viewed is not an edit, so it does not come through here.
  const change = (next: (draft: WorkingDraft) => WorkingDraft) =>
    apply(next, true)

  const mapVersions = (
    draft: WorkingDraft,
    update: (version: Version) => Version,
  ): WorkingDraft => ({ ...draft, versions: draft.versions.map(update) })

  const store: ExamStore = {
    getState: () => state,
    currentVersion: () =>
      state.versions.find((version) => version.id === state.currentVersionId) ??
      state.versions[0]!,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    setTitle: (title) =>
      change((draft) => ({ ...draft, exam: { ...draft.exam, title } })),

    addQuestion: (question) =>
      change((draft) =>
        mapVersions(
          {
            ...draft,
            exam: {
              ...draft.exam,
              questions: [...draft.exam.questions, question],
            },
          },
          (version) => withQuestionAppended(version, question.id),
        ),
      ),

    updateQuestion: (question) =>
      change((draft) => {
        const known = draft.exam.questions.some((item) => item.id === question.id)
        const questions = known
          ? draft.exam.questions.map((item) =>
              item.id === question.id ? question : item,
            )
          : [...draft.exam.questions, question]
        return mapVersions(
          { ...draft, exam: { ...draft.exam, questions } },
          (version) => withQuestionAppended(version, question.id),
        )
      }),

    removeQuestion: (questionId) =>
      change((draft) =>
        mapVersions(
          {
            ...draft,
            exam: {
              ...draft.exam,
              questions: draft.exam.questions.filter(
                (question) => question.id !== questionId,
              ),
            },
          },
          (version) => withQuestionRemoved(version, questionId),
        ),
      ),

    setQuestionColumns: (questionId, columns) =>
      change((draft) => ({
        ...draft,
        exam: {
          ...draft.exam,
          questions: draft.exam.questions.map((question) =>
            question.id === questionId ? { ...question, columns } : question,
          ),
        },
      })),

    putVersion: (version) =>
      change((draft) => ({
        ...draft,
        versions: draft.versions.some((item) => item.id === version.id)
          ? draft.versions.map((item) => (item.id === version.id ? version : item))
          : [...draft.versions, version],
      })),

    updateCurrentVersion: (update) =>
      change((draft) =>
        mapVersions(draft, (version) =>
          version.id === draft.currentVersionId ? update(version) : version,
        ),
      ),

    selectVersion: (versionId) =>
      apply(
        (draft) =>
          draft.versions.some((version) => version.id === versionId)
            ? { ...draft, currentVersionId: versionId }
            : draft,
        false,
      ),

    whenSettled: () => pending,
  }

  return store
}

// Restore the draft the teacher left behind, or start a clean one.
export async function loadExamStore(
  backend: Backend<WorkingDraft>,
): Promise<ExamStore> {
  let stored: WorkingDraft | null = null
  try {
    stored = await backend.read()
  } catch (error) {
    console.error('Could not read the working draft', error)
  }
  return createExamStore({
    backend,
    initial: isWorkingDraft(stored) ? stored : createWorkingDraft(),
  })
}
