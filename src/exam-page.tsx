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

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import {
  AnswerKeyEntry,
  AnswerKeyHeading,
  AnswerKeySection,
  PageHeaderContent,
  PageItemMeasureView,
  QuestionContent,
  SectionHeadingContent,
  WorkSpaceView,
} from './page-item-view'
import {
  FOOTER_HEIGHT,
  MAX_WORK_SPACE_HEIGHT,
  HEADER_HEIGHT,
  PAGE_HEIGHT,
  PAGE_MARGIN,
  PAGE_WIDTH,
  numberLabelOf,
  numbersTakenBy,
  planExport,
  unmeasured,
  type AnswerKeyEntryItem,
  type ExportContentSelection,
  type LayoutPlan,
  type PlannedPage,
  type PageItem,
  type QuestionItem,
  type SectionHeadingItem,
  type PlannedPart,
  type PlannedQuestion,
  type PlannedWorkSpace,
} from './export-plan'
import {
  DEFAULT_COLUMNS,
  columnsOf,
  hasWorkSpace,
  snapWorkSpaceHeight,
  takesWorkSpace,
  WORK_SPACE_LINE_PITCH,
  workSpaceOf,
  type ColumnSetting,
  type Exam,
  type Arrangement,
  type QuestionType,
  type WorkSpace,
} from './exam'
import type { Selection } from './use-selection'
import {
  SECTION_INSTRUCTIONS,
  SECTION_TITLE,
  sectionHeadingOf,
  type SectionHeadingChange,
} from './section-headings'
import { sectionHeadingStyles } from './export-typography'
import { HeaderEditor } from './header-editor'
import {
  defaultExamHeader,
  headerContentOf,
  type ExamHeader,
  type HeaderSlot,
} from './page-header'
import type { WorkspaceDrag } from './use-workspace-drag'
import { dropStateOf, type QuestionDropState } from './workspace-drag'
import {
  AlignJustify,
  ArrowDownToLine,
  Ban,
  CircleMinus,
  Copy,
  EllipsisVertical,
  ListRestart,
  Pencil,
  PencilLine,
  RotateCcw,
  Shuffle,
  SquareDashed,
} from 'lucide-react'
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

/** Every question's column setting, keyed by id — what its context menu
 * highlights, read through `columnsOf` so a record stored before the setting
 * was a plain count highlights the default rather than nothing. */
function columnSettingsOf(exam: Exam): Record<string, ColumnSetting> {
  const byId: Record<string, ColumnSetting> = {}
  for (const question of exam.questions) byId[question.id] = columnsOf(question)
  return byId
}

// The answer-column settings, spelled out because a bare number in a menu
// would not explain itself.
const COLUMN_MENU_OPTIONS: readonly { label: string; value: ColumnSetting }[] = [
  { label: '1 column', value: 1 },
  { label: '2 columns', value: 2 },
  { label: '4 columns', value: 4 },
]

function ColumnLayoutIcon({
  columns,
  withDataAttribute = true,
}: {
  columns: ColumnSetting
  withDataAttribute?: boolean
}) {
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
      data-column-layout={withDataAttribute ? columns : undefined}
    >
      {strokes.map((stroke) => (
        <path key={stroke} d={stroke} strokeLinecap="round" />
      ))}
    </svg>
  )
}

/** How much room a work space opens with when a teacher picks blank or lined
 *  space for a question that has none yet: four ruled lines, enough to be seen
 *  and grabbed, and dragged from there. */
const DEFAULT_WORK_SPACE_HEIGHT = 4 * WORK_SPACE_LINE_PITCH

export type SetWorkSpace = (questionIds: readonly string[], patch: Partial<WorkSpace>) => void

/** The Answer columns submenu, for a Multiple Choice question or Part. */
function columnsMenu(
  label: string,
  columns: ColumnSetting,
  onSelect: (columns: ColumnSetting) => void,
): MenuItem {
  return {
    kind: 'submenu',
    label,
    // The parent row shows the current layout before its submenu asks the
    // teacher to choose another one.
    icon: <ColumnLayoutIcon columns={columns} withDataAttribute={false} />,
    items: COLUMN_MENU_OPTIONS.map((option) => ({
      kind: 'radio',
      label: option.label,
      checked: option.value === columns,
      icon: <ColumnLayoutIcon columns={option.value} />,
      onSelect: () => onSelect(option.value),
    })),
  }
}

/** The Work space submenu and its Fill toggle, for a Short Answer question or
 *  Part: `ids` are what the setting applies to. */
