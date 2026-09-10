// The authoring state and the store that owns it.
//
// The authoring state — the Question Bank, the Working Copy, and the dirty
// flag — is mirrored to a backend on every change, so a refresh loses nothing.
// The backend is a narrow injectable interface: the app hands the store the
// normalized IndexedDB generation, while unit tests use an in-memory backend.
//
// The store is also the one authoring boundary. Every semantic action a teacher
// can take on the Question Bank or the Working Copy is a single method here:
// creating canonical Question Content with or without putting it on the exam,
// adding a reference, editing a banked question's content and metadata, moving
// a reference, Replacing one, and Removing one. Callers never assemble an
// action out of smaller ones — that is what makes each of them atomic, one undo
// step, and one mirrored write.

import {
  choicesOf,
  columnsOf,
  duplicateQuestion,
  moveQuestions,
  orderedChoices,
  orderedQuestions,
  shuffleSelectedAnswers,
  shuffleSelectedQuestions,
  type ColumnSetting,
  type Question,
  type QuestionPlacement,
} from './exam'
import {
  bankQuestionById,
  createWorkingCopy,
  createQuestionBank,
  withChoiceOrder,
  withQuestionBanked,
  withReferenceAdded,
  withReferenceOrder,
  withReferenceReplaced,
  withReferencesRemoved,
  type ExamWorkingCopy,
  type QuestionBank,
} from './question-bank'
import { selectedExam, type SelectedExam } from './selected-exam'
import { withCanonicalQuestionProjection } from './canonical-question-projection'
import { withoutQuestions } from './question-deletion'
import {
  EMPTY_EXPORT_HISTORY,
  type ExportHistory,
  type ExportRecord,
} from './export-preparation'

/** Everything authoring owns: canonical content, the selection made from it,
 *  and whether that has reached the saved state yet. */
export type AuthoringState = {
  questionBank: QuestionBank
  workingCopy: ExamWorkingCopy
  dirty: boolean
}

export type SavedState = Omit<AuthoringState, 'dirty'>

/** Browser-local Working Copy durability, separate from whether its Exam has
 * intentionally been saved. */
export type BackupStatus = 'ready' | 'pending' | 'failed'

// The whole persistence surface: read the last value written, write a new one.
// Both are asynchronous so that an IndexedDB implementation fits behind the
// same interface as a localStorage one.
export interface Backend<T> {
  read(): Promise<T | null>
  write(value: T): Promise<void>
}

/** An authoring backend that keeps the explicit saved state in the same
 *  durability boundary as the working Question Bank and Working Copy. */
export interface DurableAuthoringBackend extends Backend<AuthoringState> {
  readSaved(): Promise<SavedState | null>
  /** Creates an Exam's saved baseline and first Working Copy in one transaction. */
  initialize(saved: SavedState, working: AuthoringState): Promise<void>
  commitSaved(value: SavedState): Promise<void>
  readExportHistory(): Promise<ExportHistory>
  commitExportRecord(record: ExportRecord): Promise<void>
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
    workingCopy: createWorkingCopy(),
    dirty: false,
  }
}

function isQuestionBank(value: unknown): value is QuestionBank {
  const bank = value as QuestionBank | null
  return typeof bank === 'object' && bank !== null && Array.isArray(bank.questions)
}

function isChoiceOrder(value: unknown): value is Record<string, string[]> {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every(
      (choices) => Array.isArray(choices) && choices.every((choiceId) => typeof choiceId === 'string'),
    )
  )
}

function isColumnSettings(value: unknown): value is Record<string, ColumnSetting> {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every((columns) => columns === 1 || columns === 2 || columns === 4)
  )
}

