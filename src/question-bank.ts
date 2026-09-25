// The Question Bank and the Working Copy.
//
// The Question Bank holds every canonical question exactly once. The Working Copy
// holds an ordered list of *references* into it — never copies — so editing
// Question Content changes it everywhere it is referenced, and Removing a
// question from the Working Copy leaves its Question Bank record untouched.
//
// A question id appears at most once in a Working Copy: a Working Copy is a
// selection, not a bag. Everything here is pure and total; the store in
// `exam-store.ts` is what makes these operations atomic, undoable and durable,
// and `selected-exam.ts` is what turns the pair into the `Exam` that rendering
// and export consume.

import { DEFAULT_EXAM_TITLE, type Question, type QuestionPlacement } from './exam'

/** Canonical Question Content, stored once per question. */
export type QuestionBank = {
  questions: Question[]
}

/** The mutable selection a teacher is preparing for export: the exam's name and
 *  the ordered Question Bank references on it. Not a Arrangement. */
export type ExamWorkingCopy = {
  title: string
  questionIds: string[]
  /** Answer-column layout is an Exam arrangement, not canonical Question
   * Content: the same Question may be laid out differently in another Exam. */
  columns?: Record<string, import('./exam').ColumnSetting>
  /** Room for a student's work below a Short Answer question, keyed by
   *  Question Bank record id. Exam presentation like `columns`, so it is set
   *  on the exam sheet and never in the question editor. Absent means none. */
  workSpace?: Record<string, import('./exam').WorkSpace>
  /** The Working Copy's answer arrangement, keyed by Question Bank record id.
   *  Absent means authored order, preserving compatibility with drafts stored
   *  before answer shuffling existed. */
  choiceOrder?: Record<string, string[]>
  /** This Exam's rewording of its section headings, and the size they print
   *  at. Exam presentation like `workSpace`; absent means the defaults. */
  sectionHeadings?: import('./section-headings').SectionHeadings
  headingSize?: import('./section-headings').HeadingSize
  textSize?: import('./section-headings').TextSize
  /** This Exam's own test-page header lines; absent means the default. */
  header?: import('./page-header').ExamHeader
}

export function createQuestionBank(): QuestionBank {
  return { questions: [] }
}

export function createWorkingCopy(title: string = DEFAULT_EXAM_TITLE): ExamWorkingCopy {
  return { title, questionIds: [], choiceOrder: {} }
}

export function bankQuestionById(
  bank: QuestionBank,
  questionId: string,
): Question | undefined {
  return bank.questions.find((question) => question.id === questionId)
}

/** Whether the Working Copy currently references this Question Bank record. */
export function isInWorkingCopy(draft: ExamWorkingCopy, questionId: string): boolean {
  return draft.questionIds.includes(questionId)
}

/** Adds a canonical question, or replaces the content of one already banked.
 *  New questions land at the end: the bank's stored order is the order the
 *  questions were authored in. */
export function withQuestionBanked(
  bank: QuestionBank,
  question: Question,
): QuestionBank {
  const known = bank.questions.some((item) => item.id === question.id)
  return {
    questions: known
      ? bank.questions.map((item) => (item.id === question.id ? question : item))
      : [...bank.questions, question],
  }
}

/**
 * Adds one reference to the Working Copy, beside `targetQuestionId` when that
 * question is already on it and at the end otherwise.
 *
 * `placement` says which side of the target the reference lands on. `'before'`
 * exists because it is the only way to name the first position in a Question
 * Section: there is no question there to sit after.
 *
 * A question already referenced is left exactly where it is: a reference occurs
 * at most once, so adding one twice is not a move.
 */
export function withReferenceAdded(
  draft: ExamWorkingCopy,
  questionId: string,
  targetQuestionId?: string | null,
  placement: QuestionPlacement = 'after',
): ExamWorkingCopy {
  if (isInWorkingCopy(draft, questionId)) return draft
  const index = targetQuestionId
    ? draft.questionIds.indexOf(targetQuestionId)
    : -1
  const questionIds = [...draft.questionIds]
  questionIds.splice(
    index < 0 ? questionIds.length : placement === 'before' ? index : index + 1,
    0,
    questionId,
  )
  return { ...draft, questionIds }
}

/** Removes references from the Working Copy. The Question Bank is not this
 *  function's business: Remove excludes, it never deletes. `partIds` are the
 *  Parts of any Multipart question among them — only the bank knows what they are — whose
 *  answer order, columns and work space this Exam set under their own ids. */
export function withReferencesRemoved(
  draft: ExamWorkingCopy,
  questionIds: readonly string[],
  partIds: readonly string[] = [],
): ExamWorkingCopy {
  const removing = new Set(questionIds)
  const remaining = draft.questionIds.filter((id) => !removing.has(id))
  if (remaining.length === draft.questionIds.length) return draft

  // A removed question no longer has an arrangement on this Working Copy. This
  // also means adding it again starts from its canonical authored answer order.
  const choiceOrder = draft.choiceOrder
    ? { ...draft.choiceOrder }
    : undefined
  const columns = draft.columns
    ? { ...draft.columns }
    : undefined
  const workSpace = draft.workSpace
    ? { ...draft.workSpace }
    : undefined
  for (const id of [...removing, ...partIds]) {
    delete choiceOrder?.[id]
    delete columns?.[id]
    delete workSpace?.[id]
  }
  return {
    ...draft,
    questionIds: remaining,
    ...(choiceOrder ? { choiceOrder } : {}),
    ...(columns ? { columns } : {}),
    ...(workSpace ? { workSpace } : {}),
  }
}

