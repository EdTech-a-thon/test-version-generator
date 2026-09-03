// The exam page: what the teacher looks at, and what the printer prints.
//
// This is the print Export Adapter: everything on it comes from the Layout Plan
// `export-plan.ts` returns, so this file only decides what a planned page looks
// like — never what is on it, in what order, or under which number. Nothing
// here is typeable: a double-click opens the question dialog instead, and every
// editing control lives in chrome that print hides.
//
// A page is a real sheet: fixed at the geometry `export-plan.ts` packed
// against, published to CSS as custom properties so the two cannot drift, with
// the furniture — the identity line, the title, the page number — drawn from
// the plan's own `PageFurniture` rather than being content that packs. The DOCX
// adapter prints the same furniture from the same field.
//
// The one asynchronous thing on this page is measurement, and it is the reason
// `pages` is state rather than a value computed during render: see
// `usePaginatedExam`.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import {
  AnswerKeyEntry,
  AnswerKeyHeading,
  AnswerKeySection,
  PageHeaderContent,
  PageItemMeasureView,
  QuestionContent,
  SectionHeadingContent,
} from './page-item-view'
import {
  FOOTER_HEIGHT,
  HEADER_HEIGHT,
  PAGE_HEIGHT,
  PAGE_MARGIN,
  PAGE_WIDTH,
  planExport,
  unmeasured,
  type ExportContentSelection,
  type LayoutPlan,
  type PlannedPage,
  type PageItem,
  type QuestionItem,
  type PlannedQuestion,
} from './export-plan'
import type { ColumnSetting, Exam, QuestionType, Version } from './exam'
import type { Selection } from './use-selection'
import type { WorkspaceDrag } from './use-workspace-drag'
import { dropStateOf, type QuestionDropState } from './workspace-drag'
import { CircleMinus, Copy, EllipsisVertical, ListPlus, Pencil, Plus, RefreshCw, Sparkles } from 'lucide-react'
import {
  ContextMenu,
  type MenuItem,
  type MenuPoint,
  type MenuSide,
} from './context-menu'
import { domMeasure } from './dom-measure'

/** Every question id across every page, in on-page (number) order. */
function orderedQuestionIds(pages: readonly PlannedPage[]): string[] {
  return pages.flatMap((page) =>
    page.items.flatMap((item) => (item.kind === 'question' ? [item.question.id] : [])),
  )
}

/** Every question's raw column setting, keyed by id — what its context menu
 * highlights, as opposed to `PlannedQuestion`'s resolved `grid.columns`. */
function columnSettingsOf(exam: Exam): Record<string, ColumnSetting> {
  const byId: Record<string, ColumnSetting> = {}
  for (const question of exam.questions) byId[question.id] = question.columns
  return byId
}

// The four answer-column settings, spelled out because a bare number in a menu
// would not explain itself.
const COLUMN_MENU_OPTIONS: readonly { label: string; value: ColumnSetting }[] = [
  { label: 'Auto', value: 'auto' },
  { label: '1 column', value: 1 },
  { label: '2 columns', value: 2 },
  { label: '4 columns', value: 4 },
]

function ColumnLayoutIcon({ columns }: { columns: 1 | 2 | 4 }) {
  const strokes = columns === 1
    ? [
        'M1.5 2h15',
        'M1.5 5.33h15',
        'M1.5 8.67h15',
        'M1.5 12h15',
      ]
    : columns === 2
      ? [
          'M1.5 3.5h6',
          'M10.5 3.5h6',
          'M1.5 10.5h6',
          'M10.5 10.5h6',
        ]
      : [
          'M1.5 7h1.5',
          'M6 7h1.5',
          'M10.5 7h1.5',
          'M15 7h1.5',
        ]
  return (
    <svg
      viewBox="0 0 18 14"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
      data-column-layout={columns}
    >
      {strokes.map((stroke) => (
        <path key={stroke} d={stroke} strokeLinecap="round" />
      ))}
    </svg>
  )
}

