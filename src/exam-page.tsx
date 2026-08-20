// The exam page: what the teacher looks at, and what the printer prints.
//
// Everything on it comes from `renderExam`, so this file only decides what the
// model's pages look like — never what is on them, in what order, or under
// which number. Nothing here is typeable: a double-click opens the question
// dialog instead, and every editing control lives in chrome that print hides.

import { DocView } from './doc-view'
import {
  renderExam,
  unmeasured,
  type ChoiceGrid,
  type PageItem,
  type RenderedQuestion,
} from './exam-render'
import type { Exam, QuestionType, Version } from './exam'
import type { ProseMirrorJSON } from './question-doc'

/** The blocks inside a node — a choice's own paragraphs, say. */
function blocksOf(node: ProseMirrorJSON): ProseMirrorJSON[] {
  return Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []
}

// The gutter a question reveals on hover. Duplicate and Delete today; ticket
// #10 adds a selection checkbox ahead of them and #11 a segmented
// Auto | 1 | 2 | 4 column control after them, so this stays a row of slots
// rather than a pair of buttons.
function QuestionGutter({
  question,
  onDuplicate,
  onDelete,
}: {
  question: RenderedQuestion
  onDuplicate: (questionId: string) => void
  onDelete: (questionId: string) => void
}) {
  return (
    <aside
      className="question-gutter"
      aria-label={`Question ${question.number} controls`}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="gutter-actions">
        <button
          type="button"
          className="gutter-button"
          onClick={() => onDuplicate(question.id)}
        >
          Duplicate
        </button>
        <button
          type="button"
          className="gutter-button"
          onClick={() => onDelete(question.id)}
        >
          Delete
        </button>
      </div>
    </aside>
  )
}

// The grid is drawn as a real table so that a cell's answer stays inside its
// column, and every border is off: on paper this is a layout, not a table.
function ChoiceGridView({ grid }: { grid: ChoiceGrid }) {
  return (
    <table className="choice-grid" data-columns={grid.columns}>
      <tbody>
        {grid.cells.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((choice, columnIndex) => (
              <td key={columnIndex} className="choice-cell">
                {choice && (
                  <>
                    <span className="choice-letter">{choice.letter}.</span>
                    <DocView
                      className="choice-body"
                      content={blocksOf(choice.node)}
                    />
                  </>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function QuestionView({
  question,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  question: RenderedQuestion
  onEdit: (questionId: string) => void
  onDuplicate: (questionId: string) => void
  onDelete: (questionId: string) => void
}) {
  return (
    <section
      className="exam-question"
      data-question-id={question.id}
      onDoubleClick={() => onEdit(question.id)}
    >
      <QuestionGutter
        question={question}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />
      <div className="question-number">
        {question.answerBlank && (
          <span className="answer-blank" aria-label="Answer blank" />
        )}
        <span className="question-count">{question.number}.</span>
      </div>
      <div className="question-body">
        <DocView className="question-stem" content={question.stem} />
        {question.grid && <ChoiceGridView grid={question.grid} />}
      </div>
    </section>
  )
}

function PageItemView({
  item,
  onEdit,
  onDuplicate,
  onDelete,
  onAdd,
}: {
  item: PageItem
  onEdit: (questionId: string) => void
  onDuplicate: (questionId: string) => void
  onDelete: (questionId: string) => void
  onAdd: (section: QuestionType) => void
}) {
  switch (item.kind) {
    case 'section-heading':
      return (
        <header className="exam-section">
          <h2 className="section-title">{item.title}</h2>
          <p className="section-instructions">{item.instructions}</p>
        </header>
      )
    case 'question':
      return (
        <QuestionView
          question={item.question}
          onEdit={onEdit}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      )
    case 'add-question':
      return (
        <button
          type="button"
          className="add-question"
          onClick={() => onAdd(item.section)}
        >
          + Add {item.section === 'multiple-choice' ? 'multiple choice' : 'short answer'}{' '}
          question
        </button>
      )
  }
}

function keyOf(item: PageItem): string {
  switch (item.kind) {
    case 'section-heading':
      return `heading-${item.section}`
    case 'question':
      return `question-${item.question.id}`
    case 'add-question':
      return `add-${item.section}`
  }
}

export function ExamPage({
  exam,
  version,
  onEdit,
  onDuplicate,
  onDelete,
  onAdd,
}: {
  exam: Exam
  version: Version
  onEdit: (questionId: string) => void
  onDuplicate: (questionId: string) => void
  onDelete: (questionId: string) => void
  onAdd: (section: QuestionType) => void
}) {
  // Measurement is stubbed until pagination needs it: every question lands on
  // one unbounded page.
  const pages = renderExam(exam, version, unmeasured)

  return (
    <main className="exam-workspace">
      {pages.map((page) => (
        <article className="exam-page" key={page.number}>
          {page.header === 'first' && <h1 className="exam-title">{exam.title}</h1>}
          {page.items.map((item) => (
            <PageItemView
              key={keyOf(item)}
              item={item}
              onEdit={onEdit}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
              onAdd={onAdd}
            />
          ))}
        </article>
      ))}
    </main>
  )
}
