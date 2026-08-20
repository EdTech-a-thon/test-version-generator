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
  type ChoiceGrid,
  type Page,
  type PageItem,
  type RenderedQuestion,
} from './exam-render'
import type { ColumnSetting, Exam, QuestionType, Version } from './exam'
import type { ProseMirrorJSON } from './question-doc'
import type { Selection } from './use-selection'
import { domMeasure } from './dom-measure'

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

/** Every question's raw column setting, keyed by id — what the gutter's and
 * toolbar's segmented controls highlight, as opposed to `RenderedQuestion`'s
 * already-resolved `grid.columns`. */
function columnSettingsOf(exam: Exam): Record<string, ColumnSetting> {
  const byId: Record<string, ColumnSetting> = {}
  for (const question of exam.questions) byId[question.id] = question.columns
  return byId
}

const COLUMN_OPTIONS: readonly { label: string; value: ColumnSetting }[] = [
  { label: 'Auto', value: 'auto' },
  { label: '1', value: 1 },
  { label: '2', value: 2 },
  { label: '4', value: 4 },
]

// The segmented Auto | 1 | 2 | 4 control, shared by the question gutter and
// the toolbar (#11): both read a `ColumnSetting` and call back with one.
// `value` is `undefined` when the toolbar's selection has no single common
// setting to highlight — every option then renders unpressed rather than one
// being picked arbitrarily.
export function ColumnControl({
  value,
  onChange,
  ariaLabel,
  disabled = false,
  className,
}: {
  value: ColumnSetting | undefined
  onChange: (columns: ColumnSetting) => void
  ariaLabel: string
  disabled?: boolean
  className?: string
}) {
  return (
    <div
      className={className ? `column-control ${className}` : 'column-control'}
      role="group"
      aria-label={ariaLabel}
    >
      {COLUMN_OPTIONS.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className="column-option"
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

// The gutter a question reveals on hover: a selection checkbox, Duplicate and
// Delete, then #11's segmented Auto | 1 | 2 | 4 column control.
//
// Every click in here is stopped from bubbling to the question's own click
// handler, so using the gutter never also selects, deselects, or extends a
// range via the question underneath it.
function QuestionGutter({
  question,
  selected,
  columns,
  onToggleSelect,
  onDuplicate,
  onDelete,
  onSetColumns,
}: {
  question: RenderedQuestion
  selected: boolean
  columns: ColumnSetting
  onToggleSelect: (questionId: string) => void
  onDuplicate: (questionId: string) => void
  onDelete: (questionId: string) => void
  onSetColumns: (questionId: string, columns: ColumnSetting) => void
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
      <div className="gutter-columns">
        <ColumnControl
          value={columns}
          onChange={(next) => onSetColumns(question.id, next)}
          ariaLabel={`Answer columns for question ${question.number}`}
        />
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
  columns,
  orderedIds,
  selection,
  onEdit,
  onDuplicate,
  onDelete,
  onSetColumns,
}: {
  question: RenderedQuestion
  selected: boolean
  columns: ColumnSetting
  orderedIds: readonly string[]
  selection: Selection
  onEdit: (questionId: string) => void
  onDuplicate: (questionId: string) => void
  onDelete: (questionId: string) => void
  onSetColumns: (questionId: string, columns: ColumnSetting) => void
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
        columns={columns}
        onToggleSelect={selection.toggle}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        onSetColumns={onSetColumns}
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
  columnSettings,
  selection,
  onEdit,
  onDuplicate,
  onDelete,
  onAdd,
  onSetColumns,
}: {
  item: PageItem
  orderedIds: readonly string[]
  idsBySection: Record<QuestionType, string[]>
  columnSettings: Record<string, ColumnSetting>
  selection: Selection
  onEdit: (questionId: string) => void
  onDuplicate: (questionId: string) => void
  onDelete: (questionId: string) => void
  onAdd: (section: QuestionType) => void
  onSetColumns: (questionId: string, columns: ColumnSetting) => void
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
          columns={columnSettings[item.question.id] ?? 'auto'}
          orderedIds={orderedIds}
          selection={selection}
          onEdit={onEdit}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onSetColumns={onSetColumns}
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
  onSetColumns,
}: {
  exam: Exam
  version: Version
  selection: Selection
  onEdit: (questionId: string) => void
  onDuplicate: (questionId: string) => void
  onDelete: (questionId: string) => void
  onAdd: (section: QuestionType) => void
  onSetColumns: (questionId: string, columns: ColumnSetting) => void
}) {
  // `domMeasure` is real for `choiceWidth` (#11); `itemHeight` is still a
  // stub returning 0, so every question lands on one unbounded page until #7
  // gives it a real one — see `src/dom-measure.ts`.
  const pages = renderExam(exam, version, domMeasure)
  const orderedIds = orderedQuestionIds(pages)
  const idsBySection = questionIdsBySection(pages)
  const columnSettings = columnSettingsOf(exam)
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
              columnSettings={columnSettings}
              selection={selection}
              onEdit={onEdit}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
              onAdd={onAdd}
              onSetColumns={onSetColumns}
            />
          ))}
        </article>
      ))}
    </main>
  )
}