// One list, however it was opened. The grip beside a question and a right-click
// on the question itself raise exactly the same actions, which is what makes
// the grip discoverable rather than a second, lesser control.
function questionMenuItems({
  question,
  columns,
  onEdit,
  onDuplicate,
  onReplaceWithEquivalents,
  onRemove,
  onAdd,
  onSetColumns,
  selectedQuestionIds,
}: {
  question: PlannedQuestion
  columns: ColumnSetting
  onEdit: (questionId: string) => void
  onDuplicate: (questionId: string) => void
  onReplaceWithEquivalents: (questionIds: readonly string[]) => void
  onRemove: (questionIds: readonly string[]) => void
  onAdd: (section: QuestionType, afterQuestionId?: string) => void
  onSetColumns: (questionIds: readonly string[], columns: ColumnSetting) => void
  selectedQuestionIds: readonly string[]
}): MenuItem[] {
  // Every action that can sensibly apply to more than one question applies to
  // the whole selection when the question raising the menu is part of it, and
  // to that question alone otherwise.
  const actedOnIds = selectedQuestionIds.includes(question.id)
    ? selectedQuestionIds
    : [question.id]
  const items: MenuItem[] = [
    {
      kind: 'submenu',
      label: 'Vary',
      icon: <RefreshCw />,
      items: [
        {
          kind: 'action',
          label: 'Replace with equivalents',
          onSelect: () => onReplaceWithEquivalents(actedOnIds),
        },
      ],
    },
    {
      kind: 'action',
      label: 'Edit question',
      icon: <Pencil />,
      onSelect: () => onEdit(question.id),
    },
    {
      kind: 'action',
      label: 'Duplicate',
      icon: <Copy />,
      onSelect: () => onDuplicate(question.id),
    },
    {
      kind: 'action',
      label: 'Add question below',
      icon: <ListPlus />,
      onSelect: () => onAdd(question.type, question.id),
    },
  ]
  // Columns are a multiple-choice question's business. An open question has no
  // answers to lay out, so the group is absent rather than present and inert.
  if (question.type === 'multiple-choice') {
    items.push(
      { kind: 'separator' },
      { kind: 'label', label: 'Answer columns' },
    )
    for (const option of COLUMN_MENU_OPTIONS) {
      items.push({
        kind: 'radio',
        label: option.label,
        checked: option.value === columns,
        icon: option.value === 'auto'
          ? <Sparkles />
          : <ColumnLayoutIcon columns={option.value} />,
        onSelect: () => onSetColumns(actedOnIds, option.value),
      })
    }
  }
  // Remove, never Delete: this takes the question off the Exam Draft and leaves
  // its Question Bank record alone, so it is neither destructive nor worth a
  // confirmation. Permanent deletion is not offered in this workspace at all.
  items.push(
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Remove',
      icon: <CircleMinus />,
      onSelect: () => onRemove(actedOnIds),
    },
  )
  return items
}

// The pair of controls a question reveals on hover, out in the sheet's margin:
// a plus that adds another question below this one, and a three-dot button that
// opens the question's menu beside it. Dragging is not their business — the
// whole question is the drag source, so there is nothing left for a grip to do.
//
// Clicks are stopped from bubbling to the question's own handler, so reaching
// for a handle never also selects, deselects, or extends a range through the
// question underneath. A right-click is deliberately left to bubble: landing on
// a handle rather than the text is a miss, and should still get the menu.
function QuestionHandles({
  question,
  onAdd,
  onOpenMenu,
}: {
  question: PlannedQuestion
  onAdd: (section: QuestionType, afterQuestionId?: string) => void
  onOpenMenu: (questionId: string, point: MenuPoint, side?: MenuSide) => void
}) {
  return (
    <aside
      className="question-handles"
      aria-label={`Question ${question.number} controls`}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="question-handle"
        aria-label={`Add a question after question ${question.number}`}
        onClick={() => onAdd(question.type, question.id)}
      >
        <Plus />
      </button>
      <button
        type="button"
        className="question-handle menu-handle"
        aria-haspopup="menu"
        aria-label={`Actions for question ${question.number}`}
        onClick={(event) => {
          // Beside the grip and to its left, not under the pointer: a menu
          // opened from a handle should read as belonging to that handle, and
          // opening leftwards keeps it off the question it acts on. The point
          // is the menu's right edge — `side` is what makes it one.
          const bounds = event.currentTarget.getBoundingClientRect()
          onOpenMenu(question.id, { x: bounds.left - 6, y: bounds.top }, 'left')
        }}
      >
        <EllipsisVertical />
      </button>
    </aside>
  )
}

