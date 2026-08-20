// The exam page: what the teacher looks at, and what the printer prints.
//
// Everything on it comes from `renderExam`, so this file only decides what the
// model's pages look like — never what is on them, in what order, or under
// which number. Nothing here is typeable: a double-click opens the question
// dialog instead, and every editing control lives in chrome that print hides.
//
// A page is a real sheet: fixed at the geometry `exam-render.ts` packed
// against, published to CSS as custom properties so the two cannot drift, with
// the furniture — the identity line, the title, the page number — drawn here
// off `Page.header` and `Page.number` rather than being content that packs.
//
// The one asynchronous thing on this page is measurement, and it is the reason
// `pages` is state rather than a value computed during render: see
// `usePaginatedExam`.

import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import {
  AddQuestionButton,
  AnswerKeyEntry,
  AnswerKeyHeading,
  AnswerKeySection,
  QuestionContent,
  SectionHeadingContent,
} from './page-item-view'
import {
  FOOTER_HEIGHT,
  HEADER_HEIGHT,
  PAGE_HEIGHT,
  PAGE_MARGIN,
  PAGE_WIDTH,
  renderPrintPages,
  unmeasured,
  type PrintContent,
  type Page,
  type PageHeader,
  type PageItem,
  type QuestionItem,
  type RenderedQuestion,
} from './exam-render'
import type { ColumnSetting, Exam, QuestionType, Version } from './exam'
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

// A question on the page, or the piece of one this page carries: the same
// content `dom-measure.ts` measured, wrapped in the chrome that makes it
// selectable, editable and droppable. A continued piece is chrome-free — its
// gutter, and everything that gutter does, belongs to the piece that carries
// the question's number.
function QuestionView({
  item,
  selected,
  columns,
  orderedIds,
  selection,
  onEdit,
  onDuplicate,
  onDelete,
  onSetColumns,
}: {
  item: QuestionItem
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
  const question = item.question

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
      {item.numbered && (
        <QuestionGutter
          question={question}
          selected={selected}
          columns={columns}
          onToggleSelect={selection.toggle}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onSetColumns={onSetColumns}
        />
      )}
      <QuestionContent item={item} />
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
          <SectionHeadingContent
            item={item}
            onSelectAll={() => selection.selectAll(idsBySection[item.section])}
          />
        </header>
      )
    case 'question':
      return (
        <QuestionView
          item={item}
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
      return <AddQuestionButton item={item} onAdd={onAdd} />
    case 'answer-key-heading':
      return <AnswerKeyHeading />
    case 'answer-key-section':
      return <AnswerKeySection item={item} />
    case 'answer-key-entry':
      return <AnswerKeyEntry item={item} />
    default: {
      const unreachable: never = item
      return unreachable
    }
  }
}

function keyOf(item: PageItem): string {
  switch (item.kind) {
    case 'section-heading':
      return `heading-${item.section}`
    case 'question':
      // A split question never has two of its pieces on one page, so its id is
      // still unique within the page that keys by it.
      return `question-${item.question.id}`
    case 'add-question':
      return `add-${item.section}`
    case 'answer-key-heading':
      return 'answer-key-heading'
    case 'answer-key-section':
      return `answer-key-section-${item.section}`
    case 'answer-key-entry':
      return `answer-key-entry-${item.number}`
    default: {
      const unreachable: never = item
      return unreachable
    }
  }
}