function workSpaceMenu(
  label: string,
  fillLabel: string,
  workSpace: WorkSpace,
  ids: readonly string[],
  onSetWorkSpace: SetWorkSpace,
): MenuItem[] {
  const present = hasWorkSpace(workSpace)
  // Picking a style for a question with no room gives it some, so the
  // choice is visible at once rather than waiting on a drag.
  const withStyle = (style: WorkSpace['style']) =>
    onSetWorkSpace(ids, present
      ? { style }
      : { style, height: DEFAULT_WORK_SPACE_HEIGHT })
  return [
    {
      kind: 'submenu',
      label,
      icon: <PencilLine />,
      items: [
        {
          kind: 'radio',
          label: 'None',
          checked: !present,
          icon: <Ban />,
          onSelect: () => onSetWorkSpace(ids, { height: 0, fill: false }),
        },
        {
          kind: 'radio',
          label: 'Blank space',
          checked: present && workSpace.style === 'blank',
          icon: <SquareDashed />,
          onSelect: () => withStyle('blank'),
        },
        {
          kind: 'radio',
          label: 'Lined space',
          checked: present && workSpace.style === 'lines',
          icon: <AlignJustify />,
          onSelect: () => withStyle('lines'),
        },
      ],
    },
    {
      kind: 'checkbox',
      label: fillLabel,
      checked: workSpace.fill,
      icon: <ArrowDownToLine />,
      onSelect: () => onSetWorkSpace(ids, { fill: !workSpace.fill }),
    },
  ]
}

// One list, however it was opened. The grip beside a question and a right-click
// on the question itself raise exactly the same actions, which is what makes
// the grip discoverable rather than a second, lesser control.
function questionMenuItems({
  question,
  columns,
  onEdit,
  onDuplicate,
  onShuffleSelected,
  onShuffleSelectedAnswers,
  onRemove,
  onSetColumns,
  workSpace,
  workSpaceOfPart,
  onSetWorkSpace,
  selectedQuestionIds,
}: {
  question: PlannedQuestion
  columns: ColumnSetting
  workSpace: WorkSpace
  /** A Part's work space on this Exam, as its menu reports it. */
  workSpaceOfPart: (partId: string) => WorkSpace
  onSetWorkSpace: SetWorkSpace
  onEdit: (questionId: string) => void
  onDuplicate: (questionId: string) => void
  onShuffleSelected: (questionIds: readonly string[]) => void
  onShuffleSelectedAnswers: (questionIds: readonly string[]) => void
  onRemove: (questionIds: readonly string[]) => void
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
  ]
  // Columns are a multiple-choice question's business. An open question has no
  // answers to lay out, so the group is absent rather than present and inert.
  if (question.type === 'multiple-choice') {
    items.push(
      { kind: 'separator' },
      columnsMenu('Answer columns', columns, (next) => onSetColumns(actedOnIds, next)),
    )
  }
  // A Multipart question lays out each Part the way a question of its kind is laid out,
  // so each Part gets the controls a question of its kind would — for that
  // Part alone, since Parts of different Multipart questions have nothing to
  // line up with one another.
  for (const part of question.parts ?? []) {
    items.push({ kind: 'separator' })
    if (part.type === 'multiple-choice') {
      items.push(
        columnsMenu(
          `Part ${part.letter} · Answer columns`,
          part.grid?.columns ?? DEFAULT_COLUMNS,
          (next) => onSetColumns([part.id], next),
        ),
      )
    } else {
      items.push(
        ...workSpaceMenu(
          `Part ${part.letter} · Work space`,
          `Part ${part.letter} · Fill rest of page`,
          workSpaceOfPart(part.id),
          [part.id],
          onSetWorkSpace,
        ),
      )
    }
  }
  // Room for working is a Short Answer question's business, set here on the
  // sheet rather than in the question editor: how much a student needs depends
  // on the test, and on what else shares the page. The store leaves any other
  // Question Type in the selection alone.
  if (takesWorkSpace(question.type)) {
    items.push(
      { kind: 'separator' },
      ...workSpaceMenu('Work space', 'Fill rest of page', workSpace, actedOnIds, onSetWorkSpace),
    )
  }
  items.push(
    { kind: 'separator' },
    { kind: 'label', label: 'Vary' },
    // Both shuffles sit side by side under one heading, each with its own
    // icon: crossed arrows for reordering questions across the sheet, a list
    // with a return arrow for reordering the answers inside each question.
    {
      kind: 'action',
      label: 'Shuffle question order',
      icon: <Shuffle />,
      onSelect: () => onShuffleSelected(actedOnIds),
    },
    {
      kind: 'action',
      label: 'Shuffle answer order',
      icon: <ListRestart />,
      onSelect: () => onShuffleSelectedAnswers(actedOnIds),
    },
  )
  // Remove, never Delete: this takes the question off the Working Copy and leaves
  // its Question Bank record alone, so it is neither destructive nor worth a
  // confirmation. Permanent deletion is not offered in this workspace at all.
  items.push(
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Remove',
      icon: <CircleMinus />,
      // Taking a question off the sheet is the one thing in this menu that
      // undoes work, so the row says so on hover rather than sitting there in
      // warning colours all the time.
      destructive: true,
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
  onOpenMenu,
}: {
  question: PlannedQuestion
  onOpenMenu: (questionId: string, point: MenuPoint, side?: MenuSide) => void
}) {
  return (
    <aside
      className="question-handles"
      aria-label={`Question ${numberLabelOf(question)} controls`}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="question-handle menu-handle"
        aria-haspopup="menu"
        aria-label={`Actions for question ${numberLabelOf(question)}`}
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

// The bar under a Short Answer question that drags its work space open, taller
// or shut. It is editing chrome: absolutely placed in the gap below the
// question, so it takes none of the height `dom-measure.ts` measured, and
// hidden from print with the rest of the chrome.
//
// A drag previews locally and commits once, on release — one undo step per
// gesture, and one repagination rather than one per pixel. Heights snap to
// whole ruled lines, so blank and lined space always agree about size. Dragging
// a space that fills its page takes over from the fill: the teacher is now
// saying how much room they want, so what they drag to is what they get.
//
// A separator in ARIA terms, so it takes the keyboard too: arrows move by a
// line, Home shuts it, End opens it as far as a drag could.
function WorkSpaceHandle({
  label,
  height,
  onPreview,
  onCommit,
}: {
  label: string
  height: number
  onPreview: (height: number | null) => void
  onCommit: (height: number) => void
}) {
  const gesture = useRef<{ id: number; startY: number; next: number } | null>(null)
  const settle = (next: number) => {
    const snapped = snapWorkSpaceHeight(next, MAX_WORK_SPACE_HEIGHT)
    if (snapped !== height) onCommit(snapped)
  }
  const lines = Math.floor(height / WORK_SPACE_LINE_PITCH)
  return (
    <div
      className="work-space-handle"
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={MAX_WORK_SPACE_HEIGHT / WORK_SPACE_LINE_PITCH}
      aria-valuenow={lines}
      aria-valuetext={`${lines} ${lines === 1 ? 'line' : 'lines'} of work space`}
      title="Drag to change the work space"
      tabIndex={0}
      // Never a question drag, a selection click or an editor double-click:
      // this gesture is the bar's alone.
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.stopPropagation()
        event.preventDefault()
        gesture.current = { id: event.pointerId, startY: event.clientY, next: height }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const drag = gesture.current
        if (!drag || drag.id !== event.pointerId) return
        event.stopPropagation()
        const next = snapWorkSpaceHeight(
          height + event.clientY - drag.startY,
          MAX_WORK_SPACE_HEIGHT,
        )
        if (next === drag.next) return
        drag.next = next
        onPreview(next)
      }}
      onPointerUp={(event) => {
        const drag = gesture.current
        if (!drag || drag.id !== event.pointerId) return
        event.stopPropagation()
        gesture.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
        settle(drag.next)
        onPreview(null)
      }}
      onPointerCancel={(event) => {
        if (gesture.current?.id !== event.pointerId) return
        gesture.current = null
        onPreview(null)
      }}
      onKeyDown={(event) => {
        const step = WORK_SPACE_LINE_PITCH
        const next =
          event.key === 'ArrowDown' ? height + step
            : event.key === 'ArrowUp' ? height - step
              : event.key === 'Home' ? 0
                : event.key === 'End' ? MAX_WORK_SPACE_HEIGHT
                  : null
        if (next === null) return
        event.preventDefault()
        event.stopPropagation()
        settle(next)
      }}
    >
      <span className="work-space-grip" aria-hidden="true" />
    </div>
  )
}

