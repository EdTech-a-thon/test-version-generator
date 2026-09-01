// The Question Bank, beside the Exam Draft.
//
// This is the basic pane the split authoring workspace opens with: the canonical
// questions a teacher has written, newest first, and the two things that can be
// done to one of them from here — open it in the question popup, or add it to
// the Exam Draft. Nothing on this pane can Delete Question Content: a question
// already on the exam offers no add action at all, which is what stops a
// reference being added twice.
//
// Browsing the bank properly — stem previews with Image and Math badges, search,
// Difficulty and Topic filters and metadata — is the next slice of work. What is
// here is deliberately the least that makes the bank usable, and every action it
// offers goes through the store's authoring boundary rather than reaching into
// the model itself.

import { ListPlus, Pencil, Plus } from 'lucide-react'
import { stemNodesOf, type ProseMirrorJSON } from './question-doc'
import type { Question, QuestionType } from './exam'
import type { QuestionBank } from './question-bank'

const TYPE_LABELS: Record<QuestionType, string> = {
  'multiple-choice': 'Multiple choice',
  open: 'Short answer',
}

/** Every string in a document node, in reading order. */
function textOf(node: ProseMirrorJSON): string {
  if (typeof node.text === 'string') return node.text
  const content = Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []
  return content.map(textOf).join(' ')
}

/** Enough of the question's stem to tell one bank row from another, and no
 *  more: answer choices are deliberately not part of it. This is a row label,
 *  not the compact stem projection the bank will eventually show — that has
 *  Image and Math badges and rules of its own, and belongs with the browsing
 *  work rather than here. */
function stemPreview(question: Question): string {
  return stemNodesOf(question.doc)
    .map(textOf)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function QuestionBankPane({
  bank,
  examDraftIds,
  onCreate,
  onEdit,
  onAddToExamDraft,
}: {
  bank: QuestionBank
  /** Which bank records the Exam Draft currently references. */
  examDraftIds: ReadonlySet<string>
  onCreate: () => void
  onEdit: (questionId: string) => void
  onAddToExamDraft: (questionId: string) => void
}) {
  // Newest first: the question just written is the one being worked with.
  const questions = [...bank.questions].reverse()

  return (
    <section className="question-bank" aria-label="Question Bank">
      <header className="question-bank-header">
        <h2>Question Bank</h2>
        <button
          type="button"
          className="secondary-button"
          onClick={onCreate}
        >
          <Plus />
          New question
        </button>
      </header>

      {questions.length === 0 ? (
        <p className="question-bank-empty">
          No questions yet. New question writes one into the bank without
          putting it on the exam.
        </p>
      ) : (
        <ul className="question-bank-list">
          {questions.map((question) => {
            const inExamDraft = examDraftIds.has(question.id)
            const preview = stemPreview(question)
            const name = preview || 'Untitled question'
            return (
              <li
                className="question-bank-row"
                key={question.id}
                data-question-id={question.id}
                data-in-exam={inExamDraft ? 'true' : undefined}
              >
                <div className="question-bank-row-content">
                  <span className="question-bank-row-type">
                    {TYPE_LABELS[question.type]}
                    {inExamDraft && (
                      <span className="question-bank-row-badge">In exam</span>
                    )}
                  </span>
                  <span className="question-bank-row-stem">{name}</span>
                </div>
                <div className="question-bank-row-actions">
                  <button
                    type="button"
                    className="question-bank-action"
                    aria-label={`Edit ${name}`}
                    title="Edit"
                    onClick={() => onEdit(question.id)}
                  >
                    <Pencil />
                  </button>
                  {/* A question already on the Exam Draft offers no add action:
                      a reference occurs at most once, and saying so before the
                      click is clearer than refusing it afterwards. */}
                  {!inExamDraft && (
                    <button
                      type="button"
                      className="question-bank-action"
                      aria-label={`Add ${name} to the exam`}
                      title="Add to the exam"
                      onClick={() => onAddToExamDraft(question.id)}
                    >
                      <ListPlus />
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
