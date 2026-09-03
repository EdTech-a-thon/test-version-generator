// The authoring state and the store that owns it.
//
// The authoring state — the Question Bank, the Exam Draft, and the dirty
// flag — is mirrored to a backend on every change, so a refresh loses nothing.
// The backend is a narrow injectable interface: the app hands the store the
// normalized IndexedDB generation, while unit tests use an in-memory backend.
//
// The store is also the one authoring boundary. Every semantic action a teacher
// can take on the Question Bank or the Exam Draft is a single method here:
// creating canonical Question Content with or without putting it on the exam,
// adding a reference, editing a banked question's content and metadata, moving
// a reference, Replacing one, and Removing one. Callers never assemble an
// action out of smaller ones — that is what makes each of them atomic, one undo
// step, and one mirrored write.

import {
  duplicateQuestion,
  moveQuestions,
  type ColumnSetting,
  type Question,
  type QuestionPlacement,
} from './exam'
import {
  bankQuestionById,
  createExamDraft,
  createQuestionBank,
  withQuestionBanked,
  withReferenceAdded,
  withReferenceOrder,
  withReferenceReplaced,
  withReferencesRemoved,
  type ExamDraft,
  type QuestionBank,
} from './question-bank'
import { selectedExam, type SelectedExam } from './selected-exam'

/** Everything authoring owns: canonical content, the selection made from it,
 *  and whether that has reached the saved state yet. */
export type AuthoringState = {
  questionBank: QuestionBank
  examDraft: ExamDraft
  dirty: boolean
}

export type SavedState = Omit<AuthoringState, 'dirty'>

// The whole persistence surface: read the last value written, write a new one.
// Both are asynchronous so that an IndexedDB implementation fits behind the
// same interface as a localStorage one.
export interface Backend<T> {
  read(): Promise<T | null>
  write(value: T): Promise<void>
}

/** An authoring backend that keeps the explicit saved state in the same
 *  durability boundary as the working Question Bank and Exam Draft. */
