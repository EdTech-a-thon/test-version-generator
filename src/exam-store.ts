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
  shuffleSelectedAnswers,
  shuffleSelectedQuestions,
  topicsOf,
  type ColumnSetting,
  type Question,
  type QuestionPlacement,
} from './exam'
import {
  bankQuestionById,
  createExamDraft,
  createQuestionBank,
  withChoiceOrder,
  withQuestionBanked,
  withReferenceAdded,
  withReferenceOrder,
  withReferenceReplaced,
  withReferencesRemoved,
  type ExamDraft,
  type QuestionBank,
} from './question-bank'
import { selectedExam, type SelectedExam } from './selected-exam'
import {
  compatibleHistoricalDraft,
  reconcileHistoricalDraft,
  type HistoricalQuestionResolution,
} from './historical-draft'
import {
  EMPTY_PUBLICATION_HISTORY,
  type PublicationCommit,
  type PublicationHistory,
} from './export-preparation'

/** Everything authoring owns: canonical content, the selection made from it,
 *  and whether that has reached the saved state yet. */
export type AuthoringState = {
  questionBank: QuestionBank
  examDraft: ExamDraft
  /** The Version resolved by the most recent successful live-draft export.
   * This is not Version History ordering: re-exporting an older Version moves
   * the comparison point without changing the append-only history. */
  lastExportedVersionId?: string
  dirty: boolean
}

export type SavedState = Omit<AuthoringState, 'dirty'>

export type EquivalentReplacementSummary = {
  replaced: number
  unmatched: number
}

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
 *  durability boundary as the working Question Bank and Exam Draft. */
