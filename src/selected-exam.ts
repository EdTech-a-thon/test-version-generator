// The compatibility boundary between Question Bank authoring and the export
// pipeline.
//
// Rendering, pagination and export all speak the older vocabulary: an `Exam`
// holding questions, plus a `Version` holding an ordering. Authoring speaks the
// newer one: a Question Bank of canonical content, and an Exam Draft of ordered
// references into it. This module is the whole of the translation, and it is
// deliberately narrow and disposable — when export-only immutable Versions
// arrive (ADR-0003), this is the piece that goes, not the model behind it.
//
// The split between the two halves is what keeps repagination cheap. The
// derived `Exam` carries the *content*: the referenced questions in Question
// Bank order, so its identity survives a pure reordering. The derived `Version`
// carries the *arrangement*: the Exam Draft's order, and no recorded choice
// order at all, so answers print in the order they were authored in. Nothing
// downstream can tell the difference between this and an edited Version, and
// nothing here writes anything back.

import { type Exam, type Version } from './exam'
import { bankQuestionById, type ExamDraft, type QuestionBank } from './question-bank'

/** The `Exam` plus ordering that one Exam Draft currently amounts to. */
export type SelectedExam = {
  exam: Exam
  version: Version
}

/** The Version identity the Exam Draft presents itself under. An Exam Draft is
 *  not a Version, so this is a fixed label rather than a stored one: export
 *  relabels every published Version from A anyway. */
export const EXAM_DRAFT_VERSION_ID = 'exam-draft'
export const EXAM_DRAFT_VERSION_LETTER = 'A'

/**
 * The Exam Draft as rendering and export see it: the referenced Question Bank
 * records and nothing else, arranged in Exam Draft order.
 *
 * `previous` is an optimisation, not a cache with a lifetime: when the derived
 * content or the derived ordering is unchanged, the object from last time is
 * returned rather than an equal copy, so a consumer that re-measures whenever
 * the exam changes is not made to re-measure by a reorder — or by a render.
 */
export function selectedExam(
  bank: QuestionBank,
  draft: ExamDraft,
  previous?: SelectedExam | null,
): SelectedExam {
  const referenced = new Set(draft.questionIds)
  const questions = bank.questions.filter((question) => referenced.has(question.id))
  const exam: Exam =
    previous
    && previous.exam.title === draft.title
    && previous.exam.questions.length === questions.length
    && previous.exam.questions.every((question, index) => question === questions[index])
      ? previous.exam
      : { title: draft.title, questions }

  // Only ids the bank can resolve: an ordering may tolerate a stranger, but an
  // Exam Draft referencing content that is not there is not something export
  // should have to reason about.
  const questionOrder = draft.questionIds.filter((id) => bankQuestionById(bank, id))
  const version: Version =
    previous
    && previous.version.questionOrder.length === questionOrder.length
    && previous.version.questionOrder.every((id, index) => id === questionOrder[index])
      ? previous.version
      : {
          id: EXAM_DRAFT_VERSION_ID,
          letter: EXAM_DRAFT_VERSION_LETTER,
          questionOrder,
          // Empty by design: with no recorded choice order every question's
          // answers print in the order they were authored in, which is exactly
          // what an Exam Draft means. Export Randomization permutes from here.
          choiceOrder: {},
        }

  return previous && exam === previous.exam && version === previous.version
    ? previous
    : { exam, version }
}