export interface DurableAuthoringBackend extends Backend<AuthoringState> {
  readSaved(): Promise<SavedState | null>
  commitSaved(value: SavedState): Promise<void>
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

export function createAuthoringState(): AuthoringState {
  return {
    questionBank: createQuestionBank(),
    examDraft: createExamDraft(),
    dirty: false,
  }
}

function isQuestionBank(value: unknown): value is QuestionBank {
  const bank = value as QuestionBank | null
  return typeof bank === 'object' && bank !== null && Array.isArray(bank.questions)
}

function isExamDraft(value: unknown): value is ExamDraft {
  const draft = value as ExamDraft | null
  return (
    typeof draft === 'object' &&
    draft !== null &&
    typeof draft.title === 'string' &&
    Array.isArray(draft.questionIds) &&
    draft.questionIds.every((id) => typeof id === 'string')
  )
}

// Stored authoring state is trusted only as far as its shape; anything else is
// treated as absent, so a corrupt entry costs the teacher their draft rather
// than the whole app.
function isAuthoringState(value: unknown): value is AuthoringState {
  const state = value as AuthoringState | null
  return (
    typeof state === 'object' &&
    state !== null &&
    typeof state.dirty === 'boolean' &&
    isQuestionBank(state.questionBank) &&
    isExamDraft(state.examDraft)
  )
}

function isSavedState(value: unknown): value is SavedState {
  return isAuthoringState({ ...(value as object), dirty: false })
}

/**
 * The authoring boundary.
 *
 * Reads are snapshots: `getState` and `selectedExam` return objects that are
 * new only when something they describe changed, so a React consumer can hold
 * either as a dependency.
 */
export type ExamStore = {
  /** The current authoring state. A new object on every change. */
  getState(): AuthoringState
  /** The Exam and ordering rendering and export consume — the referenced
   *  Question Bank records, in Exam Draft order, and nothing else. */
  selectedExam(): SelectedExam
  subscribe(listener: () => void): () => void

  setTitle(title: string): void

  /** Banks canonical Question Content without putting it on the Exam Draft. */
  createInQuestionBank(question: Question): void
  /** Banks canonical Question Content and references it from the Exam Draft,
   *  after `afterQuestionId` when given and at the end otherwise. */
  createInExamDraft(question: Question, afterQuestionId?: string | null): void
  /** Replaces one Question Bank record — its Question Content, its Question
   *  Type, its Difficulty and its Topics — wherever it is referenced. One
   *  popup save is one call, so a content edit and a metadata edit made
   *  together are one authoring action. An unbanked question is banked, so a
   *  save is never lost. */
  updateInQuestionBank(question: Question): void
  setQuestionColumns(questionIds: readonly string[], columns: ColumnSetting): void
  /** Banks a copy of a banked question and references it immediately after the
   *  original. Nothing is copied out of the Exam Draft: the copy is a Question
   *  Bank record of its own. */
  duplicateInExamDraft(questionId: string): void
  /** References an unused Question Bank record from the Exam Draft — at the end,
   *  or immediately before or after `targetQuestionId`. `'before'` is what names
   *  the first position in a Question Section, which no `'after'` can. A
   *  question already referenced is left where it is: a reference occurs at most
   *  once. An insertion beside a question in another Question Section is
   *  refused: composing never moves a question across the Multiple Choice /
   *  Short Answer boundary. */
  addToExamDraft(
    questionId: string,
    targetQuestionId?: string | null,
    placement?: QuestionPlacement,
  ): void
  /** Replaces one Exam Draft reference with an unused Question Bank record of
   *  the same Question Type, in the outgoing question's exact position. Nothing
   *  is copied and nothing is deleted: the outgoing question keeps its Question
   *  Bank record and is available to compose with again. Refused when either
   *  question is unbanked, when their Question Sections differ, or when the
   *  incoming question is already on the Exam Draft. */
  replaceInExamDraft(outgoingQuestionId: string, incomingQuestionId: string): void
  /** Moves references within their Question Section. A target in another
   *  section is refused: composing never changes a question's type. */
  moveInExamDraft(
    questionIds: readonly string[],
    targetId: string,
    placement: QuestionPlacement,
  ): void
  /** Removes references from the Exam Draft, leaving their Question Bank
   *  records exactly as they were. Remove excludes; it never deletes. */
  removeFromExamDraft(questionIds: readonly string[]): void

  /** Whether anything has ever been saved — what tells an untouched draft from
   *  an exam with unsaved changes. */
  hasSavedExam(): boolean
  canUndo(): boolean
  canRedo(): boolean
  undo(): void
  redo(): void
  save(): Promise<void>
  discard(): Promise<void>

  /** Resolves once every mirrored write has landed. For tests and shutdown. */
  whenSettled(): Promise<void>
}

// The authoring state carrying a new Exam Draft — or the very same state when
// the Exam Draft refused the change. Every reference operation is total and
// returns the draft it was given when it declines, and this is what turns that
// into "nothing happened": no undo step, no dirty flag and no write, because
// `apply` stops at an unchanged state.
function withExamDraft(
  state: AuthoringState,
  examDraft: ExamDraft,
): AuthoringState {
  return examDraft === state.examDraft ? state : { ...state, examDraft }
}

export function createExamStore(options: {
  backend: Backend<AuthoringState>
  savedBackend?: Backend<SavedState>
  saved?: SavedState | null
  initial?: AuthoringState
}): ExamStore {
  const { backend, savedBackend } = options
  const durableBackend = 'commitSaved' in backend
    ? (backend as DurableAuthoringBackend)
    : null
  let state: AuthoringState = options.initial ?? createAuthoringState()
  let saved: SavedState | null = options.saved ?? null
  // The derived Exam, kept beside the state it was derived from. Deriving it
  // once per change rather than once per read is what lets a consumer treat it
  // as a stable dependency; `selectedExam` reuses the halves that did not move.
  let selected: SelectedExam = selectedExam(state.questionBank, state.examDraft)
  const listeners = new Set<() => void>()
  let pending: Promise<void> = Promise.resolve()
  const undoStack: AuthoringState[] = []
  const redoStack: AuthoringState[] = []
  const HISTORY_LIMIT = 100

  // Generic backends are chained so their writes cannot overtake one another.
  // The durable IndexedDB backend starts each transaction immediately; the
  // database queues overlapping read/write transactions in creation order.
  // Starting them here matters at navigation time: a second authored question
  // must already be inside IndexedDB's durability boundary when Reload begins,
  // not waiting behind a promise for the first transaction.
  const mirror = () => {
    const snapshot = state
    const write = durableBackend
      ? backend.write(snapshot)
      : pending.then(() => backend.write(snapshot))
    pending = Promise.all([pending, write])
      .then(() => undefined)
      .catch((error: unknown) => {
        console.error('Could not mirror the authoring state', error)
      })
  }

  const settle = (next: AuthoringState) => {
    state = next
    selected = selectedExam(state.questionBank, state.examDraft, selected)
    mirror()
    for (const listener of listeners) listener()
  }

  // Every write goes through here: it is the single place the authoring state
  // is mirrored and subscribers are told.
  const apply = (
    next: (state: AuthoringState) => AuthoringState,
    dirty: boolean,
    recordHistory = false,
  ) => {
    const updated = next(state)
    if (updated === state) return
    if (recordHistory) {
      undoStack.push(state)
      if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
      redoStack.length = 0
    }
    settle(dirty ? { ...updated, dirty: true } : updated)
  }

  // One semantic authoring action: the single place the dirty flag is raised,
  // and the single place a step is pushed onto the undo stack. Every boundary
  // method below is exactly one call to this, which is what makes one teacher
  // action one undo step.
  const change = (next: (state: AuthoringState) => AuthoringState) =>
    apply(next, true, true)

  const restoreHistory = (
    source: AuthoringState[],
    destination: AuthoringState[],
  ) => {
    const restored = source.pop()
    if (!restored) return
    destination.push(state)
    settle(restored)
  }

  const store: ExamStore = {
    getState: () => state,
    selectedExam: () => selected,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    setTitle: (title) =>
      change((current) =>
        title === current.examDraft.title
          ? current
          : { ...current, examDraft: { ...current.examDraft, title } },
      ),

    createInQuestionBank: (question) =>
      change((current) => ({
        ...current,
        questionBank: withQuestionBanked(current.questionBank, question),
      })),

    createInExamDraft: (question, afterQuestionId = null) =>
      change((current) => ({
        ...current,
        questionBank: withQuestionBanked(current.questionBank, question),
        examDraft: withReferenceAdded(
          current.examDraft,
          question.id,
          afterQuestionId,
        ),
      })),

    updateInQuestionBank: (question) =>
      change((current) => ({
        ...current,
        questionBank: withQuestionBanked(current.questionBank, question),
      })),

    setQuestionColumns: (questionIds, columns) => {
      const targeted = new Set(questionIds)
      change((current) => {
        let moved = false
        const questions = current.questionBank.questions.map((question) => {
          if (!targeted.has(question.id) || question.columns === columns) {
            return question
          }
          moved = true
          return { ...question, columns }
        })
        return moved ? { ...current, questionBank: { questions } } : current
      })
    },

    duplicateInExamDraft: (questionId) =>
      change((current) => {
        const original = bankQuestionById(current.questionBank, questionId)
        if (!original) return current
        const copy = duplicateQuestion(original)
        return {
          ...current,
          questionBank: withQuestionBanked(current.questionBank, copy),
          examDraft: withReferenceAdded(current.examDraft, copy.id, questionId),
        }
      }),

    addToExamDraft: (questionId, targetQuestionId = null, placement = 'after') =>
      change((current) => {
        const question = bankQuestionById(current.questionBank, questionId)
        if (!question) return current
        // An insertion point in another Question Section is refused rather than
        // quietly honoured somewhere else. `createInExamDraft` is deliberately
        // more tolerant: there the position is a hint and refusing it would
        // lose a question the teacher has just written.
        const target = targetQuestionId
          ? bankQuestionById(current.questionBank, targetQuestionId)
          : null
        if (target && target.type !== question.type) return current
        return withExamDraft(
          current,
          withReferenceAdded(
            current.examDraft,
            questionId,
            targetQuestionId,
            placement,
          ),
        )
      }),

    replaceInExamDraft: (outgoingQuestionId, incomingQuestionId) =>
      change((current) => {
        const outgoing = bankQuestionById(current.questionBank, outgoingQuestionId)
        const incoming = bankQuestionById(current.questionBank, incomingQuestionId)
        if (!outgoing || !incoming || outgoing.type !== incoming.type) return current
        return withExamDraft(
          current,
          withReferenceReplaced(
            current.examDraft,
            outgoingQuestionId,
            incomingQuestionId,
          ),
        )
      }),

    moveInExamDraft: (questionIds, targetId, placement) =>
      change((current) => {
        // Reordering is the derived Exam's own rule — a question only ever
        // moves within its Question Section — so the move is resolved against
        // the derived arrangement and its result recorded as the Exam Draft's
        // new order.
        const { exam, version } = selectedExam(current.questionBank, current.examDraft)
        const moved = moveQuestions(exam, version, questionIds, targetId, placement)
        if (moved === version) return current
        return withExamDraft(
          current,
          withReferenceOrder(current.examDraft, moved.questionOrder),
        )
      }),

    removeFromExamDraft: (questionIds) =>
      change((current) =>
        withExamDraft(current, withReferencesRemoved(current.examDraft, questionIds)),
      ),

    hasSavedExam: () => saved !== null,

    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undo: () => restoreHistory(undoStack, redoStack),
    redo: () => restoreHistory(redoStack, undoStack),

    save: async () => {
      await pending
      const savingState = state
      const nextSaved: SavedState = {
        questionBank: savingState.questionBank,
        examDraft: savingState.examDraft,
      }
      await (durableBackend
        ? durableBackend.commitSaved(nextSaved)
        : savedBackend?.write(nextSaved))
      saved = nextSaved
      // A new authoring action may have happened while durable Save was in
      // flight. It is ordered after the saved transaction and remains dirty;
      // only the exact state that was saved can be marked clean.
      if (state !== savingState) return
      if (durableBackend) {
        state = { ...savingState, dirty: false }
        selected = selectedExam(state.questionBank, state.examDraft, selected)
        for (const listener of listeners) listener()
      } else {
        apply((current) => ({ ...current, dirty: false }), false)
        await pending
      }
    },

    discard: async () => {
      const restored: AuthoringState = saved
        ? { ...saved, dirty: false }
        : createAuthoringState()
      undoStack.length = 0
      redoStack.length = 0
      apply(() => restored, false)
      await pending
    },

    whenSettled: () => pending,
  }

  return store
}

// Restore the authoring state the teacher left behind, or start a clean one.
export async function loadExamStore(
  backend: Backend<AuthoringState>,
  savedBackend?: Backend<SavedState>,
): Promise<ExamStore> {
  let stored: AuthoringState | null = null
  let saved: SavedState | null = null
  try {
    stored = await backend.read()
  } catch (error) {
    console.error('Could not read the authoring state', error)
  }
  try {
    const storedSaved = 'readSaved' in backend
      ? await (backend as DurableAuthoringBackend).readSaved()
      : (await savedBackend?.read()) ?? null
    saved = isSavedState(storedSaved) ? storedSaved : null
  } catch (error) {
    console.error('Could not read the saved exam', error)
  }
  const initial = isAuthoringState(stored)
    ? stored
    : saved
      ? { ...saved, dirty: false }
      : createAuthoringState()
  return createExamStore({ backend, savedBackend, saved, initial })
}