// A question on the page, or the piece of one this page carries: the same
// content `dom-measure.ts` measured, wrapped in the chrome that makes it
// selectable, editable and droppable. A continued piece is chrome-free — its
// handles, and everything they do, belong to the piece that carries the
// question's number.
function QuestionView({
  item,
  selected,
  orderedIds,
  selection,
  onEdit,
  onAdd,
  onOpenMenu,
  dragging,
  dropped,
  revealed,
  dropState,
  onDragStart,
  onDragMove,
  onDrop,
  onDragEnd,
}: {
  item: QuestionItem
  selected: boolean
  orderedIds: readonly string[]
  selection: Selection
  onEdit: (questionId: string) => void
  onAdd: (section: QuestionType, afterQuestionId?: string) => void
  onOpenMenu: (questionId: string, point: MenuPoint, side?: MenuSide) => void
  dragging: boolean
  dropped: boolean
  revealed: boolean
  dropState: QuestionDropState
  onDragStart: (
    question: PlannedQuestion,
    element: HTMLElement,
    point: { x: number; y: number },
  ) => void
  onDragMove: (point: { x: number; y: number }) => void
  onDrop: () => void
  onDragEnd: () => void
}) {
  const pointerDrag = useRef<{
    id: number
    startX: number
    startY: number
    dragging: boolean
  } | null>(null)
  const suppressClick = useRef(false)
  const question = item.question

  const releasePointer = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const classes = ['exam-question']
  if (selected) classes.push('exam-question--selected')
  if (dragging) classes.push('exam-question--dragging')
  if (dropped) classes.push('exam-question--dropped')
  if (revealed) classes.push('exam-question--revealed')

  return (
    <section
      className={classes.join(' ')}
      data-question-id={question.id}
      data-drop-target={item.numbered ? question.type : undefined}
      data-drop={dropState ?? undefined}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        const target = event.target as HTMLElement
        if (target.closest('button, input, textarea, select, a, [contenteditable="true"]')) {
          return
        }
        // Shift-click extends the app's question range, not the browser's
        // native text range. Cancelling pointer-down is early enough to stop
        // the native selection while still allowing the click event below.
        if (event.shiftKey) event.preventDefault()
        pointerDrag.current = {
          id: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          dragging: false,
        }
        suppressClick.current = false
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const gesture = pointerDrag.current
        if (!gesture || gesture.id !== event.pointerId) return
        if (!gesture.dragging) {
          const distance = Math.hypot(
            event.clientX - gesture.startX,
            event.clientY - gesture.startY,
          )
          if (distance < 5) return
          gesture.dragging = true
          suppressClick.current = true
          onDragStart(question, event.currentTarget, {
            x: gesture.startX,
            y: gesture.startY,
          })
        }
        event.preventDefault()
        onDragMove({ x: event.clientX, y: event.clientY })
      }}
      onPointerUp={(event) => {
        const gesture = pointerDrag.current
        if (!gesture || gesture.id !== event.pointerId) return
        pointerDrag.current = null
        releasePointer(event)
        if (!gesture.dragging) return
        event.preventDefault()
        onDrop()
      }}
      onPointerCancel={(event) => {
        const gesture = pointerDrag.current
        if (!gesture || gesture.id !== event.pointerId) return
        pointerDrag.current = null
        releasePointer(event)
        if (gesture.dragging) {
          suppressClick.current = false
          onDragEnd()
        }
      }}
      onLostPointerCapture={(event) => {
        const gesture = pointerDrag.current
        if (!gesture || gesture.id !== event.pointerId) return
        pointerDrag.current = null
        if (gesture.dragging) {
          suppressClick.current = false
          onDragEnd()
        }
      }}
      onClick={(event) => {
        if (suppressClick.current) {
          suppressClick.current = false
          event.preventDefault()
          event.stopPropagation()
          return
        }
        // The first click has already selected immediately. Ignore the second
        // click's selection semantics and let `dblclick` open the editor; this
        // also prevents Ctrl/Cmd-double-click from toggling the item twice.
        if (event.detail > 1) return
        selection.selectOne(question.id, orderedIds, {
          shiftKey: event.shiftKey,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
        })
      }}
      onDoubleClick={() => onEdit(question.id)}
      // A right-click anywhere on the question raises the same menu the grip
      // does, under the pointer. A continued piece answers too — it is the
      // same question, even though its handles belong to the numbered piece.
      onContextMenu={(event) => {
        event.preventDefault()
        onOpenMenu(question.id, { x: event.clientX, y: event.clientY })
      }}
    >
      {item.numbered && (
        <QuestionHandles question={question} onAdd={onAdd} onOpenMenu={onOpenMenu} />
      )}
      <QuestionContent item={item} />
    </section>
  )
}