/** The Working Copy's references reordered wholesale — how a move records its
 *  result. Ids the draft does not reference are ignored, and references the
 *  new order forgets keep their place at the end, so a reorder can never
 *  silently Remove a question. */
export function withReferenceOrder(
  draft: ExamWorkingCopy,
  questionIds: readonly string[],
): ExamWorkingCopy {
  const referenced = new Set(draft.questionIds)
  const ordered: string[] = []
  for (const id of questionIds) {
    if (referenced.delete(id)) ordered.push(id)
  }
  for (const id of draft.questionIds) {
    if (referenced.delete(id)) ordered.push(id)
  }
  if (ordered.every((id, index) => id === draft.questionIds[index])) return draft
  return { ...draft, questionIds: ordered }
}

/** Records a new answer arrangement without changing canonical Question
 * Content. A missing order and an explicit empty order mean the same thing. */
export function withChoiceOrder(
  draft: ExamWorkingCopy,
  choiceOrder: Record<string, string[]>,
): ExamWorkingCopy {
  const current = draft.choiceOrder ?? {}
  const currentEntries = Object.entries(current)
  const nextEntries = Object.entries(choiceOrder)
  if (
    currentEntries.length === nextEntries.length
    && nextEntries.every(([questionId, choices]) =>
      current[questionId]?.length === choices.length
      && current[questionId].every((choiceId, index) => choiceId === choices[index]),
    )
  ) return draft
  return { ...draft, choiceOrder }
}

/** What a Replace of one Multipart question by another knows about their Parts: every
 *  Part id of the outgoing question, and which outgoing Part each incoming Part
 *  stands in for. */
export type ReplacedParts = {
  outgoing: readonly string[]
  pairs: readonly (readonly [outgoingPartId: string, incomingPartId: string])[]
}

/**
 * One reference Replaced by another, in place.
 *
 * The incoming question takes the outgoing one's exact position, so a Replace
 * is a change of content at a position rather than a Remove and an add. The
 * outgoing question keeps its Question Bank record: replacement is not
 * deletion, and the question it replaced is available again immediately.
 *
 * Refused — the Working Copy comes back unchanged — when the outgoing question is
 * not referenced or the incoming one already is. Whether the two are of the
 * same Question Type is the store's business: a Working Copy holds ids, and only
 * the Question Bank knows what is behind them.
 */
export function withReferenceReplaced(
  draft: ExamWorkingCopy,
  outgoingQuestionId: string,
  incomingQuestionId: string,
  parts: ReplacedParts = { outgoing: [], pairs: [] },
): ExamWorkingCopy {
  const index = draft.questionIds.indexOf(outgoingQuestionId)
  if (index < 0 || isInWorkingCopy(draft, incomingQuestionId)) return draft
  const questionIds = [...draft.questionIds]
  questionIds[index] = incomingQuestionId
  // Replace begins with the incoming question's authored arrangement. Neither
  // an outgoing arrangement nor stale persisted state may follow it here.
  const choiceOrder = draft.choiceOrder
    ? { ...draft.choiceOrder }
    : undefined
  delete choiceOrder?.[outgoingQuestionId]
  delete choiceOrder?.[incomingQuestionId]
  // The position's layout belongs to this Exam arrangement, so Replace carries
  // it to the incoming Question while its authored answer order starts fresh.
  const columns = draft.columns ? { ...draft.columns } : undefined
  const outgoingColumns = columns?.[outgoingQuestionId]
  delete columns?.[outgoingQuestionId]
  delete columns?.[incomingQuestionId]
  if (outgoingColumns !== undefined) columns![incomingQuestionId] = outgoingColumns
  // So does the room left for work: the page keeps its shape when one Short
  // Answer question stands in for another.
  const workSpace = draft.workSpace ? { ...draft.workSpace } : undefined
  const outgoingWorkSpace = workSpace?.[outgoingQuestionId]
  delete workSpace?.[outgoingQuestionId]
  delete workSpace?.[incomingQuestionId]
  if (outgoingWorkSpace !== undefined) workSpace![incomingQuestionId] = outgoingWorkSpace
  // A Multipart question's Parts keep the page's shape position by position: each
  // incoming Part takes the columns and work space of the outgoing Part in the
  // same place, where the two are the same kind. Answer order starts fresh, as
  // it does for the question.
  const carried = new Map(parts.pairs)
  for (const outgoingPartId of parts.outgoing) {
    const incomingPartId = carried.get(outgoingPartId)
    const partColumns = columns?.[outgoingPartId]
    const partWorkSpace = workSpace?.[outgoingPartId]
    delete choiceOrder?.[outgoingPartId]
    delete columns?.[outgoingPartId]
    delete workSpace?.[outgoingPartId]
    if (incomingPartId === undefined) continue
    if (partColumns !== undefined) columns![incomingPartId] = partColumns
    if (partWorkSpace !== undefined) workSpace![incomingPartId] = partWorkSpace
  }
  return {
    ...draft,
    questionIds,
    ...(choiceOrder ? { choiceOrder } : {}),
    ...(columns ? { columns } : {}),
    ...(workSpace ? { workSpace } : {}),
  }
}
