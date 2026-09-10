import { choiceIdOf, choiceNodesOf } from './question-doc'
import type { Question } from './exam'
import type { AuthoringState, SavedState } from './exam-store'
import type { ExamWorkingCopy, QuestionBank } from './question-bank'

function choiceIds(question: Question | undefined): string[] {
  if (!question || question.type !== 'multiple-choice') return []
  return choiceNodesOf(question.doc).map(choiceIdOf)
}

export function sameStableChoiceIds(left: Question | undefined, right: Question): boolean {
  const before = choiceIds(left)
  const after = choiceIds(right)
  return before.length === after.length && before.every((id) => after.includes(id))
}

function withQuestion(bank: QuestionBank, question: Question): QuestionBank {
  if (!bank.questions.some((candidate) => candidate.id === question.id)) return bank
  return {
    questions: bank.questions.map((candidate) => candidate.id === question.id ? question : candidate),
  }
}

function withoutChoiceArrangement(draft: ExamWorkingCopy, questionId: string): ExamWorkingCopy {
  if (!draft.choiceOrder?.[questionId]) return draft
  const choiceOrder = { ...draft.choiceOrder }
  delete choiceOrder[questionId]
  return { ...draft, choiceOrder }
}

/** Apply one already-durable canonical edit to one Exam projection. This is not
 * an Exam command: dirty state and all unrelated Working Copy presentation are
 * retained exactly, and a changed choice identity set merely drops the now
 * incompatible answer arrangement. */
export function withCanonicalQuestionProjection(
  working: AuthoringState,
  saved: SavedState | null,
  question: Question,
): { working: AuthoringState; saved: SavedState | null } {
  const prior = working.questionBank.questions.find((candidate) => candidate.id === question.id)
    ?? saved?.questionBank.questions.find((candidate) => candidate.id === question.id)
  const stableChoices = sameStableChoiceIds(prior, question)
  const nextWorkingBank = withQuestion(working.questionBank, question)
  const nextSavedBank = saved ? withQuestion(saved.questionBank, question) : null
  return {
    working: {
      ...working,
      questionBank: nextWorkingBank,
      workingCopy: stableChoices ? working.workingCopy : withoutChoiceArrangement(working.workingCopy, question.id),
    },
    saved: saved ? {
      ...saved,
      questionBank: nextSavedBank!,
      workingCopy: stableChoices ? saved.workingCopy : withoutChoiceArrangement(saved.workingCopy, question.id),
    } : null,
  }
}