// The furniture at the top of a sheet, drawn from the variant packing chose.
// The first page identifies the paper and names the test; every later page
// carries just enough to reunite a dropped stack and to stop a student swapping
// a page in from another version. Neither repeats the section heading — that is
// content, and content is packed, not drawn here.
//
// Exhaustive over `PageHeader`: #8's answer-key variant will not compile until
// its furniture is drawn, and #12 already reads the version's own letter here
// rather than assuming 'A'.
function PageHeaderView({
  header,
  title,
  letter,
}: {
  header: PageHeader
  title: string
  letter: string
}) {
  const id = <span className="page-id">ID: {letter}</span>
  switch (header) {
    case 'first':
      return (
        <header className="page-header page-header--first">
          <div className="page-identity">
            <span className="identity-field">
              Name:
              <span className="identity-blank" />
            </span>
            <span className="identity-field">
              Class:
              <span className="identity-blank" />
            </span>
            <span className="identity-field">
              Date:
              <span className="identity-blank" />
            </span>
            {id}
          </div>
          <h1 className="exam-title">{title}</h1>
        </header>
      )
    case 'later':
      return (
        <header className="page-header page-header--later">
          <div className="page-identity">
            <span className="identity-field">
              Name:
              <span className="identity-blank" />
            </span>
            {id}
          </div>
        </header>
      )
    case 'answer-key':
      return (
        <header className="page-header page-header--answer-key">
          <div className="page-identity">{id}</div>
          <h1 className="exam-title">{title}</h1>
        </header>
      )
    default: {
      const unreachable: never = header
      return unreachable
    }
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

// The geometry `exam-render.ts` packed against, handed to CSS. Screen and paper
// agree only if the sheet is laid out at the size it was packed for, and the
// only way to be sure of that is for both to read the same numbers.
const PAGE_GEOMETRY = {
  '--page-width': `${PAGE_WIDTH}px`,
  '--page-height': `${PAGE_HEIGHT}px`,
  '--page-margin': `${PAGE_MARGIN}px`,
  '--page-header-first': `${HEADER_HEIGHT.first}px`,
  '--page-header-later': `${HEADER_HEIGHT.later}px`,
  '--page-header-answer-key': `${HEADER_HEIGHT['answer-key']}px`,
  '--page-footer': `${FOOTER_HEIGHT}px`,
} as CSSProperties

// How long editing settles before the page is measured and packed again.
// Measurement is the expensive, DOM-touching half of the render and it re-runs
// on every keystroke's worth of change, so it waits for a pause.
const REPAGINATE_DEBOUNCE_MS = 150

// Pagination, kept in state rather than computed while rendering.
//
// `renderExam` is pure, but the `Measure` the app gives it reads real layout,
// which cannot be done from inside a React render. So the first pass runs in a
// layout effect — before the browser paints, so no unpaginated flash is ever
// seen — and every pass after it is debounced.
//
// Two things can invalidate a measurement after the fact: a web font arriving
// (KaTeX loads its own), and an image finishing decoding, since an image whose
// bytes have not arrived measures as nothing. Each gets one re-measurement per
// edit — enough to settle, and bounded, so a measurement can never chase its
// own result round in a loop.
function usePaginatedExam(
  exam: Exam,
  version: Version,
  workspace: RefObject<HTMLElement | null>,
  content: PrintContent,
): Page[] {
  const { test, answerKey } = content
  const [pages, setPages] = useState<Page[]>(() =>
    renderPrintPages(exam, [version], unmeasured, content)[0]!.pages,
  )
  const measured = useRef(false)

  useLayoutEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let live = true
    const repaginate = () => setPages(
      renderPrintPages(exam, [version], domMeasure, { test, answerKey })[0]!.pages,
    )
    const schedule = () => {
      if (!live) return
      clearTimeout(timer)
      timer = setTimeout(repaginate, REPAGINATE_DEBOUNCE_MS)
    }

    if (measured.current) schedule()
    else {
      measured.current = true
      repaginate()
    }

    document.fonts?.ready.then(schedule, () => {})
    let imagesSettled = false
    const onAssetLoad = () => {
      if (imagesSettled) return
      imagesSettled = true
      schedule()
    }
    const element = workspace.current
    element?.addEventListener('load', onAssetLoad, true)

    return () => {
      live = false
      clearTimeout(timer)
      element?.removeEventListener('load', onAssetLoad, true)
    }
  }, [exam, version, workspace, test, answerKey])

  return pages
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
  unsavedDraft = false,
  content = { test: true, answerKey: true },
}: {
  exam: Exam
  version: Version
  selection: Selection
  onEdit: (questionId: string) => void
  onDuplicate: (questionId: string) => void
  onDelete: (questionId: string) => void
  onAdd: (section: QuestionType) => void
  onSetColumns: (questionId: string, columns: ColumnSetting) => void
  unsavedDraft?: boolean
  content?: PrintContent
}) {
  const workspace = useRef<HTMLElement | null>(null)
  const pages = usePaginatedExam(exam, version, workspace, content)
  const orderedIds = orderedQuestionIds(pages)
  const idsBySection = questionIdsBySection(pages)
  const columnSettings = columnSettingsOf(exam)
  const clearOnBackground = clearOnBackgroundClick(selection)

  return (
    <main
      className={`exam-workspace${unsavedDraft ? ' exam-workspace--unsaved' : ''}`}
      ref={workspace}
      style={PAGE_GEOMETRY}
      onClick={clearOnBackground}
    >
      {pages.map((page) => (
        <article
          className="exam-page"
          key={`${page.header}-${page.number}`}
          onClick={clearOnBackground}
        >
          <PageHeaderView
            header={page.header}
            title={exam.title}
            letter={version.letter}
          />
          <div className="page-content" onClick={clearOnBackground}>
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
          </div>
          <footer className="page-footer">{page.number}</footer>
        </article>
      ))}
    </main>
  )
}