function isWorkingCopy(value: unknown): value is ExamWorkingCopy {
  const draft = value as ExamWorkingCopy | null
  return (
    typeof draft === 'object' &&
    draft !== null &&
    typeof draft.title === 'string' &&
    Array.isArray(draft.questionIds) &&
    draft.questionIds.every((id) => typeof id === 'string') &&
    (draft.columns === undefined || isColumnSettings(draft.columns)) &&
    (draft.choiceOrder === undefined || isChoiceOrder(draft.choiceOrder))
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
    isWorkingCopy(state.workingCopy)
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
   *  Question Bank records, in Working Copy order, and nothing else. */
  selectedExam(): SelectedExam
  subscribe(listener: () => void): () => void
  /** Whether the newest Working Copy has reached browser-local storage. */
  backupStatus(): BackupStatus

  setTitle(title: string): void
  /** Refreshes the canonical Questions projected from open Question Banks.
   * Workspace browsing is not an Exam command and creates no Undo step. */
  syncCanonicalQuestions(questions: readonly Question[]): void
  /** Accepts a deletion already committed by the cross-resource durability
   * boundary. It is not an Exam command and clears history rather than writing
   * an undoable or discardable removal. */
  acceptForcedDeletion(questionIds: readonly string[]): void

  /** Banks canonical Question Content without putting it on the Working Copy. */
  createInQuestionBank(question: Question): void
  /** Replaces one Question Bank record — its Question Content, its Question
   *  Type, its Difficulty and its Topics — wherever it is referenced. One
   *  popup save is one call, so a content edit and a metadata edit made
   *  together are one authoring action. An unbanked question is banked, so a
   *  save is never lost. */
  updateInQuestionBank(question: Question): void
  setQuestionColumns(questionIds: readonly string[], columns: ColumnSetting): void
  /** References a newly canonical copy immediately after the original while
   * preserving the original's visible Exam presentation. The caller may supply
   * a copy already committed to the owning Question Bank. */
  duplicateInWorkingCopy(questionId: string, duplicate?: Question): void
  /** References an unused Question Bank record from the Working Copy — at the end,
   *  or immediately before or after `targetQuestionId`. `'before'` is what names
   *  the first position in a Question Section, which no `'after'` can. A
   *  question already referenced is left where it is: a reference occurs at most
   *  once. An insertion beside a question in another Question Section is
   *  refused: composing never moves a question across the Multiple Choice /
   *  Short Answer boundary. */
  addToWorkingCopy(
    question: string | Question,
    targetQuestionId?: string | null,
    placement?: QuestionPlacement,
  ): void
  /** Replaces one Working Copy reference with an unused Question Bank record of
   *  the same Question Type, in the outgoing question's exact position. Nothing
   *  is copied and nothing is deleted: the outgoing question keeps its Question
   *  Bank record and is available to compose with again. Refused when either
   *  question is unbanked, when their Question Sections differ, or when the
   *  incoming question is already on the Working Copy. */
  replaceInWorkingCopy(outgoingQuestionId: string, incoming: string | Question): void
  /** Moves references within their Question Section. A target in another
   *  section is refused: composing never changes a question's type. */
  moveInWorkingCopy(
    questionIds: readonly string[],
    targetId: string,
    placement: QuestionPlacement,
  ): void
  /** Shuffles selected references only among their current positions, within
   *  each Question Section. Every eligible section changes order in this one
   *  authoring action. */
  shuffleSelectedQuestions(questionIds: readonly string[]): void
  /** Shuffles each selected eligible Multiple Choice question's answers in one
   *  authoring action. The order belongs to the Working Copy, not Question
   *  Content, so its canonical authored order remains intact. */
  shuffleSelectedAnswers(questionIds: readonly string[]): void
  /** Removes references from the Working Copy, leaving their Question Bank
   *  records exactly as they were. Remove excludes; it never deletes. */
  removeFromWorkingCopy(questionIds: readonly string[]): void
  /** Whether anything has ever been saved — what tells an untouched draft from
   *  an exam with unsaved changes. */
  hasSavedExam(): boolean
  canUndo(): boolean
  canRedo(): boolean
  undo(): void
  redo(): void
  save(): Promise<void>
  /** Creates a separately saved Exam through the caller's one durable
   * transaction, then leaves this source Exam at its saved composition. */
  saveAs(commit: (snapshot: SaveAsSnapshot) => Promise<void>): Promise<SaveAsSession>
  /** Atomically records the current Working Copy alongside newly prepared
   * immutable Export History. It never changes the explicitly saved Exam. */
  publish(record: ExportRecord): Promise<void>
  exportHistory(): ExportHistory
  discard(): Promise<void>

  /** Resolves once every mirrored write has landed. For tests and shutdown. */
  whenSettled(): Promise<void>
}

// The authoring state carrying a new Working Copy — or the very same state when
// the Working Copy refused the change. Every reference operation is total and
// returns the draft it was given when it declines, and this is what turns that
// into "nothing happened": no undo step, no dirty flag and no write, because
// `apply` stops at an unchanged state.
function withExamWorkingCopy(
  state: AuthoringState,
  workingCopy: ExamWorkingCopy,
): AuthoringState {
  return workingCopy === state.workingCopy ? state : { ...state, workingCopy }
}

/** Freeze every referenced Question's current layout into an Exam arrangement.
 * It is used at save time, where an absent legacy setting must not keep
 * following a later canonical-content edit. */
function withResolvedColumns(state: AuthoringState): ExamWorkingCopy {
  const current = state.workingCopy.columns ?? {}
  let changed = false
  const columns = { ...current }
  for (const questionId of state.workingCopy.questionIds) {
    if (columns[questionId] !== undefined) continue
    const question = bankQuestionById(state.questionBank, questionId)
    if (!question) continue
    columns[questionId] = question.columns
    changed = true
  }
  return changed ? { ...state.workingCopy, columns } : state.workingCopy
}

/** Savedness is a composition comparison. Canonical Question Content is live,
 * so it intentionally does not participate: only the Exam name, membership,
 * question order, answer order and column layout are explicitly saved. */
function sameExamWorkingCopy(left: ExamWorkingCopy, right: ExamWorkingCopy): boolean {
  const sameEntries = <T>(first: Record<string, T> | undefined, second: Record<string, T> | undefined, equal: (left: T, right: T) => boolean) => {
    const firstEntries = Object.entries(first ?? {})
    const secondEntries = second ?? {}
    return firstEntries.length === Object.keys(secondEntries).length
      && firstEntries.every(([id, value]) => secondEntries[id] !== undefined && equal(value, secondEntries[id]!))
  }
  return left.title === right.title
    && left.questionIds.length === right.questionIds.length
    && left.questionIds.every((id, index) => id === right.questionIds[index])
    && sameEntries(left.columns, right.columns, (first, second) => first === second)
    && sameEntries(left.choiceOrder, right.choiceOrder, (first, second) =>
      first.length === second.length && first.every((id, index) => id === second[index]),
    )
}

/** Make a referenced Question's current effective layout explicit before an
 * operation transfers its position to another Question. */
function withColumnResolved(
  state: AuthoringState,
  questionId: string,
): ExamWorkingCopy {
  if (state.workingCopy.columns?.[questionId] !== undefined) return state.workingCopy
  const question = bankQuestionById(state.questionBank, questionId)
  if (!question) return state.workingCopy
  return {
    ...state.workingCopy,
    columns: { ...(state.workingCopy.columns ?? {}), [questionId]: question.columns },
  }
}

function withDirtyFlag(current: AuthoringState, saved: SavedState | null): AuthoringState {
  const dirty = !saved || !sameExamWorkingCopy(current.workingCopy, saved.workingCopy)
  return current.dirty === dirty ? current : { ...current, dirty }
}

export type SaveAsSnapshot = {
  sourceRestored: AuthoringState
  targetInitial: AuthoringState
}

/** Session-only history that moves with Save As rather than being persisted. */
export type SaveAsSession = {
  initial: AuthoringState
  history: { undo: AuthoringState[]; redo: AuthoringState[] }
}

export function createExamStore(options: {
  backend: Backend<AuthoringState>
  savedBackend?: Backend<SavedState>
  saved?: SavedState | null
  exportHistory?: ExportHistory
  initial?: AuthoringState
  initialHistory?: { undo: AuthoringState[]; redo: AuthoringState[] }
}): ExamStore {
  const { backend, savedBackend } = options
  const durableBackend = 'commitSaved' in backend
    ? (backend as DurableAuthoringBackend)
    : null
  const initialState = options.initial ?? createAuthoringState()
  // Every Exam has a saved composition. The fallback also gives pre-ticket
  // records (and narrow in-memory test stores) a stable initial baseline.
  let saved: SavedState | null = options.saved ?? {
    questionBank: initialState.questionBank,
    workingCopy: initialState.workingCopy,
  }
  let state: AuthoringState = withDirtyFlag(initialState, saved)
  let exportHistory = options.exportHistory ?? EMPTY_EXPORT_HISTORY
  // The derived Exam, kept beside the state it was derived from. Deriving it
  // once per change rather than once per read is what lets a consumer treat it
  // as a stable dependency; `selectedExam` reuses the halves that did not move.
  let selected: SelectedExam = selectedExam(state.questionBank, state.workingCopy)
  const listeners = new Set<() => void>()
  let pending: Promise<void> = Promise.resolve()
  let backupStatus: BackupStatus = 'ready'
  let backupRevision = 0
  const undoStack: AuthoringState[] = [...(options.initialHistory?.undo ?? [])]
  const redoStack: AuthoringState[] = [...(options.initialHistory?.redo ?? [])]
  const HISTORY_LIMIT = 100

  // Generic backends are chained so their writes cannot overtake one another.
  // The durable IndexedDB backend starts each transaction immediately; the
  // database queues overlapping read/write transactions in creation order.
  // Starting them here matters at navigation time: a second authored question
  // must already be inside IndexedDB's durability boundary when Reload begins,
  // not waiting behind a promise for the first transaction.
  const notify = () => {
    for (const listener of listeners) listener()
  }

  const mirror = () => {
    const snapshot = state
    const revision = ++backupRevision
    backupStatus = 'pending'
    const write = durableBackend
      ? backend.write(snapshot)
      : pending.then(() => backend.write(snapshot))
    pending = Promise.all([pending, write])
      .then(() => {
        if (revision === backupRevision) {
          backupStatus = 'ready'
          notify()
        }
      })
      .catch((error: unknown) => {
        console.error('Could not mirror the authoring state', error)
        if (revision === backupRevision) {
          backupStatus = 'failed'
          notify()
        }
      })
  }

  const settle = (next: AuthoringState) => {
    state = withDirtyFlag(next, saved)
    selected = selectedExam(state.questionBank, state.workingCopy, selected)
    mirror()
    notify()
  }

  // Every write goes through here: it is the single place the authoring state
  // is mirrored and subscribers are told.
  const apply = (
    next: (state: AuthoringState) => AuthoringState,
    _dirty: boolean,
    recordHistory = false,
  ) => {
    const updated = next(state)
    if (updated === state) return
    if (recordHistory) {
      undoStack.push(state)
      if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
      redoStack.length = 0
    }
    settle(updated)
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
    const historicalAuthoringState = source.pop()
    if (!historicalAuthoringState) return
    destination.push(state)
    settle(historicalAuthoringState)
  }

  const syncHistoryQuestion = (snapshot: AuthoringState, question: Question): AuthoringState => {
    const projected = withCanonicalQuestionProjection(snapshot, null, question).working
    return projected.questionBank === snapshot.questionBank && projected.workingCopy === snapshot.workingCopy
      ? snapshot
      : projected
  }

  const store: ExamStore = {
    getState: () => state,
    selectedExam: () => selected,
    backupStatus: () => backupStatus,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    setTitle: (title) =>
      change((current) =>
        title === current.workingCopy.title
          ? current
          : { ...current, workingCopy: { ...current.workingCopy, title } },
      ),

    syncCanonicalQuestions: (questions) => {
      let working = state
      let nextSaved = saved
      for (const question of questions) {
        if (!working.questionBank.questions.some((candidate) => candidate.id === question.id)) {
          const bank = withQuestionBanked(working.questionBank, question)
          working = bank === working.questionBank ? working : { ...working, questionBank: bank }
          continue
        }
        const projected = withCanonicalQuestionProjection(working, nextSaved, question)
        working = projected.working
        nextSaved = projected.saved
        for (let index = 0; index < undoStack.length; index += 1) {
          undoStack[index] = syncHistoryQuestion(undoStack[index]!, question)
        }
        for (let index = 0; index < redoStack.length; index += 1) {
          redoStack[index] = syncHistoryQuestion(redoStack[index]!, question)
        }
      }
      if (working === state) return
      state = working
      saved = nextSaved
      selected = selectedExam(state.questionBank, state.workingCopy, selected)
      notify()
    },

    acceptForcedDeletion: (questionIds) => {
      const deleted = withoutQuestions(state, saved, new Set(questionIds))
      state = deleted.working
      saved = deleted.saved
      selected = selectedExam(state.questionBank, state.workingCopy, selected)
      undoStack.length = 0
      redoStack.length = 0
      notify()
    },

    createInQuestionBank: (question) =>
      change((current) => ({
        ...current,
        questionBank: withQuestionBanked(current.questionBank, question),
      })),

    updateInQuestionBank: (question) =>
      change((current) => {
        // A Question Content edit must not silently revise this Exam's answer
        // layout. Capture its current effective setting before replacing the
        // canonical record, including for working copies written before the
        // setting moved onto the Working Copy.
        const prior = bankQuestionById(current.questionBank, question.id)
        if (prior && prior.type !== question.type) return current
        const columns = current.workingCopy.columns ?? {}
        const workingCopy = current.workingCopy.questionIds.includes(question.id)
          && columns[question.id] === undefined
          && prior
          ? {
              ...current.workingCopy,
              columns: { ...columns, [question.id]: prior.columns },
            }
          : current.workingCopy
        return {
          ...current,
          questionBank: withQuestionBanked(current.questionBank, question),
          workingCopy,
        }
      }),

    setQuestionColumns: (questionIds, columns) => {
      const targeted = new Set(questionIds)
      change((current) => {
        const currentColumns = current.workingCopy.columns ?? {}
        let changed = false
        const nextColumns = { ...currentColumns }
        for (const questionId of targeted) {
          if (!current.workingCopy.questionIds.includes(questionId)) continue
          const effectiveColumns = nextColumns[questionId]
            ?? bankQuestionById(current.questionBank, questionId)?.columns
          if (effectiveColumns === columns) continue
          nextColumns[questionId] = columns
          changed = true
        }
        return changed
          ? { ...current, workingCopy: { ...current.workingCopy, columns: nextColumns } }
          : current
      })
    },

    duplicateInWorkingCopy: (questionId, suppliedCopy) =>
      change((current) => {
        const original = bankQuestionById(current.questionBank, questionId)
        if (!original || !current.workingCopy.questionIds.includes(questionId)) return current
        const copy = suppliedCopy ?? duplicateQuestion(original)
        if (bankQuestionById(current.questionBank, copy.id)) return current
        const selected = selectedExam(current.questionBank, current.workingCopy)
        const visibleOriginal = selected.exam.questions.find(({ id }) => id === questionId)
        const originalChoices = choicesOf(original)
        const copiedChoices = choicesOf(copy)
        const copiedChoiceOrder = orderedChoices(original, selected.arrangement).map((choice) =>
          copiedChoices[originalChoices.findIndex(({ id }) => id === choice.id)]!.id,
        )
        const workingCopy = withReferenceAdded(current.workingCopy, copy.id, questionId)
        return {
          ...current,
          questionBank: withQuestionBanked(current.questionBank, copy),
          workingCopy: {
            ...workingCopy,
            columns: {
              ...(workingCopy.columns ?? {}),
              [copy.id]: visibleOriginal ? columnsOf(visibleOriginal) : columnsOf(original),
            },
            choiceOrder: {
              ...(workingCopy.choiceOrder ?? {}),
              [copy.id]: copiedChoiceOrder,
            },
          },
        }
      }),

    addToWorkingCopy: (questionOrId, targetQuestionId = null, placement = 'after') =>
      change((current) => {
        const supplied = typeof questionOrId === 'string' ? null : questionOrId
        const questionId = typeof questionOrId === 'string' ? questionOrId : questionOrId.id
        const question = supplied ?? bankQuestionById(current.questionBank, questionId)
        if (!question) return current
        // An insertion point in another Question Section is refused rather than
        // quietly honoured somewhere else.
        const target = targetQuestionId
          ? bankQuestionById(current.questionBank, targetQuestionId)
          : null
        if (target && target.type !== question.type) return current
        const bank = supplied
          ? withQuestionBanked(current.questionBank, supplied)
          : current.questionBank
        let workingCopy = withReferenceAdded(
          current.workingCopy,
          questionId,
          targetQuestionId,
          placement,
        )
        if (workingCopy === current.workingCopy) return current
        if (question.type === 'multiple-choice') {
          const selected = selectedExam(bank, current.workingCopy)
          const rendered = orderedQuestions(selected.exam, selected.arrangement)
            .filter(({ type }) => type === question.type)
          const targetIndex = targetQuestionId
            ? rendered.findIndex(({ id }) => id === targetQuestionId)
            : -1
          const neighbor = targetIndex < 0
            ? rendered.at(-1)
            : placement === 'before'
              ? rendered[targetIndex - 1] ?? rendered[targetIndex]
              : rendered[targetIndex]
          workingCopy = {
            ...workingCopy,
            columns: {
              ...(workingCopy.columns ?? {}),
              [questionId]: neighbor ? columnsOf(neighbor) : 1,
            },
          }
        }
        return { ...current, questionBank: bank, workingCopy }
      }),

    replaceInWorkingCopy: (outgoingQuestionId, incomingQuestion) =>
      change((current) => {
        const incomingQuestionId = typeof incomingQuestion === 'string'
          ? incomingQuestion
          : incomingQuestion.id
        const bank = typeof incomingQuestion === 'string'
          ? current.questionBank
          : withQuestionBanked(current.questionBank, incomingQuestion)
        const outgoing = bankQuestionById(bank, outgoingQuestionId)
        const incoming = bankQuestionById(bank, incomingQuestionId)
        if (
          !outgoing
          || !incoming
          || outgoing.type !== incoming.type
          || current.workingCopy.questionIds.includes(incomingQuestionId)
        ) return current
        const workingCopy = withColumnResolved({ ...current, questionBank: bank }, outgoingQuestionId)
        const replaced = withReferenceReplaced(workingCopy, outgoingQuestionId, incomingQuestionId)
        return replaced === current.workingCopy && bank === current.questionBank
          ? current
          : { ...current, questionBank: bank, workingCopy: replaced }
      }),

    moveInWorkingCopy: (questionIds, targetId, placement) =>
      change((current) => {
        // Reordering is the derived Exam's own rule — a question only ever
        // moves within its Question Section — so the move is resolved against
        // the derived arrangement and its result recorded as the Working Copy's
        // new order.
        const { exam, arrangement } = selectedExam(current.questionBank, current.workingCopy)
        const moved = moveQuestions(exam, arrangement, questionIds, targetId, placement)
        if (moved === arrangement) return current
        return withExamWorkingCopy(
          current,
          withReferenceOrder(current.workingCopy, moved.questionOrder),
        )
      }),

    shuffleSelectedQuestions: (questionIds) =>
      change((current) => {
        const { exam, arrangement } = selectedExam(current.questionBank, current.workingCopy)
        const shuffled = shuffleSelectedQuestions(exam, arrangement, questionIds, Math.random)
        if (shuffled === arrangement) return current
        return withExamWorkingCopy(
          current,
          withReferenceOrder(current.workingCopy, shuffled.questionOrder),
        )
      }),

    shuffleSelectedAnswers: (questionIds) =>
      change((current) => {
        const { exam, arrangement } = selectedExam(current.questionBank, current.workingCopy)
        const shuffled = shuffleSelectedAnswers(exam, arrangement, questionIds, Math.random)
        if (shuffled === arrangement) return current
        return withExamWorkingCopy(
          current,
          withChoiceOrder(current.workingCopy, shuffled.choiceOrder),
        )
      }),

    removeFromWorkingCopy: (questionIds) =>
      change((current) =>
        withExamWorkingCopy(current, withReferencesRemoved(current.workingCopy, questionIds)),
      ),

    hasSavedExam: () => saved !== null,

    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undo: () => restoreHistory(undoStack, redoStack),
    redo: () => restoreHistory(redoStack, undoStack),

    saveAs: async (commit) => {
      await pending
      const working = state
      const sourceSaved = saved
      const copiedTitle = `${working.workingCopy.title} Copy`
      const targetInitial: AuthoringState = {
        ...working,
        // A newly explicit saved composition must freeze any inherited answer
        // column settings exactly as Save does.
        workingCopy: { ...withResolvedColumns(working), title: copiedTitle },
        dirty: false,
      }
      // Question Content remains live when restoring an arrangement: Save As
      // must not roll canonical edits back merely because the source's saved
      // composition predates them.
      const sourceRestored: AuthoringState = {
        ...working,
        workingCopy: sourceSaved?.workingCopy ?? createWorkingCopy(working.workingCopy.title),
        dirty: false,
      }
      const history = { undo: [...undoStack], redo: [...redoStack] }
      await commit({ sourceRestored, targetInitial })
      state = withDirtyFlag(sourceRestored, sourceSaved)
      selected = selectedExam(state.questionBank, state.workingCopy, selected)
      undoStack.length = 0
      redoStack.length = 0
      notify()
      return { initial: targetInitial, history }
    },

    save: async () => {
      if (saved && !state.dirty) return
      await pending
      const savingState = state
      const nextSaved: SavedState = {
        questionBank: savingState.questionBank,
        workingCopy: withResolvedColumns(savingState),
      }
      await (durableBackend
        ? durableBackend.commitSaved(nextSaved)
        : savedBackend?.write(nextSaved))
      saved = nextSaved
      // A new authoring action may have happened while durable Save was in
      // flight. It is ordered after the saved transaction and remains dirty;
      // only the exact state that was saved can be marked clean.
      if (state !== savingState) {
        settle(state)
        return
      }
      if (durableBackend) {
        state = withDirtyFlag({ ...state, workingCopy: nextSaved.workingCopy }, saved)
        selected = selectedExam(state.questionBank, state.workingCopy, selected)
        notify()
      } else {
        settle({ ...state, workingCopy: nextSaved.workingCopy })
        await pending
      }
    },

    publish: async (record) => {
      await pending
      if (durableBackend) await durableBackend.commitExportRecord(record)
      exportHistory = { records: [...exportHistory.records, record] }
      notify()
    },

    exportHistory: () => exportHistory,

    discard: async () => {
      // Discard restores this Exam's saved composition, but Question Content is
      // canonical and live. A later typo fix therefore remains visible rather
      // than being rolled back with this Exam's arrangement.
      const savedDraft = saved?.workingCopy ?? createWorkingCopy(state.workingCopy.title)
      const restored: AuthoringState = {
        ...state,
        workingCopy: savedDraft,
      }
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
  let exportHistory: ExportHistory = EMPTY_EXPORT_HISTORY
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
  try {
    exportHistory = 'readExportHistory' in backend
      ? await (backend as DurableAuthoringBackend).readExportHistory()
      : EMPTY_EXPORT_HISTORY
  } catch (error) {
    console.error('Could not read Export History', error)
  }
  const initial = isAuthoringState(stored)
    ? stored
    : saved
      ? { ...saved, dirty: false }
      : createAuthoringState()
  return createExamStore({
    backend,
    savedBackend,
    saved,
    initial,
    exportHistory,
  })
}