type QuestionDragHandlers = {
  onDragStart: (
    question: PlannedQuestion,
    element: HTMLElement,
    point: { x: number; y: number },
  ) => void
  onDragMove: (point: { x: number; y: number }) => void
  onDrop: () => void
  onDragEnd: () => void
}

// What a pointer does to a question wherever it is drawn: pick it up past a
// small threshold, select it on a click, open it on a double-click and raise
// its menu on a right-click. The sheet and the answer key both draw questions,
// and a gesture means the same thing on either.
function useQuestionGesture({
  question,
  orderedIds,
  selection,
  onEdit,
  onOpenMenu,
  onDragStart,
  onDragMove,
  onDrop,
  onDragEnd,
}: QuestionDragHandlers & {
  question: PlannedQuestion
  orderedIds: readonly string[]
  selection: Selection
  onEdit: (questionId: string) => void
  onOpenMenu: (questionId: string, point: MenuPoint, side?: MenuSide) => void
}) {
  const pointerDrag = useRef<{
    id: number
    startX: number
    startY: number
    dragging: boolean
  } | null>(null)
  const suppressClick = useRef(false)

  const releasePointer = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
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
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
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
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      const gesture = pointerDrag.current
      if (!gesture || gesture.id !== event.pointerId) return
      pointerDrag.current = null
      releasePointer(event)
      if (!gesture.dragging) return
      event.preventDefault()
      onDrop()
    },
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => {
      const gesture = pointerDrag.current
      if (!gesture || gesture.id !== event.pointerId) return
      pointerDrag.current = null
      releasePointer(event)
      if (gesture.dragging) {
        suppressClick.current = false
        onDragEnd()
      }
    },
    onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => {
      const gesture = pointerDrag.current
      if (!gesture || gesture.id !== event.pointerId) return
      pointerDrag.current = null
      if (gesture.dragging) {
        suppressClick.current = false
        onDragEnd()
      }
    },
    onClick: (event: ReactMouseEvent<HTMLElement>) => {
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
    },
    onDoubleClick: () => onEdit(question.id),
    // A right-click anywhere on the question raises the same menu the grip
    // does, under the pointer.
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault()
      onOpenMenu(question.id, { x: event.clientX, y: event.clientY })
    },
  }
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
  onOpenMenu,
  onSetWorkSpace,
  dragging,
  dropped,
  dropState,
  onDragStart,
  onDragMove,
  onDrop,
  onDragEnd,
}: {
  item: QuestionItem
  onSetWorkSpace: SetWorkSpace
  selected: boolean
  orderedIds: readonly string[]
  selection: Selection
  onEdit: (questionId: string) => void
  onOpenMenu: (questionId: string, point: MenuPoint, side?: MenuSide) => void
  dragging: boolean
  dropped: boolean
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
  const question = item.question
  const gesture = useQuestionGesture({
    question,
    orderedIds,
    selection,
    onEdit,
    onOpenMenu,
    onDragStart,
    onDragMove,
    onDrop,
    onDragEnd,
  })
  // The height a work-space drag is showing before it commits, or `null`.
  const [previewHeight, setPreviewHeight] = useState<number | null>(null)
  // The same for one of a Multipart question's Short Answer Parts, by the Part's id.
  const [partPreview, setPartPreview] = useState<{ partId: string; height: number } | null>(null)
  const previewed = (space: PlannedWorkSpace, height: number): PlannedWorkSpace => ({
    ...space,
    height,
    lines: space.style === 'lines' ? Math.floor(height / WORK_SPACE_LINE_PITCH) : 0,
  })
  const withQuestionPreview: QuestionItem =
    previewHeight === null || !item.workSpace
      ? item
      : { ...item, workSpace: previewed(item.workSpace, previewHeight) }
  const shown: QuestionItem =
    partPreview === null || !withQuestionPreview.parts
      ? withQuestionPreview
      : {
          ...withQuestionPreview,
          parts: withQuestionPreview.parts.map((part) =>
            part.id === partPreview.partId && part.workSpace
              ? { ...part, workSpace: previewed(part.workSpace, partPreview.height) }
              : part,
          ),
        }
  // A Short Answer Part's work space, with the bar that sizes it in the gap
  // below the Part, exactly as a Short Answer question's bar sits below it.
  const renderPartWorkSpace = (part: PlannedPart, space: PlannedWorkSpace) => (
    <div className="part-work-space">
      <WorkSpaceView space={space} />
      <WorkSpaceHandle
        label={`Work space for question ${numberLabelOf(question)} part ${part.letter}`}
        height={item.parts?.find(({ id }) => id === part.id)?.workSpace?.height ?? space.height}
        onPreview={(height) =>
          setPartPreview(height === null ? null : { partId: part.id, height })}
        onCommit={(height) => onSetWorkSpace([part.id], { height, fill: false })}
      />
    </div>
  )

  const classes = ['exam-question']
  if (selected) classes.push('exam-question--selected')
  if (dragging) classes.push('exam-question--dragging')
  if (dropped) classes.push('exam-question--dropped')
  if (previewHeight !== null || partPreview !== null) classes.push('exam-question--sizing')

  return (
    <section
      className={classes.join(' ')}
      data-question-id={question.id}
      data-drop-target={item.numbered ? question.type : undefined}
      data-drop={dropState ?? undefined}
      {...gesture}
    >
      {item.numbered && (
        <QuestionHandles question={question} onOpenMenu={onOpenMenu} />
      )}
      <QuestionContent
        item={shown}
        showCorrectness
        renderPartWorkSpace={renderPartWorkSpace}
      />
      {item.workSpace && (
        <WorkSpaceHandle
          label={`Work space for question ${numberLabelOf(question)}`}
          height={item.workSpace.height}
          onPreview={setPreviewHeight}
          onCommit={(height) => onSetWorkSpace([question.id], { height, fill: false })}
        />
      )}
    </section>
  )
}