function PageItemView({
  item,
  orderedIds,
  selection,
  onEdit,
  onAdd,
  onOpenMenu,
  draggedQuestionIds,
  droppedQuestionIds,
  revealedQuestionIds,
  dropState,
  onDragStart,
  onDragMove,
  onDrop,
  onDragEnd,
}: {
  item: PageItem
  orderedIds: readonly string[]
  selection: Selection
  onEdit: (questionId: string) => void
  onAdd: (section: QuestionType, afterQuestionId?: string) => void
  onOpenMenu: (questionId: string, point: MenuPoint, side?: MenuSide) => void
  draggedQuestionIds: ReadonlySet<string>
  droppedQuestionIds: ReadonlySet<string>
  revealedQuestionIds: ReadonlySet<string>
  dropState: (questionId: string) => QuestionDropState
  onDragStart: (
    question: PlannedQuestion,
    element: HTMLElement,
    point: { x: number; y: number },
  ) => void
  onDragMove: (point: { x: number; y: number }) => void
  onDrop: () => void
  onDragEnd: () => void
}) {
  switch (item.kind) {
    case 'section-heading':
      return (
        <header className="exam-section">
          <SectionHeadingContent item={item} />
        </header>
      )
    case 'question':
      return (
        <QuestionView
          item={item}
          selected={selection.isSelected(item.question.id)}
          orderedIds={orderedIds}
          selection={selection}
          onEdit={onEdit}
          onAdd={onAdd}
          onOpenMenu={onOpenMenu}
          dragging={draggedQuestionIds.has(item.question.id)}
          dropped={droppedQuestionIds.has(item.question.id) && item.numbered}
          revealed={revealedQuestionIds.has(item.question.id)}
          dropState={dropState(item.question.id)}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
        />
      )
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

// Clears the selection when the click landed on the background element
// itself — the page or the workspace — rather than bubbling up from a
// question or a control inside one.
function clearOnBackgroundClick(selection: Selection) {
  return (event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
    if (event.target === event.currentTarget) selection.clear()
  }
}

// How long a question stays marked after an authoring action has put it on the
// Exam Draft. Long enough to find on a repaginated page, short enough that it
// is plainly feedback rather than a second kind of selection.
//
// Published to CSS beside the page geometry, for the same reason: the mark
// fades on an animation and is taken off by a timer, and if the two disagreed
// the highlight would either flash back on or linger with nothing behind it.
const REVEAL_HIGHLIGHT_MS = 1400

// The geometry `export-plan.ts` packed against, handed to CSS. Screen and paper
// agree only if the sheet is laid out at the size it was packed for, and the
// only way to be sure of that is for both to read the same numbers.
const PAGE_GEOMETRY = {
  '--page-width': `${PAGE_WIDTH}px`,
  '--page-height': `${PAGE_HEIGHT}px`,
  '--page-margin': `${PAGE_MARGIN}px`,
  '--page-header-first': `${HEADER_HEIGHT.first}px`,
  '--page-header-later': `${HEADER_HEIGHT.later}px`,
  '--page-header-answer-key': `${HEADER_HEIGHT['answer-key']}px`,
  '--page-header-answer-key-later': `${HEADER_HEIGHT['answer-key-later']}px`,
  '--page-footer': `${FOOTER_HEIGHT}px`,
  '--reveal-highlight': `${REVEAL_HIGHLIGHT_MS}ms`,
} as CSSProperties

// How long *editing* settles before the page is measured and packed again.
// Measurement is the expensive, DOM-touching half of the render, and the exam
// title is typed a keystroke at a time, so content changes wait for a pause.
//
// Reordering does not: a drop or a shuffle is one discrete gesture with nothing
// to coalesce, and waiting on it is just latency the teacher can feel. See
// `usePaginatedExam`.
const REPAGINATE_DEBOUNCE_MS = 150

// Pagination, kept in state rather than computed while rendering.
//
// `planExport` is pure, but the `Measure` the app gives it reads real layout,
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
  selection: ExportContentSelection,
): LayoutPlan {
  const { test, answerKey } = selection
  const [plan, setPlan] = useState<LayoutPlan>(() =>
    planExport({ exam, version, selection, measure: unmeasured }),
  )
  const measured = useRef(false)
  // What the last pagination was for, so this one can tell an edit from a
  // reorder. A `Version` carries an ordering and nothing else, so a change to
  // it alone cannot alter a single item's height.
  const lastExam = useRef(exam)
  // Bumped when a font or an image has settled and the remembered heights have
  // been thrown away. It is a dependency rather than a captured callback so the
  // re-measure always runs against the current exam, never a stale closure.
  const [settled, setSettled] = useState(0)

  useLayoutEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let live = true
    const repaginate = () => setPlan(
      planExport({
        exam,
        version,
        selection: { test, answerKey },
        measure: domMeasure,
      }),
    )
    const schedule = () => {
      if (!live) return
      clearTimeout(timer)
      timer = setTimeout(repaginate, REPAGINATE_DEBOUNCE_MS)
    }

    const edited = lastExam.current !== exam
    lastExam.current = exam

    if (!measured.current) {
      measured.current = true
      repaginate()
    } else if (edited) {
      // Content changed, and it may still be being typed.
      schedule()
    } else {
      // Ordering only. Nothing to wait for, and — because the items' markup is
      // unchanged apart from their printed numbers — almost every height comes
      // straight back out of `domMeasure`'s cache.
      clearTimeout(timer)
      repaginate()
    }

    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [exam, version, workspace, test, answerKey, settled])

  // Assets settling is its own concern, and deliberately keyed on the exam
  // rather than the version.
  //
  // `document.fonts.ready` is already resolved once the page has loaded, so a
  // `.then` attached per pagination fires on the very next microtask — every
  // time, reorders included. Left inside the effect above, that meant every
  // drop threw the measured heights away and paid for a second pagination,
  // which is exactly the cost the cache exists to avoid.
  //
  // Keyed on `exam`, it is what it was always meant to be: one re-measurement
  // per edit — enough to settle, and bounded, so a measurement can never chase
  // its own result round in a loop.
  useEffect(() => {
    let live = true
    let done = false
    const settle = () => {
      if (!live || done) return
      done = true
      // Before the re-measure, never after: the whole point is that this same
      // markup measures differently now.
      domMeasure.invalidate()
      setSettled((count) => count + 1)
    }
    document.fonts?.ready.then(settle, () => {})
    const element = workspace.current
    element?.addEventListener('load', settle, true)
    return () => {
      live = false
      element?.removeEventListener('load', settle, true)
    }
  }, [exam, workspace])

  return plan
}