export interface DurableAuthoringBackend extends Backend<AuthoringState> {
  readSaved(): Promise<SavedState | null>
  commitSaved(value: SavedState): Promise<void>
  readPublicationHistory(): Promise<PublicationHistory>
  commitPublication(value: AuthoringState, publication: PublicationCommit): Promise<void>
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

function isExamDraft(value: unknown): value is ExamDraft {
  const draft = value as ExamDraft | null
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
    (state.lastExportedVersionId === undefined || typeof state.lastExportedVersionId === 'string') &&
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
  /** Whether the newest Working Copy has reached browser-local storage. */
  backupStatus(): BackupStatus

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
  /** Replaces as many selected Exam Draft questions as have exact, unused
   *  Equivalent Questions in the latest Question Bank state. All replacements
   *  are one authoring action and candidates never come from the initial draft. */
  replaceWithEquivalentQuestions(
    questionIds: readonly string[],
  ): EquivalentReplacementSummary
  /** Moves references within their Question Section. A target in another
   *  section is refused: composing never changes a question's type. */
  moveInExamDraft(
    questionIds: readonly string[],
    targetId: string,
    placement: QuestionPlacement,
  ): void
  /** Shuffles selected references only among their current positions, within
   *  each Question Section. Every eligible section changes order in this one
   *  authoring action. */
  shuffleSelectedQuestions(questionIds: readonly string[]): void
  /** Shuffles each selected eligible Multiple Choice question's answers in one
   *  authoring action. The order belongs to the Exam Draft, not Question
   *  Content, so its canonical authored order remains intact. */
  shuffleSelectedAnswers(questionIds: readonly string[]): void
  /** Removes references from the Exam Draft, leaving their Question Bank
   *  records exactly as they were. Remove excludes; it never deletes. */
  removeFromExamDraft(questionIds: readonly string[]): void
  /** Replaces the complete Exam Draft arrangement with a compatible historical
   * Version while retaining current Question Bank records. */
  useHistoricalVersionAsDraft(versionId: string): boolean
  /** Reconciles a historical Version in one atomic, undoable authoring action.
   * Historical recreations are new Question Bank records; current records are
   * never overwritten. */
  reconcileHistoricalVersionAsDraft(
    versionId: string,
    resolutions: Readonly<Record<string, HistoricalQuestionResolution>>,
  ): boolean

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
  publish(publication: PublicationCommit): Promise<void>
  publicationHistory(): PublicationHistory
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

/** Freeze every referenced Question's current layout into an Exam arrangement.
 * It is used at save time, where an absent legacy setting must not keep
 * following a later canonical-content edit. */
function withResolvedColumns(state: AuthoringState): ExamDraft {
  const current = state.examDraft.columns ?? {}
  let changed = false
  const columns = { ...current }
  for (const questionId of state.examDraft.questionIds) {
    if (columns[questionId] !== undefined) continue
    const question = bankQuestionById(state.questionBank, questionId)
    if (!question) continue
    columns[questionId] = question.columns
    changed = true
  }
  return changed ? { ...state.examDraft, columns } : state.examDraft
}

/** Savedness is a composition comparison. Canonical Question Content is live,
 * so it intentionally does not participate: only the Exam name, membership,
 * question order, answer order and column layout are explicitly saved. */
function sameExamDraft(left: ExamDraft, right: ExamDraft): boolean {
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
): ExamDraft {
  if (state.examDraft.columns?.[questionId] !== undefined) return state.examDraft
  const question = bankQuestionById(state.questionBank, questionId)
  if (!question) return state.examDraft
  return {
    ...state.examDraft,
    columns: { ...(state.examDraft.columns ?? {}), [questionId]: question.columns },
  }
}

function withDirtyFlag(current: AuthoringState, saved: SavedState | null): AuthoringState {
  const dirty = !saved || !sameExamDraft(current.examDraft, saved.examDraft)
  return current.dirty === dirty ? current : { ...current, dirty }
}

function areEquivalentQuestions(left: Question, right: Question): boolean {
  const leftTopics = new Set(topicsOf(left))
  const rightTopics = new Set(topicsOf(right))
  if (leftTopics.size === 0 || leftTopics.size !== rightTopics.size) return false
  return (
    left.type === right.type
    && left.difficulty === right.difficulty
    && [...leftTopics].every((topic) => rightTopics.has(topic))
  )
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
  publicationHistory?: PublicationHistory
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
    examDraft: initialState.examDraft,
    ...(initialState.lastExportedVersionId
      ? { lastExportedVersionId: initialState.lastExportedVersionId }
      : {}),
  }
  let state: AuthoringState = withDirtyFlag(initialState, saved)
  let publicationHistory = options.publicationHistory ?? EMPTY_PUBLICATION_HISTORY
  // The derived Exam, kept beside the state it was derived from. Deriving it
  // once per change rather than once per read is what lets a consumer treat it
  // as a stable dependency; `selectedExam` reuses the halves that did not move.
  let selected: SelectedExam = selectedExam(state.questionBank, state.examDraft)
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
    selected = selectedExam(state.questionBank, state.examDraft, selected)
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
    // Publication is not an authoring action. Undo restores only the Question
    // Bank and Exam Draft while retaining the checkpoint set by the most
    // recent successful live-draft export; otherwise Undo could make a changed
    // draft appear to match an older export and skip its replacement warning.
    const { lastExportedVersionId } = state
    settle(
      lastExportedVersionId === undefined
        ? historicalAuthoringState
        : { ...historicalAuthoringState, lastExportedVersionId },
    )
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
      change((current) => {
        // A Question Content edit must not silently revise this Exam's answer
        // layout. Capture its current effective setting before replacing the
        // canonical record, including for working copies written before the
        // setting moved onto the Exam Draft.
        const prior = bankQuestionById(current.questionBank, question.id)
        const columns = current.examDraft.columns ?? {}
        const examDraft = current.examDraft.questionIds.includes(question.id)
          && columns[question.id] === undefined
          && prior
          ? {
              ...current.examDraft,
              columns: { ...columns, [question.id]: prior.columns },
            }
          : current.examDraft
        return {
          ...current,
          questionBank: withQuestionBanked(current.questionBank, question),
          examDraft,
        }
      }),

    setQuestionColumns: (questionIds, columns) => {
      const targeted = new Set(questionIds)
      change((current) => {
        const currentColumns = current.examDraft.columns ?? {}
        let changed = false
        const nextColumns = { ...currentColumns }
        for (const questionId of targeted) {
          if (!current.examDraft.questionIds.includes(questionId)) continue
          const effectiveColumns = nextColumns[questionId]
            ?? bankQuestionById(current.questionBank, questionId)?.columns
          if (effectiveColumns === columns) continue
          nextColumns[questionId] = columns
          changed = true
        }
        return changed
          ? { ...current, examDraft: { ...current.examDraft, columns: nextColumns } }
          : current
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
        if (
          !outgoing
          || !incoming
          || outgoing.type !== incoming.type
          || current.examDraft.questionIds.includes(incomingQuestionId)
        ) return current
        const examDraft = withColumnResolved(current, outgoingQuestionId)
        return withExamDraft(
          current,
          withReferenceReplaced(examDraft, outgoingQuestionId, incomingQuestionId),
        )
      }),

    replaceWithEquivalentQuestions: (questionIds) => {
      const summary: EquivalentReplacementSummary = { replaced: 0, unmatched: 0 }
      change((current) => {
        const initialDraftIds = new Set(current.examDraft.questionIds)
        const selectedIds = [...new Set(questionIds)].filter((id) => initialDraftIds.has(id))
        const available = current.questionBank.questions.filter(
          (question) => !initialDraftIds.has(question.id),
        )
        const consumed = new Set<string>()
        let examDraft = current.examDraft

        for (const outgoingId of selectedIds) {
          const outgoing = bankQuestionById(current.questionBank, outgoingId)
          const incoming = outgoing
            ? available.find(
                (candidate) =>
                  !consumed.has(candidate.id)
                  && areEquivalentQuestions(outgoing, candidate),
              )
            : undefined
          if (!incoming) {
            summary.unmatched += 1
            continue
          }
          consumed.add(incoming.id)
          const resolved = withColumnResolved({ ...current, examDraft }, outgoingId)
          examDraft = withReferenceReplaced(resolved, outgoingId, incoming.id)
          summary.replaced += 1
        }

        return withExamDraft(current, examDraft)
      })
      return summary
    },

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

    shuffleSelectedQuestions: (questionIds) =>
      change((current) => {
        const { exam, version } = selectedExam(current.questionBank, current.examDraft)
        const shuffled = shuffleSelectedQuestions(exam, version, questionIds, Math.random)
        if (shuffled === version) return current
        return withExamDraft(
          current,
          withReferenceOrder(current.examDraft, shuffled.questionOrder),
        )
      }),

    shuffleSelectedAnswers: (questionIds) =>
      change((current) => {
        const { exam, version } = selectedExam(current.questionBank, current.examDraft)
        const shuffled = shuffleSelectedAnswers(exam, version, questionIds, Math.random)
        if (shuffled === version) return current
        return withExamDraft(
          current,
          withChoiceOrder(current.examDraft, shuffled.choiceOrder),
        )
      }),

    removeFromExamDraft: (questionIds) =>
      change((current) =>
        withExamDraft(current, withReferencesRemoved(current.examDraft, questionIds)),
      ),

    useHistoricalVersionAsDraft: (versionId) => {
      const version = publicationHistory.versions.find((item) => item.id === versionId)
      if (!version) return false
      const replacement = compatibleHistoricalDraft(
        publicationHistory,
        version,
        state.examDraft,
        state.questionBank,
      )
      if (!replacement) return false
      const changed = replacement !== state.examDraft
      change((current) =>
        replacement === current.examDraft
          ? current
          : { ...current, examDraft: replacement },
      )
      return changed
    },

    reconcileHistoricalVersionAsDraft: (versionId, resolutions) => {
      const version = publicationHistory.versions.find((item) => item.id === versionId)
      if (!version) return false
      const replacement = reconcileHistoricalDraft(
        publicationHistory,
        version,
        state.examDraft,
        state.questionBank,
        resolutions,
      )
      if (!replacement) return false
      const changed = replacement.questionBank !== state.questionBank
        || replacement.examDraft !== state.examDraft
      change((current) =>
        !changed
          ? current
          : {
              ...current,
              questionBank: replacement.questionBank,
              examDraft: replacement.examDraft,
            },
      )
      return changed
    },

    hasSavedExam: () => saved !== null,

    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undo: () => restoreHistory(undoStack, redoStack),
    redo: () => restoreHistory(redoStack, undoStack),

    saveAs: async (commit) => {
      await pending
      const working = state
      const sourceSaved = saved
      const copiedTitle = `${working.examDraft.title} Copy`
      const targetInitial: AuthoringState = {
        ...working,
        // A newly explicit saved composition must freeze any inherited answer
        // column settings exactly as Save does.
        examDraft: { ...withResolvedColumns(working), title: copiedTitle },
        dirty: false,
      }
      delete targetInitial.lastExportedVersionId
      // Question Content remains live when restoring an arrangement: Save As
      // must not roll canonical edits back merely because the source's saved
      // composition predates them.
      const { lastExportedVersionId: _workingExportedVersionId, ...sourceWithoutCheckpoint } = working
      const sourceRestored: AuthoringState = {
        ...sourceWithoutCheckpoint,
        examDraft: sourceSaved?.examDraft ?? createExamDraft(working.examDraft.title),
        ...(sourceSaved?.lastExportedVersionId
          ? { lastExportedVersionId: sourceSaved.lastExportedVersionId }
          : {}),
        dirty: false,
      }
      const history = { undo: [...undoStack], redo: [...redoStack] }
      await commit({ sourceRestored, targetInitial })
      state = withDirtyFlag(sourceRestored, sourceSaved)
      selected = selectedExam(state.questionBank, state.examDraft, selected)
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
        examDraft: withResolvedColumns(savingState),
        ...(savingState.lastExportedVersionId
          ? { lastExportedVersionId: savingState.lastExportedVersionId }
          : {}),
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
        state = withDirtyFlag({ ...state, examDraft: nextSaved.examDraft }, saved)
        selected = selectedExam(state.questionBank, state.examDraft, selected)
        notify()
      } else {
        settle({ ...state, examDraft: nextSaved.examDraft })
        await pending
      }
    },

    publish: async (publication) => {
      await pending
      const publishingState = state
      const publicationState: AuthoringState = {
        ...publishingState,
        examDraft: withResolvedColumns(publishingState),
        ...(publication.exportedVersionId ?? publishingState.lastExportedVersionId
          ? {
              lastExportedVersionId:
                publication.exportedVersionId ?? publishingState.lastExportedVersionId,
            }
          : {}),
      }
      if (durableBackend) {
        await durableBackend.commitPublication(publicationState, publication)
      } else {
        await backend.write(publicationState)
      }
      if (publication.version) {
        publicationHistory = {
          versions: [...publicationHistory.versions, publication.version],
          revisions: [...publicationHistory.revisions, ...publication.revisions],
          plans: [...publicationHistory.plans, ...publication.plans],
        }
      }
      // Publishing may overlap newer authoring. The newer draft stays dirty,
      // but its confirmation point still becomes the Version this successful
      // export resolved; otherwise a later Use as Draft would compare against
      // stale append-only history until reload.
      if (state !== publishingState) {
        if (publication.exportedVersionId && state.lastExportedVersionId !== publication.exportedVersionId) {
          settle({ ...state, lastExportedVersionId: publication.exportedVersionId })
        }
        return
      }
      settle(publicationState)
      await pending
    },

    publicationHistory: () => publicationHistory,

    discard: async () => {
      // Discard restores this Exam's saved composition, but Question Content is
      // canonical and live. A later typo fix therefore remains visible rather
      // than being rolled back with this Exam's arrangement.
      const savedDraft = saved?.examDraft ?? createExamDraft(state.examDraft.title)
      const restored: AuthoringState = {
        ...state,
        examDraft: savedDraft,
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
  let publicationHistory: PublicationHistory = EMPTY_PUBLICATION_HISTORY
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
    publicationHistory = 'readPublicationHistory' in backend
      ? await (backend as DurableAuthoringBackend).readPublicationHistory()
      : EMPTY_PUBLICATION_HISTORY
  } catch (error) {
    console.error('Could not read Version History', error)
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
    publicationHistory,
  })
}