/** Rewords a Question Section's heading on this Exam; `null` restores a part. */
export type SetSectionHeading = (section: QuestionType, change: SectionHeadingChange) => void

// One part of a section heading, typed where it prints. The underline and the
// field are the Exam title's: a transparent line until hover, the accent once
// focused. It is a textarea laid over a hidden copy of its own value, so it
// wraps exactly as the printed text does and the heading keeps the height
// `dom-measure.ts` measured; the text is a single line, so Enter finishes.
function SectionHeadingField({
  label,
  value,
  placeholder,
  disabled,
  onChange,
  onFocusChange,
}: {
  label: string
  value: string
  placeholder: string
  disabled: boolean
  onChange: (value: string) => void
  onFocusChange: (focused: boolean) => void
}) {
  return (
    <span className="section-heading-field" data-value={value || placeholder}>
      <textarea
        aria-label={label}
        className="section-heading-input"
        rows={1}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck
        onChange={(event) => onChange(event.target.value.replace(/\s*\n\s*/g, ' '))}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'Escape') {
            event.preventDefault()
            event.currentTarget.blur()
          }
        }}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
      />
    </span>
  )
}

// A section heading on the sheet, reworded where it prints. A part the teacher
// clears stays open to type into while it has focus, and prints nothing once
// they leave it; a heading cleared of both is kept at no height, with a way to
// bring it back in the page margin, where the question handles sit.
function EditableSectionHeading({
  item,
  edited,
  disabled,
  onChange,
}: {
  item: SectionHeadingItem
  edited: boolean
  disabled: boolean
  onChange: SetSectionHeading
}) {
  const [focused, setFocused] = useState<'title' | 'instructions' | null>(null)
  const focus = (part: 'title' | 'instructions') => (on: boolean) =>
    setFocused((current) => (on ? part : current === part ? null : current))
  const name = SECTION_TITLE[item.section]
  const reset = (
    <div className="section-heading-handles">
      <button
        type="button"
        className="question-handle"
        aria-label={`Restore the ${name} heading`}
        title="Restore the default heading and directions"
        disabled={disabled}
        onClick={() => onChange(item.section, { title: null, instructions: null })}
      >
        <RotateCcw aria-hidden="true" />
      </button>
    </div>
  )
  const showTitle = item.title !== '' || focused === 'title'
  const showInstructions = item.instructions !== '' || focused === 'instructions'
  if (!showTitle && !showInstructions) {
    return <div className="exam-section-hidden">{reset}</div>
  }
  const styles = sectionHeadingStyles(item.size)
  return (
    <header className="exam-section exam-section--editable">
      {edited && reset}
      {showTitle && (
        <h2 className="section-title" style={styles.title}>
          <SectionHeadingField
            label={`${name} heading`}
            value={item.title}
            placeholder={name}
            disabled={disabled}
            onChange={(title) => onChange(item.section, { title })}
            onFocusChange={focus('title')}
          />
        </h2>
      )}
      {showInstructions && (
        <p className="section-instructions" style={styles.instructions}>
          <SectionHeadingField
            label={`${name} directions`}
            value={item.instructions}
            placeholder={SECTION_INSTRUCTIONS[item.section]}
            disabled={disabled}
            onChange={(instructions) => onChange(item.section, { instructions })}
            onFocusChange={focus('instructions')}
          />
        </p>
      )}
    </header>
  )
}

