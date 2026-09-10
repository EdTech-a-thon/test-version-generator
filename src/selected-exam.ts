// The compatibility boundary between Question Bank authoring and the export
// pipeline.
//
// Rendering, pagination and export all speak the older vocabulary: an `Exam`
// holding questions, plus a `Arrangement` holding an ordering. Authoring speaks the
// newer one: a Question Bank of canonical content, and a Working Copy of ordered
// references into it. This module is the whole of the translation, and it is
// deliberately narrow and disposable — when export-only immutable Arrangements
// arrive (ADR-0003), this is the piece that goes, not the model behind it.
//
// The split between the two halves is what keeps repagination cheap. The
// derived `Exam` carries the *content*: the referenced questions in Question
// Bank order, so its identity survives a pure reordering. The derived `Arrangement`
// carries the *arrangement*: the Working Copy's question and recorded answer
// orders. An absent answer order means answers print in the authored order.
// Nothing downstream can tell the difference between this and an edited
// Arrangement, and nothing here writes anything back.

import { columnsOf, type Exam, type Arrangement } from './exam'
import { bankQuestionById, type ExamWorkingCopy, type QuestionBank } from './question-bank'

/** The `Exam` plus ordering that one Working Copy currently amounts to. */
export type SelectedExam = {
  exam: Exam
  arrangement: Arrangement
}

/** The Arrangement identity the Working Copy presents itself under. A Working Copy is
 *  not a Arrangement, so this is a fixed label rather than a stored one: export
 *  relabels every published Arrangement from A anyway. */
export const EXAM_DRAFT_VERSION_ID = 'exam-draft'
export const EXAM_DRAFT_VERSION_LETTER = 'A'

/**
 * The Working Copy as rendering and export see it: the referenced Question Bank
 * records and nothing else, arranged in Working Copy order.
 *
 * `previous` is an optimisation, not a cache with a lifetime: when the derived
 * content or the derived ordering is unchanged, the object from last time is
 * returned rather than an equal copy, so a consumer that re-measures whenever
 * the exam changes is not made to re-measure by a reorder — or by a render.
 */
export function selectedExam(
  bank: QuestionBank,
  draft: ExamWorkingCopy,
  previous?: SelectedExam | null,
): SelectedExam {
  const referenced = new Set(draft.questionIds)
  const bankedQuestions = bank.questions.filter((question) => referenced.has(question.id))
  // Column layout belongs to this Exam Working Copy. Preserve a canonical
  // Question's authored/default layout only until this Exam specifies one.
  const columns = draft.columns ?? {}
  const questions = bankedQuestions.map((question) =>
    columns[question.id] === undefined || columns[question.id] === columnsOf(question)
      ? question
      : { ...question, columns: columns[question.id]! },
  )
  const exam: Exam =
    previous
    && previous.exam.title === draft.title
    && previous.exam.questions.length === questions.length
    && previous.exam.questions.every((question, index) => question === questions[index])
      ? previous.exam
      : { title: draft.title, questions }

  // Only ids the bank can resolve: an ordering may tolerate a stranger, but an
  // Working Copy referencing content that is not there is not something export
  // should have to reason about.
  const questionOrder = draft.questionIds.filter((id) => bankQuestionById(bank, id))
  const choiceOrder = draft.choiceOrder ?? {}
  const sameChoiceOrder = (left: Record<string, string[]>, right: Record<string, string[]>) => {
    const entries = Object.entries(left)
    return entries.length === Object.keys(right).length
      && entries.every(([questionId, choices]) =>
        right[questionId]?.length === choices.length
        && right[questionId].every((choiceId, index) => choiceId === choices[index]),
      )
  }
  const arrangement: Arrangement =
    previous
    && previous.arrangement.questionOrder.length === questionOrder.length
    && previous.arrangement.questionOrder.every((id, index) => id === questionOrder[index])
    && sameChoiceOrder(previous.arrangement.choiceOrder, choiceOrder)
      ? previous.arrangement
      : {
          id: EXAM_DRAFT_VERSION_ID,
          letter: EXAM_DRAFT_VERSION_LETTER,
          questionOrder,
          // With no recorded order answers print as authored. Selection-scoped
          // answer shuffling records only this presentation state, never
          // changes the canonical Question Content in the Question Bank.
          choiceOrder,
        }

  return previous && exam === previous.exam && arrangement === previous.arrangement
    ? previous
    : { exam, arrangement }
}
