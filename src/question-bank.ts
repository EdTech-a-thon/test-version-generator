// The Question Bank and the Exam Draft.
//
// The Question Bank holds every canonical question exactly once. The Exam Draft
// holds an ordered list of *references* into it — never copies — so editing
// Question Content changes it everywhere it is referenced, and Removing a
// question from the Exam Draft leaves its Question Bank record untouched.
//
// A question id appears at most once in an Exam Draft: an Exam Draft is a
// selection, not a bag. Everything here is pure and total; the store in
// `exam-store.ts` is what makes these operations atomic, undoable and durable,
// and `selected-exam.ts` is what turns the pair into the `Exam` that rendering
// and export consume.

import { DEFAULT_EXAM_TITLE, type Question } from './exam'

/** Canonical Question Content, stored once per question. */
export type QuestionBank = {
  questions: Question[]
}

/** The mutable selection a teacher is preparing for export: the exam's name and
 *  the ordered Question Bank references on it. Not a Version. */
export type ExamDraft = {
  title: string
  questionIds: string[]
}

export function createQuestionBank(): QuestionBank {
  return { questions: [] }
}

export function createExamDraft(title: string = DEFAULT_EXAM_TITLE): ExamDraft {
  return { title, questionIds: [] }
}

export function bankQuestionById(
  bank: QuestionBank,
  questionId: string,
): Question | undefined {
  return bank.questions.find((question) => question.id === questionId)
}

/** Whether the Exam Draft currently references this Question Bank record. */
export function isInExamDraft(draft: ExamDraft, questionId: string): boolean {
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
 * Adds one reference to the Exam Draft, after `afterQuestionId` when that
 * question is already on it and at the end otherwise.
 *
 * A question already referenced is left exactly where it is: a reference occurs
 * at most once, so adding one twice is not a move.
 */
export function withReferenceAdded(
  draft: ExamDraft,
  questionId: string,
  afterQuestionId?: string | null,
): ExamDraft {
  if (isInExamDraft(draft, questionId)) return draft
  const index = afterQuestionId
    ? draft.questionIds.indexOf(afterQuestionId)
    : -1
  const questionIds = [...draft.questionIds]
  questionIds.splice(index < 0 ? questionIds.length : index + 1, 0, questionId)
  return { ...draft, questionIds }
}

/** Removes references from the Exam Draft. The Question Bank is not this
 *  function's business: Remove excludes, it never deletes. */
export function withReferencesRemoved(
  draft: ExamDraft,
  questionIds: readonly string[],
): ExamDraft {
  const removing = new Set(questionIds)
  const remaining = draft.questionIds.filter((id) => !removing.has(id))
  if (remaining.length === draft.questionIds.length) return draft
  return { ...draft, questionIds: remaining }
}

/** The Exam Draft's references reordered wholesale — how a move records its
 *  result. Ids the draft does not reference are ignored, and references the
 *  new order forgets keep their place at the end, so a reorder can never
 *  silently Remove a question. */
export function withReferenceOrder(
  draft: ExamDraft,
  questionIds: readonly string[],
): ExamDraft {
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

/**
 * One reference Replaced by another, in place.
 *
 * The incoming question takes the outgoing one's exact position, so a Replace
 * is a change of content at a position rather than a Remove and an add. The
 * outgoing question keeps its Question Bank record: replacement is not
 * deletion, and the question it replaced is available again immediately.
 *
 * Refused — the Exam Draft comes back unchanged — when the outgoing question is
 * not referenced or the incoming one already is. Whether the two are of the
 * same Question Type is the store's business: an Exam Draft holds ids, and only
 * the Question Bank knows what is behind them.
 */
export function withReferenceReplaced(
  draft: ExamDraft,
  outgoingQuestionId: string,
  incomingQuestionId: string,
): ExamDraft {
  const index = draft.questionIds.indexOf(outgoingQuestionId)
  if (index < 0 || isInExamDraft(draft, incomingQuestionId)) return draft
  const questionIds = [...draft.questionIds]
  questionIds[index] = incomingQuestionId
  return { ...draft, questionIds }
}