/** Which question an answer-key line belongs to, and whether it is the first or
 *  last of that question's lines on its page — a matching set takes several. */
type AnswerKeyLine = { question: PlannedQuestion; first: boolean; last: boolean }

// An answer-key line on the sheet, as a handle on the question it answers. The
// key is the whole exam in a few lines a page, so it is the quickest place to
// put questions in order: a line picks up, selects and drops exactly as the
// question itself does on the test, within its own Question Section.
function AnswerKeyRow({
  item,
  line,
  selected,
  dragging,
  dropped,
  dropState,
  ...gestureProps
}: QuestionDragHandlers & {
  item: AnswerKeyEntryItem
  line: AnswerKeyLine
  selected: boolean
  dragging: boolean
  dropped: boolean
  dropState: QuestionDropState
  orderedIds: readonly string[]
  selection: Selection
  onEdit: (questionId: string) => void
  onOpenMenu: (questionId: string, point: MenuPoint, side?: MenuSide) => void
}) {
  const gesture = useQuestionGesture({ question: line.question, ...gestureProps })
  const classes = ['answer-key-row']
  if (selected) classes.push('answer-key-row--selected')
  if (dragging) classes.push('answer-key-row--dragging')
  if (dropped) classes.push('answer-key-row--dropped')
  // A set's insertion line is drawn once: above its first line, or below its last.
  const drop =
    (dropState === 'before' && line.first) || (dropState === 'after' && line.last)
      ? dropState
      : undefined
  return (
    <AnswerKeyEntry
      item={item}
      className={classes.join(' ')}
      data-question-id={line.question.id}
      data-drop-target={line.question.type}
      data-drop={drop}
      {...gesture}
    />
  )
}