// The print Export Adapter's own document.
//
// One export is a collection of standalone documents — a student test or an
// answer key, one per Generated Version — and this mounts every planned page of
// every one of them, in the order `export-preparation.ts` prepared them, for a
// single native Print operation.
//
// It plans nothing. `ExamPage` above paginates what the teacher is editing;
// this draws plans that were already resolved, which is what lets several
// Versions print together without any of them being repaginated per format.
// Each document is its own workspace, and print CSS breaks a page between them.
function PlannedDocument({ plan }: { plan: LayoutPlan }) {
  return (
    <main className="exam-workspace" style={PAGE_GEOMETRY}>
      {plan.pages.map((page) => (
        <article className="exam-page" key={`${page.stream}-${page.header}-${page.number}`}>
          <PageHeaderContent header={page.header} furniture={page.furniture} />
          <div className="page-content">
            {page.items.map((item) => (
              <PageItemMeasureView key={keyOf(item)} item={item} />
            ))}
          </div>
          <footer className="page-footer">{page.furniture.pageNumber}</footer>
        </article>
      ))}
    </main>
  )
}

/** Everything one export publishes, mounted for the browser's Print dialog.
 *  Hidden on screen — `.print-output` is `display: none` until print media
 *  applies — and kept mounted until the browser says printing has finished. */
