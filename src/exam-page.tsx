// The exam page: what the teacher looks at, and what the printer prints.
//
// Everything on it comes from `renderExam`, so this file only decides what the
// model's pages look like — never what is on them, in what order, or under
// which number. Nothing here is typeable: a double-click opens the question
// dialog instead, and every editing control lives in chrome that print hides.

import { useRef } from 'react'
import { DocView } from './doc-view'
import {
  renderExam,
  unmeasured,
  type ChoiceGrid,
  type Page,
  type PageItem,
  type RenderedQuestion,
} from './exam-render'
import type { Exam, QuestionType, Version } from './exam'
import type { ProseMirrorJSON } from './question-doc'
import type { Selection } from './use-selection'

// How long a click waits before it commits to being a single click rather
// than the first half of a double-click. Long enough for a real dblclick,
// short enough that a single click still feels immediate.
const CLICK_COMMIT_DELAY_MS = 220

/** Every question id across every page, in on-page (number) order. */
function orderedQuestionIds(pages: readonly Page[]): string[] {
  return pages.flatMap((page) =>
    page.items.flatMap((item) => (item.kind === 'question' ? [item.question.id] : [])),
  )
}

/** Question ids grouped by section, in on-page order — what "Select all" within a section acts on. */
function questionIdsBySection(pages: readonly Page[]): Record<QuestionType, string[]> {
  const bySection: Record<QuestionType, string[]> = { 'multiple-choice': [], open: [] }
  for (const page of pages) {
    for (const item of page.items) {
      if (item.kind === 'question') bySection[item.question.type].push(item.question.id)
    }
  }
  return bySection
}

/** The blocks inside a node — a choice's own paragraphs, say. */
function blocksOf(node: ProseMirrorJSON): ProseMirrorJSON[] {
  return Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []
}

// The gutter a question reveals on hover: a selection checkbox, then
// Duplicate and Delete. #11 adds a segmented Auto | 1 | 2 | 4 column control
// after them, so this stays a row of slots rather than a fixed pair of
// buttons.
//
// Every click in here is stopped from bubbling to the question's own click
// handler, so using the gutter never also selects, deselects, or extends a
// range via the question underneath it.
function QuestionGutter({
  question,
  selected,
  onToggleSelect,
  onDuplicate,
  onDelete,
}: {
  question: RenderedQuestion
  selected: boolean
  onToggleSelect: (questionId: string) => void
  onDuplicate: (questionId: string) => void
  onDelete: (questionId: string) => void
}) {
  return (
    <aside
      className="question-gutter"
      aria-label={`Question ${question.number} controls`}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <label className="gutter-select">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(question.id)}
          aria-label={`Select question ${question.number}`}
        />
      </label>
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
  selected,
  orderedIds,
  selection,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  question: RenderedQuestion
  selected: boolean
  orderedIds: readonly string[]
  selection: Selection
  onEdit: (questionId: string) => void
  onDuplicate: (questionId: string) => void
  onDelete: (questionId: string) => void
}) {
  // A click is deferred rather than applied immediately, so that when it
  // turns out to be the first half of a double-click, the deferred selection
  // never lands — a double-click opens the editor without leaving a stray
  // selection behind.
  const pendingClick = useRef<ReturnType<typeof setTimeout> | null>(null)

  return (
    <section
      className={selected ? 'exam-question exam-question--selected' : 'exam-question'}
      data-question-id={question.id}
      onClick={(event) => {
        const modifiers = {
          shiftKey: event.shiftKey,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
        }
        pendingClick.current = setTimeout(() => {
          pendingClick.current = null
          selection.selectOne(question.id, orderedIds, modifiers)
        }, CLICK_COMMIT_DELAY_MS)
      }}
      onDoubleClick={() => {
        if (pendingClick.current) {
          clearTimeout(pendingClick.current)
          pendingClick.current = null
        }
        onEdit(question.id)
      }}
    >
      <QuestionGutter
        question={question}
        selected={selected}
        onToggleSelect={selection.toggle}
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
  orderedIds,
  idsBySection,
  selection,
  onEdit,
  onDuplicate,
  onDelete,
  onAdd,
}: {
  item: PageItem
  orderedIds: readonly string[]
  idsBySection: Record<QuestionType, string[]>
  selection: Selection
  onEdit: (questionId: string) => void
  onDuplicate: (questionId: string) => void
  onDelete: (questionId: string) => void
  onAdd: (section: QuestionType) => void
}) {
  switch (item.kind) {
    case 'section-heading':
      return (
        <header className="exam-section">
          <div className="exam-section-titlebar">
            <h2 className="section-title">{item.title}</h2>
            <button
              type="button"
              className="section-select-all"
              onClick={() => selection.selectAll(idsBySection[item.section])}
            >
              Select all
            </button>
          </div>
          <p className="section-instructions">{item.instructions}</p>
        </header>
      )
    case 'question':
      return (
        <QuestionView
          question={item.question}
          selected={selection.isSelected(item.question.id)}
          orderedIds={orderedIds}
          selection={selection}
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

// Clears the selection when the click landed on the background element
// itself — the page or the workspace — rather than bubbling up from a
// question or a control inside one.
function clearOnBackgroundClick(selection: Selection) {
  return (event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
    if (event.target === event.currentTarget) selection.clear()
  }
}

export function ExamPage({
  exam,
  version,
  selection,
  onEdit,
  onDuplicate,
  onDelete,
  onAdd,
}: {
  exam: Exam
  version: Version
  selection: Selection
  onEdit: (questionId: string) => void
  onDuplicate: (questionId: string) => void
  onDelete: (questionId: string) => void
  onAdd: (section: QuestionType) => void
}) {
  // Measurement is stubbed until pagination needs it: every question lands on
  // one unbounded page.
  const pages = renderExam(exam, version, unmeasured)
  const orderedIds = orderedQuestionIds(pages)
  const idsBySection = questionIdsBySection(pages)
  const clearOnBackground = clearOnBackgroundClick(selection)

  return (
    <main className="exam-workspace" onClick={clearOnBackground}>
      {pages.map((page) => (
        <article className="exam-page" key={page.number} onClick={clearOnBackground}>
          {page.header === 'first' && <h1 className="exam-title">{exam.title}</h1>}
          {page.items.map((item) => (
            <PageItemView
              key={keyOf(item)}
              item={item}
              orderedIds={orderedIds}
              idsBySection={idsBySection}
              selection={selection}
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