function PageItemView({
  item,
  orderedIds,
  selection,
  onEdit,
  onOpenMenu,
  onSetWorkSpace,
  draggedQuestionIds,
  droppedQuestionIds,
  dropState,
  onDragStart,
  onDragMove,
  onDrop,
  onDragEnd,
  keyLine,
  onSectionHeadingChange,
  sectionHeadingEdited,
  sectionHeadingDisabled = false,
}: {
  item: PageItem
  /** Present in the editor: rewords a section heading where it prints. */
  onSectionHeadingChange?: SetSectionHeading
  sectionHeadingEdited?: (section: QuestionType) => boolean
  sectionHeadingDisabled?: boolean
  /** The question an answer-key line belongs to, when the test it answers is
   *  on the sheet to be reordered. */
  keyLine?: AnswerKeyLine
  orderedIds: readonly string[]
  selection: Selection
  onEdit: (questionId: string) => void
  onOpenMenu: (questionId: string, point: MenuPoint, side?: MenuSide) => void
  onSetWorkSpace: SetWorkSpace
  draggedQuestionIds: ReadonlySet<string>
  droppedQuestionIds: ReadonlySet<string>
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
      return onSectionHeadingChange ? (
        <EditableSectionHeading
          item={item}
          edited={sectionHeadingEdited?.(item.section) ?? false}
          disabled={sectionHeadingDisabled}
          onChange={onSectionHeadingChange}
        />
      ) : (
        <SectionHeadingContent item={item} />
      )
    case 'question':
      return (
        <QuestionView
          item={item}
          selected={selection.isSelected(item.question.id)}
          orderedIds={orderedIds}
          selection={selection}
          onEdit={onEdit}
          onOpenMenu={onOpenMenu}
          onSetWorkSpace={onSetWorkSpace}
          dragging={draggedQuestionIds.has(item.question.id)}
          dropped={droppedQuestionIds.has(item.question.id) && item.numbered}
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
      if (!keyLine) return <AnswerKeyEntry item={item} />
      return (
        <AnswerKeyRow
          item={item}
          line={keyLine}
          selected={selection.isSelected(keyLine.question.id)}
          orderedIds={orderedIds}
          selection={selection}
          onEdit={onEdit}
          onOpenMenu={onOpenMenu}
          dragging={draggedQuestionIds.has(keyLine.question.id)}
          dropped={droppedQuestionIds.has(keyLine.question.id)}
          dropState={dropState(keyLine.question.id)}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
        />
      )
    default: {
      const unreachable: never = item
      return unreachable
    }
  }
}

/** Each answer-key line on a page, by its index there, with the question it
 *  answers. A line's number is one the test printed, so the question is the one
 *  whose numbers cover it — a matching set covers one per prompt. */
function answerKeyLinesOf(
  items: readonly PageItem[],
  questionByNumber: ReadonlyMap<number, PlannedQuestion>,
): Map<number, AnswerKeyLine> {
  const lines = new Map<number, AnswerKeyLine>()
  const questionAt = (index: number) => {
    const item = items[index]
    return item?.kind === 'answer-key-entry' ? questionByNumber.get(item.number) : undefined
  }
  items.forEach((_, index) => {
    const question = questionAt(index)
    if (!question) return
    lines.set(index, {
      question,
      first: questionAt(index - 1)?.id !== question.id,
      last: questionAt(index + 1)?.id !== question.id,
    })
  })
  return lines
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
export const PAGE_GEOMETRY = {
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
  arrangement: Arrangement,
  workspace: RefObject<HTMLElement | null>,
  selection: ExportContentSelection,
): LayoutPlan {
  const { test, answerKey } = selection
  const [plan, setPlan] = useState<LayoutPlan>(() =>
    planExport({ exam, arrangement, selection, measure: unmeasured }),
  )
  const measured = useRef(false)
  // What the last pagination was for, so this one can tell an edit from a
  // reorder. A `Arrangement` carries an ordering and nothing else, so a change to
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
        arrangement,
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
  }, [exam, arrangement, workspace, test, answerKey, settled])

  // Assets settling is its own concern, and deliberately keyed on the exam
  // rather than the arrangement.
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
// One export is the canonical student test and answer key for one immutable
// Arrangement. This mounts every planned page in preparation order for the internal
// print-reference and preview paths.
//
// It plans nothing. `ExamPage` above paginates what the teacher is editing;
// this draws plans that were already resolved, which is what lets several
// Arrangements print together without any of them being repaginated per format.
// Each document is its own workspace, and print CSS breaks a page between them.
export function ExportPreview({ plan }: { plan: LayoutPlan }) {
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

export function ExamPage({
  exam,
  arrangement,
  selection,
  drag,
  revealQuestionId,
  onRevealed,
  onEdit,
  onDuplicate,
  onShuffleSelected,
  onShuffleSelectedAnswers,
  onRemove,
  onSetColumns,
  onSetWorkSpace,
  onTitleChange,
  onSectionHeadingChange,
  onHeaderChange,
  titleDisabled = false,
  unsavedDraft = false,
  contentSelection = { test: true, answerKey: true },
}: {
  exam: Exam
  arrangement: Arrangement
  selection: Selection
  /** The gesture in flight, coordinated across both panes of the workspace. */
  drag: WorkspaceDrag
  /** A question an authoring action has just put on the Working Copy. It is
   *  scrolled to and briefly highlighted once repagination has actually put it
   *  on a page — which, for an insertion, is not the same moment. */
  revealQuestionId?: string | null
  onRevealed?: () => void
  onEdit: (questionId: string) => void
  onDuplicate: (questionId: string) => void
  onShuffleSelected: (questionIds: readonly string[]) => void
  onShuffleSelectedAnswers: (questionIds: readonly string[]) => void
  onRemove: (questionIds: readonly string[]) => void
  onSetColumns: (questionIds: readonly string[], columns: ColumnSetting) => void
  /** Changes the room left for work below Short Answer questions. */
  onSetWorkSpace: SetWorkSpace
  /** Renames the Exam from its own title line. See `PageHeaderContent`. */
  onTitleChange?: (title: string) => void
  /** Rewords a section heading from where it prints. See `EditableSectionHeading`. */
  onSectionHeadingChange?: SetSectionHeading
  /** Sets the Exam's own page header, or `null` for the default. See
   *  `HeaderEditor`. */
  onHeaderChange?: (header: ExamHeader | null) => void
  titleDisabled?: boolean
  unsavedDraft?: boolean
  contentSelection?: ExportContentSelection
}) {
  const workspace = useRef<HTMLElement | null>(null)
  const blank = exam.questions.length === 0
  const plan = usePaginatedExam(exam, arrangement, workspace, contentSelection)
  const pages = plan.pages
  const orderedIds = orderedQuestionIds(pages)
  const columnSettings = columnSettingsOf(exam)
  const clearOnBackground = clearOnBackgroundClick(selection)
  // Dragging is coordinated above this pane, because one gesture spans both of
  // them: a Question Bank question composed onto the Working Copy starts in the
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
    // The preview is drawn from wherever the gesture started: questions lifted
    // off the sheet look like questions, and lines lifted off the answer key
    // look like lines.
    const drawn = element.classList.contains('answer-key-row')
      ? '.answer-key-row[data-question-id]'
      : '.exam-question[data-question-id]'
    const elements = Array.from(
      workspace.current?.querySelectorAll<HTMLElement>(drawn) ?? [],
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
  // Revealing a question an authoring action has just put on the Working Copy.
  //
  // Insertion and Replace change the exam's *content*, and content changes wait
  // for a pause before the page is measured and packed again. So the question
  // is not on the page in the frame the action was taken — it arrives one
  // repagination later, possibly on a different sheet from the one that was in
  // view. This runs on every plan until the question is actually there, then
  // scrolls to it. Being scrolled to is the whole of the reveal: the question
  // is selected, which is a mark that stays put, and a second mark that faded
  // out over it only made the selection look like it was arriving late.
  useEffect(() => {
    if (!revealQuestionId) return
    const element = workspace.current?.querySelector<HTMLElement>(
      `.exam-question[data-question-id="${CSS.escape(revealQuestionId)}"]`,
    )
    // Not paginated onto a page yet: this effect runs again on the next plan.
    if (!element) return
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    onRevealed?.()
  }, [revealQuestionId, plan, onRevealed])

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
  const sectionHeadingEdited = (section: QuestionType) =>
    sectionHeadingOf(exam.sectionHeadings, section).edited
  const questionByNumber = new Map<number, PlannedQuestion>()
  for (const question of questionsById.values()) {
    for (let offset = 0; offset < numbersTakenBy(question); offset += 1) {
      questionByNumber.set(question.number + offset, question)
    }
  }
  // Which question's menu is open, and where it was raised. Held here rather
  // than per question, so opening one menu closes any other by construction.
  const [menu, setMenu] = useState<{
    questionId: string
    point: MenuPoint
    side: MenuSide
  } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const openMenu = useCallback(
    (questionId: string, point: MenuPoint, side: MenuSide = 'right') => {
      // A menu raised from outside the selection changes the command scope to
      // that question. Raised from inside it, the selection remains intact.
      if (!selection.isSelected(questionId)) selection.select(questionId)
      setMenu({ questionId, point, side })
    },
    [selection],
  )
  // A question deleted while its own menu is open leaves the menu with nothing
  // to act on, so it simply stops being rendered.
  const menuQuestion = menu ? questionsById.get(menu.questionId) : undefined

  // The Question Section a gesture in flight could start, if it is one the Exam
  // Draft has no questions in. A gesture from within the Working Copy is a
  // reorder and can never reach an empty section, so it is offered nothing.
  //
  // The offer is the whole of this pane. An empty section is not drawn on the
  // sheet — a section is derived from the questions in it — so there is no
  // position on the paper to aim at, and every question already on it is of
  // a type the gesture cannot reach. Releasing anywhere over the Working Copy
  // is therefore unambiguous, and asking for a precise landing would only make
  // the teacher hunt for it.
  const emptySectionOffer =
    drag.source?.pane === 'question-bank'
      && !exam.questions.some((question) => question.type === drag.source?.type)
      ? drag.source.type
      : null

  // Which test page's header is open for editing, and which of the Exam's
  // headers that page prints. Editing one later page's header edits them all.
  const [editingHeader, setEditingHeader] = useState<{ pageKey: string; slot: HeaderSlot } | null>(null)
  const finishHeader = useCallback(() => setEditingHeader(null), [])
  const header = exam.header ?? defaultExamHeader()
  const contentSlot = (slot: HeaderSlot): HeaderSlot =>
    slot === 'first' && header.differentFirstPage ? 'first' : 'later'
  const openHeader = (page: PlannedPage) => {
    if (!onHeaderChange || titleDisabled || page.stream !== 'test') return
    setEditingHeader({
      pageKey: `${page.header}-${page.number}`,
      slot: page.header === 'first' ? 'first' : 'later',
    })
  }
  const headerEditorFor = (page: PlannedPage) => {
    if (!onHeaderChange || editingHeader?.pageKey !== `${page.header}-${page.number}`) return undefined
    const slot = contentSlot(editingHeader.slot)
    return (
      <HeaderEditor
        key={slot}
        label={slot === 'first' ? 'First-page header' : header.differentFirstPage ? 'Header on later pages' : 'Header'}
        value={headerContentOf(header, slot)}
        onChange={(content) => onHeaderChange({ ...header, [slot]: content })}
        differentFirstPage={header.differentFirstPage}
        onDifferentFirstPageChange={(different) => onHeaderChange({
          ...header,
          differentFirstPage: different,
          // A first page given its own header starts from the one it had.
          first: different && header.first.length === 0 ? header.later : header.first,
        })}
        onRemove={() => {
          onHeaderChange({ ...header, [slot]: [] })
          finishHeader()
        }}
        onDone={finishHeader}
      />
    )
  }

  // The name is typed once, on the first sheet that prints it. Every later
  // repetition — a continuation page's, the answer key's — is that same name
  // shown again, so it is drawn as text rather than as a second field.
  const titleLine = pages.findIndex((page) => page.furniture.title !== null)
  const workspaceClasses = ['exam-workspace']
  if (unsavedDraft) workspaceClasses.push('exam-workspace--unsaved')
  if (draggedQuestionIds.size > 0) workspaceClasses.push('exam-workspace--dragging')
  if (droppedQuestionIds.size > 0) workspaceClasses.push('exam-workspace--drop-feedback')

  return (
    <main
      className={workspaceClasses.join(' ')}
      ref={workspace}
      style={PAGE_GEOMETRY}
      data-empty-section={emptySectionOffer ?? undefined}
      data-active={drag.intent?.kind === 'insert-first' ? 'true' : undefined}
      onClick={clearOnBackground}
      onPointerMove={() => {
        if (!drag.source && droppedQuestionIds.size > 0) drag.clearDropFeedback()
      }}
    >
      {pages.map((page, index) => {
        const keyLines = answerKeyLinesOf(page.items, questionByNumber)
        return (
          <article
            className="exam-page"
            key={`${page.header}-${page.number}`}
            onClick={clearOnBackground}
            // A header that says nothing takes no room, so the page's top
            // margin is where a double-click brings one back.
            onDoubleClick={(event) => {
              if (event.target !== event.currentTarget) return
              const top = event.currentTarget.getBoundingClientRect().top
              if (event.clientY - top <= PAGE_MARGIN + 12) openHeader(page)
            }}
          >
            <PageHeaderContent
              header={page.header}
              furniture={page.furniture}
              editor={headerEditorFor(page)}
              onDoubleClick={page.stream === 'test' && onHeaderChange
                ? (event) => {
                    // The title is a field of its own: a double-click there
                    // selects a word of it, as it would anywhere else.
                    if ((event.target as HTMLElement).closest('input, textarea')) return
                    openHeader(page)
                  }
                : undefined}
              onTitleChange={index === titleLine ? onTitleChange : undefined}
              titleDisabled={titleDisabled}
            />
            <div className="page-content" onClick={clearOnBackground}>
              {/* An exam with nothing in it yet offers the first question where
                  the first question will go, rather than leaving a blank sheet
                  and a button in the header as the only way in. It is editing
                  chrome: it appears only while the exam is empty, and it is
                  never part of the printed document. It lights up with the
                  pane, which is the drop target; it is not one of its own. */}
              {blank && index === 0 && (
                <div
                  className="secondary-button empty-exam-button"
                  data-active={drag.intent?.kind === 'insert-first' ? 'true' : undefined}
                >
                  Drag or add a Question from an open Question Bank
                </div>
              )}
              {page.items.map((item, itemIndex) => (
                <PageItemView
                  key={keyOf(item)}
                  item={item}
                  keyLine={keyLines.get(itemIndex)}
                onSectionHeadingChange={onSectionHeadingChange}
                sectionHeadingEdited={sectionHeadingEdited}
                sectionHeadingDisabled={titleDisabled}
                  orderedIds={orderedIds}
                  selection={selection}
                  onEdit={onEdit}
                  onOpenMenu={openMenu}
                  onSetWorkSpace={onSetWorkSpace}
                  draggedQuestionIds={draggedQuestionIds}
                  droppedQuestionIds={droppedQuestionIds}
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
        )
      })}

      {/* The first question of a Question Section the exam has started but has
          none of — a Short Answer question dragged at an exam with only
          Multiple Choice ones, say. The whole pane is the target; this is the
          caption that says so, pinned to its foot so it is read however far
          the exam has been scrolled, and never a pixel taken from the paper's
          own geometry.

          An exam with nothing in it at all does not need this: the placeholder
          on the first page already says where the first question goes. */}
      {emptySectionOffer && !blank && (
        <div
          className="exam-draft-empty-section"
          data-active={drag.intent?.kind === 'insert-first' ? 'true' : undefined}
        >
          Drop anywhere to add the first question
        </div>
      )}

      {menu && menuQuestion && (
        <ContextMenu
          point={menu.point}
          side={menu.side}
          ariaLabel={`Question ${numberLabelOf(menuQuestion)} actions`}
          items={questionMenuItems({
            question: menuQuestion,
            columns: columnSettings[menuQuestion.id] ?? DEFAULT_COLUMNS,
            onEdit,
            onDuplicate,
            onShuffleSelected,
            onShuffleSelectedAnswers,
            onRemove,
            onSetColumns,
            workSpace: workSpaceOf(exam, menuQuestion.id),
            workSpaceOfPart: (partId) => workSpaceOf(exam, partId),
            onSetWorkSpace,
            selectedQuestionIds: [...selection.selectedIds],
          })}
          onClose={closeMenu}
        />
      )}
    </main>
  )
}