export function PrintDocument({ plans }: { plans: readonly LayoutPlan[] }) {
  return (
    <div className="print-output">
      {plans.map((plan, index) => (
        <PlannedDocument key={`${plan.version.letter}-${plan.pages[0]?.stream}-${index}`} plan={plan} />
      ))}
    </div>
  )
}

export function ExamPage({
  exam,
  version,
  selection,
  drag,
  revealQuestionId,
  onRevealed,
  onEdit,
  onDuplicate,
  onReplaceWithEquivalents,
  onRemove,
  onAdd,
  onAddFirst,
  onSetColumns,
  unsavedDraft = false,
  contentSelection = { test: true, answerKey: true },
}: {
  exam: Exam
  version: Version
  selection: Selection
  /** The gesture in flight, coordinated across both panes of the workspace. */
  drag: WorkspaceDrag
  /** A question an authoring action has just put on the Exam Draft. It is
   *  scrolled to and briefly highlighted once repagination has actually put it
   *  on a page — which, for an insertion, is not the same moment. */
  revealQuestionId?: string | null
  onRevealed?: () => void
  onEdit: (questionId: string) => void
  onDuplicate: (questionId: string) => void
  onReplaceWithEquivalents: (questionIds: readonly string[]) => void
  onRemove: (questionIds: readonly string[]) => void
  onAdd: (section: QuestionType, afterQuestionId?: string) => void
  /** The first question on an empty sheet. Its position names no Question
   *  Section, so unlike `onAdd` this one has a type still to be chosen. */
  onAddFirst?: (point: MenuPoint) => void
  onSetColumns: (questionIds: readonly string[], columns: ColumnSetting) => void
  unsavedDraft?: boolean
  contentSelection?: ExportContentSelection
}) {
  const workspace = useRef<HTMLElement | null>(null)
  const blank = exam.questions.length === 0
  const plan = usePaginatedExam(exam, version, workspace, contentSelection)
  const pages = plan.pages
  const orderedIds = orderedQuestionIds(pages)
  const columnSettings = columnSettingsOf(exam)
  const clearOnBackground = clearOnBackgroundClick(selection)
  // Dragging is coordinated above this pane, because one gesture spans both of
  // them: a Question Bank question composed onto the Exam Draft starts in the
  // other pane entirely. What stays here is what only this pane knows — which
  // questions a gesture picks up, and what their markup is — and the pointer
  // capture and page-owned preview that gesture has always used.
  const { draggedQuestionIds, droppedQuestionIds } = drag
  const beginDrag = useCallback((
    question: PlannedQuestion,
    element: HTMLElement,
    point: { x: number; y: number },
  ) => {
    const ids = selection.isSelected(question.id)
      ? [...new Set(orderedIds.filter((id) =>
          selection.isSelected(id) &&
          exam.questions.find((item) => item.id === id)?.type === question.type,
        ))]
      : [question.id]
    if (!selection.isSelected(question.id)) {
      selection.selectOne(question.id, orderedIds, {
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
      })
    }
    const elements = Array.from(
      workspace.current?.querySelectorAll<HTMLElement>('.exam-question[data-question-id]') ?? [],
    ).filter((candidate) => ids.includes(candidate.dataset.questionId ?? ''))
    drag.begin(
      { pane: 'exam-draft', questionIds: ids, type: question.type },
      { elements, bounds: element.getBoundingClientRect(), point },
    )
  }, [drag, exam.questions, orderedIds, selection])

  const questionDropState = useCallback(
    (questionId: string) => dropStateOf(drag.intent, questionId),
    [drag.intent],
  )
  // Revealing a question an authoring action has just put on the Exam Draft.
  //
  // Insertion and Replace change the exam's *content*, and content changes wait
  // for a pause before the page is measured and packed again. So the question
  // is not on the page in the frame the action was taken — it arrives one
  // repagination later, possibly on a different sheet from the one that was in
  // view. This runs on every plan until the question is actually there, then
  // scrolls to it and marks it for a moment.
  const [revealedQuestionIds, setRevealedQuestionIds] = useState<ReadonlySet<string>>(
    new Set(),
  )
  useEffect(() => {
    if (!revealQuestionId) return
    const element = workspace.current?.querySelector<HTMLElement>(
      `.exam-question[data-question-id="${CSS.escape(revealQuestionId)}"]`,
    )
    // Not paginated onto a page yet: this effect runs again on the next plan.
    if (!element) return
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    setRevealedQuestionIds(new Set([revealQuestionId]))
    onRevealed?.()
  }, [revealQuestionId, plan, onRevealed])
  // The highlight's own lifetime, kept off the effect above so that clearing
  // `revealQuestionId` — which that effect does — cannot cancel it.
  useEffect(() => {
    if (revealedQuestionIds.size === 0) return
    const timer = setTimeout(() => setRevealedQuestionIds(new Set()), REVEAL_HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [revealedQuestionIds])

  // Keyed on the numbered piece: a split question's handles and menu belong to
  // the piece carrying its number, and that is the one holding its `number`.
  const questionsById = new Map(
    pages
      .flatMap((page) => page.items)
      .flatMap((item) =>
        item.kind === 'question' && item.numbered
          ? [[item.question.id, item.question] as const]
          : [],
      ),
  )
  // Which question's menu is open, and where it was raised. Held here rather
  // than per question, so opening one menu closes any other by construction.
  const [menu, setMenu] = useState<{
    questionId: string
    point: MenuPoint
    side: MenuSide
  } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const openMenu = useCallback(
    (questionId: string, point: MenuPoint, side: MenuSide = 'right') =>
      setMenu({ questionId, point, side }),
    [],
  )
  // A question deleted while its own menu is open leaves the menu with nothing
  // to act on, so it simply stops being rendered.
  const menuQuestion = menu ? questionsById.get(menu.questionId) : undefined

  // The Question Section a gesture in flight could start, if it is one the Exam
  // Draft has no questions in. A gesture from within the Exam Draft is a
  // reorder and can never reach an empty section, so it is offered nothing.
  const emptySectionOffer =
    drag.source?.pane === 'question-bank'
      && !exam.questions.some((question) => question.type === drag.source?.type)
      ? drag.source.type
      : null

  const workspaceClasses = ['exam-workspace']
  if (unsavedDraft) workspaceClasses.push('exam-workspace--unsaved')
  if (draggedQuestionIds.size > 0) workspaceClasses.push('exam-workspace--dragging')
  if (droppedQuestionIds.size > 0) workspaceClasses.push('exam-workspace--drop-feedback')

  return (
    <main
      className={workspaceClasses.join(' ')}
      ref={workspace}
      style={PAGE_GEOMETRY}
      onClick={clearOnBackground}
      onPointerMove={() => {
        if (!drag.source && droppedQuestionIds.size > 0) drag.clearDropFeedback()
      }}
    >
      {pages.map((page, index) => (
        <article
          className="exam-page"
          key={`${page.header}-${page.number}`}
          onClick={clearOnBackground}
        >
          <PageHeaderContent
            header={page.header}
            furniture={page.furniture}
          />
          <div className="page-content" onClick={clearOnBackground}>
            {/* An exam with nothing in it yet offers the first question where
                the first question will go, rather than leaving a blank sheet
                and a button in the header as the only way in. It is editing
                chrome: it appears only while the exam is empty, and it is
                never part of the printed document. */}
            {blank && index === 0 && (
              <button
                type="button"
                className="secondary-button empty-exam-button"
                onClick={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect()
                  onAddFirst?.({ x: bounds.left + 12, y: bounds.top + 12 })
                }}
                // An empty sheet has nothing drawn on it to aim at, so the way
                // in is also the way to drop: the placeholder is the first
                // question's position, and it is the whole of the page rather
                // than a strip at the top of it.
                data-empty-section={emptySectionOffer ?? undefined}
                data-active={drag.intent?.kind === 'insert-first' ? 'true' : undefined}
              >
                <Plus />
                Insert your first question
              </button>
            )}
            {page.items.map((item) => (
              <PageItemView
                key={keyOf(item)}
                item={item}
                orderedIds={orderedIds}
                selection={selection}
                onEdit={onEdit}
                onAdd={onAdd}
                onOpenMenu={openMenu}
                draggedQuestionIds={draggedQuestionIds}
                droppedQuestionIds={droppedQuestionIds}
                revealedQuestionIds={revealedQuestionIds}
                dropState={questionDropState}
                onDragStart={beginDrag}
                onDragMove={drag.move}
                onDrop={drag.drop}
                onDragEnd={drag.cancel}
              />
            ))}
          </div>
          <footer className="page-footer">{page.furniture.pageNumber}</footer>
        </article>
      ))}

      {/* The first question of a Question Section the exam has started but has
          none of — a Short Answer question dragged at an exam with only
          Multiple Choice ones, say.

          An empty Question Section is not drawn on the sheet at all, because a
          section is derived from the questions in it, so a gesture aimed at one
          would have nothing to land on. The offer is made as editing chrome
          pinned to the foot of this pane: it appears only while a compatible
          gesture is in flight, it is reachable however far the exam has been
          scrolled, and it never takes a pixel from the paper's own geometry.

          An exam with nothing in it at all does not need this: the placeholder
          on the first page is already the first question's position, and it is
          the drop target. */}
      {emptySectionOffer && !blank && (
        <div
          className="exam-draft-empty-section"
          data-empty-section={emptySectionOffer}
          data-active={drag.intent?.kind === 'insert-first' ? 'true' : undefined}
        >
          Drop to add the first question
        </div>
      )}

      {menu && menuQuestion && (
        <ContextMenu
          point={menu.point}
          side={menu.side}
          ariaLabel={`Question ${menuQuestion.number} actions`}
          items={questionMenuItems({
            question: menuQuestion,
            columns: columnSettings[menuQuestion.id] ?? 'auto',
            onEdit,
            onDuplicate,
            onReplaceWithEquivalents,
            onRemove,
            onAdd,
            onSetColumns,
            selectedQuestionIds: [...selection.selectedIds],
          })}
          onClose={closeMenu}
        />
      )}
    </main>
  )
}
