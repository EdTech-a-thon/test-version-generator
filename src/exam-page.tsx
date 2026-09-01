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
import type {
  ColumnSetting,
  Exam,
  QuestionPlacement,
  QuestionType,
  Version,
} from './exam'
import type { Selection } from './use-selection'
import { CircleMinus, Copy, EllipsisVertical, ListPlus, Pencil, Plus, Sparkles } from 'lucide-react'
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
  onRemove,
  onAdd,
  onSetColumns,
  selectedQuestionIds,
}: {
  question: PlannedQuestion
  columns: ColumnSetting
  onEdit: (questionId: string) => void
  onDuplicate: (questionId: string) => void
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
  dropPlacement,
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
  dropPlacement: QuestionPlacement | null
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

  return (
    <section
      className={classes.join(' ')}
      data-question-id={question.id}
      data-drop-target={item.numbered ? question.type : undefined}
      data-drop={dropPlacement ?? undefined}
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
  dropTarget,
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
  dropTarget: { questionId: string; placement: QuestionPlacement } | null
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
          dropPlacement={
            dropTarget?.questionId === item.question.id ? dropTarget.placement : null
          }
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
  onEdit,
  onDuplicate,
  onRemove,
  onAdd,
  onSetColumns,
  onMoveQuestions,
  unsavedDraft = false,
  contentSelection = { test: true, answerKey: true },
}: {
  exam: Exam
  version: Version
  selection: Selection
  onEdit: (questionId: string) => void
  onDuplicate: (questionId: string) => void
  onRemove: (questionIds: readonly string[]) => void
  onAdd: (section: QuestionType, afterQuestionId?: string) => void
  onSetColumns: (questionIds: readonly string[], columns: ColumnSetting) => void
  onMoveQuestions: (
    questionIds: readonly string[],
    targetId: string,
    placement: QuestionPlacement,
  ) => void
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
  // Pointer capture keeps this gesture in page control. Native HTML dragging
  // owns the system cursor after `dragstart`, ignoring even a computed
  // `cursor: grabbing`; a page-owned preview lets the closed hand remain while
  // preserving the same source, marker, and drop state.
  const dragged = useRef<{ ids: string[]; type: QuestionType } | null>(null)
  const dragPreview = useRef<{
    element: HTMLElement
    offsetX: number
    offsetY: number
  } | null>(null)
  const [draggedQuestionIds, setDraggedQuestionIds] = useState<ReadonlySet<string>>(
    new Set(),
  )
  // After a successful drop, feedback belongs to the question that moved, not
  // whichever question happens to remain under the stationary pointer. It
  // lasts until the pointer moves again and normal geometric hover resumes.
  const [droppedQuestionIds, setDroppedQuestionIds] = useState<ReadonlySet<string>>(
    new Set(),
  )
  // Where the question would land if it were let go now — what the drop line
  // is drawn from. Held next to the drag itself so exactly one line can show.
  const pendingDrop = useRef<{
    questionId: string
    placement: QuestionPlacement
  } | null>(null)
  const [dropTarget, setDropTarget] = useState<{
    questionId: string
    placement: QuestionPlacement
  } | null>(null)

  const clearDragArtifacts = useCallback(() => {
    dragPreview.current?.element.remove()
    dragPreview.current = null
    document.documentElement.classList.remove('question-drag-active')
  }, [])
  const endDrag = useCallback(() => {
    dragged.current = null
    pendingDrop.current = null
    clearDragArtifacts()
    setDraggedQuestionIds(new Set())
    setDropTarget(null)
  }, [clearDragArtifacts])
  useEffect(() => clearDragArtifacts, [clearDragArtifacts])

  const markDrop = useCallback(
    (questionId: string, placement: QuestionPlacement) => {
      const next = { questionId, placement }
      pendingDrop.current = next
      // `dragover` fires continuously; only a change in where the question
      // would land is worth a re-render.
      setDropTarget((current) =>
        current?.questionId === questionId && current.placement === placement
          ? current
          : next,
      )
    },
    [],
  )
  const clearDrop = useCallback(() => {
    pendingDrop.current = null
    setDropTarget(null)
  }, [])

  const beginDrag = useCallback((
    question: PlannedQuestion,
    element: HTMLElement,
    point: { x: number; y: number },
  ) => {
    clearDragArtifacts()
    const bounds = element.getBoundingClientRect()
    const computed = getComputedStyle(element)
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
    const preview = document.createElement('div')
    preview.className = 'question-drag-preview'
    preview.setAttribute('aria-hidden', 'true')
    preview.setAttribute('inert', '')
    preview.dataset.count = String(ids.length)
    const selectedElements = Array.from(
      workspace.current?.querySelectorAll<HTMLElement>('.exam-question[data-question-id]') ?? [],
    ).filter((candidate) => ids.includes(candidate.dataset.questionId ?? ''))
    for (const selectedElement of selectedElements) {
      const clone = selectedElement.cloneNode(true) as HTMLElement
      clone.classList.remove(
        'exam-question--selected',
        'exam-question--dragging',
        'exam-question--dropped',
      )
      clone.removeAttribute('data-question-id')
      clone.removeAttribute('data-drop-target')
      clone.removeAttribute('data-drop')
      clone.querySelectorAll('[id]').forEach((child) => child.removeAttribute('id'))
      preview.append(clone)
    }
    Object.assign(preview.style, {
      left: `${bounds.left}px`,
      top: `${bounds.top}px`,
      width: `${bounds.width}px`,
      color: computed.color,
      fontFamily: computed.fontFamily,
      fontSize: computed.fontSize,
      lineHeight: computed.lineHeight,
    })
    document.body.append(preview)
    document.documentElement.classList.add('question-drag-active')
    dragPreview.current = {
      element: preview,
      offsetX: point.x - bounds.left,
      offsetY: point.y - bounds.top,
    }
    dragged.current = { ids, type: question.type }
    setDroppedQuestionIds(new Set())
    setDraggedQuestionIds(new Set(ids))
  }, [clearDragArtifacts, exam.questions, orderedIds, selection])

  const moveDrag = useCallback((point: { x: number; y: number }) => {
    const preview = dragPreview.current
    if (preview) {
      preview.element.style.left = `${point.x - preview.offsetX}px`
      preview.element.style.top = `${point.y - preview.offsetY}px`
    }
    const source = dragged.current
    const target = document
      .elementFromPoint(point.x, point.y)
      ?.closest<HTMLElement>('.exam-question[data-drop-target]')
    const targetId = target?.dataset.questionId
    if (
      !source ||
      !target ||
      !targetId ||
      source.ids.includes(targetId) ||
      target.dataset.dropTarget !== source.type
    ) {
      clearDrop()
      return
    }
    const bounds = target.getBoundingClientRect()
    markDrop(
      targetId,
      point.y < bounds.top + bounds.height / 2 ? 'before' : 'after',
    )
  }, [clearDrop, markDrop])

  const finishDrag = useCallback(() => {
    const source = dragged.current
    const target = pendingDrop.current
    if (source && target) {
      onMoveQuestions(source.ids, target.questionId, target.placement)
    }
    endDrag()
    if (source && target) setDroppedQuestionIds(new Set(source.ids))
  }, [endDrag, onMoveQuestions])
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
        if (!dragged.current && droppedQuestionIds.size > 0) setDroppedQuestionIds(new Set())
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
                onClick={() => onAdd('multiple-choice')}
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
                dropTarget={dropTarget}
                onDragStart={beginDrag}
                onDragMove={moveDrag}
                onDrop={finishDrag}
                onDragEnd={endDrag}
              />
            ))}
          </div>
          <footer className="page-footer">{page.furniture.pageNumber}</footer>
        </article>
      ))}

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
