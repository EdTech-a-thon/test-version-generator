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
  WorkSpaceView,
  type IdentityLineEditor,
} from './page-item-view'
import { headerLineOf, type HeaderLine } from './page-header'
import { pageContentStyle } from './export-typography'
import {
  FOOTER_HEIGHT,
  MAX_WORK_SPACE_HEIGHT,
  HEADER_HEIGHT,
  PAGE_HEIGHT,
  PAGE_MARGIN,
  PAGE_WIDTH,
  numberLabelOf,
  planExport,
  unmeasured,
  type ExportContentSelection,
  type LayoutPlan,
  type PageHeader,
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
  questionsInSection,
  sectionsOf,
  workSpaceOf,
  type ColumnSetting,
  type Exam,
  type Arrangement,
  type WorkSpace,
} from './exam'
import type { Selection } from './use-selection'
import type { SectionHeadingChange } from './section-headings'
import { sectionHeadingStyles } from './export-typography'
import type { WorkspaceDrag } from './use-workspace-drag'
import { dropStateOf, type QuestionDropState } from './workspace-drag'
import {
  AlignJustify,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  Ban,
  CircleMinus,
  Copy,
  EllipsisVertical,
  ListRestart,
  Pencil,
  PencilLine,
  Heading,
  Shuffle,
  SquareDashed,
  X,
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

// A question on the page, or the piece of one this page carries: the same
// content `dom-measure.ts` measured, wrapped in the chrome that makes it
// selectable, editable and droppable. A continued piece is chrome-free — its
// handles, and everything they do, belong to the piece that carries the
// question's number.
function QuestionView({
  item,
  sectionId,
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
  /** The Question Section this question is in, which a gesture reads. */
  sectionId: string
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
  const pointerDrag = useRef<{
    id: number
    startX: number
    startY: number
    dragging: boolean
  } | null>(null)
  const suppressClick = useRef(false)
  const question = item.question
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

  const releasePointer = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const classes = ['exam-question']
  if (selected) classes.push('exam-question--selected')
  if (dragging) classes.push('exam-question--dragging')
  if (dropped) classes.push('exam-question--dropped')
  if (previewHeight !== null || partPreview !== null) classes.push('exam-question--sizing')

  return (
    <section
      className={classes.join(' ')}
      data-question-id={question.id}
      data-section-id={sectionId}
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

/** How long after a Section is moved from its controls the sheet keeps its
 *  controls where they were, through each pass of repagination. */
const MOVE_ANCHOR_MS = 1200

/** How far above its heading a Section's band — its dashed rule, and its
 *  highlight — begins. A band runs from there to where the next Section's
 *  begins, so the rules of neighbouring Sections fall on the same line. */
const SECTION_RULE_OFFSET = 9

/** How far a Section's highlight reaches below the last piece on a sheet when
 *  no Section follows it there. */
const SECTION_BAND_BLEED = 12

/** One sheet's stretch of a Section, as drawn: from its sheet's top edge, for
 *  the highlight, and from the workspace's, for the controls in the gutter. */
type SectionBand = {
  sectionId: string
  pageIndex: number
  topInPage: number
  height: number
  top: number
  bottom: number
  pageLeft: number
}

function sameBand(left: SectionBand, right: SectionBand): boolean {
  return (
    left.sectionId === right.sectionId
    && left.pageIndex === right.pageIndex
    && left.top === right.top
    && left.bottom === right.bottom
    && left.pageLeft === right.pageLeft
  )
}

/** A new-Section target a gesture has opened: the Section it opened beneath,
 *  and whether the pointer is over it, which is when a release makes one. */
type NewSectionTargetState = { afterSectionId: string; armed: boolean }

// The target that makes a new Question Section, opened beneath the foot of a
// Section once a gesture's line has rested there. It opens in the sheet's flow,
// between this Section and the next, pushing the next Section's dashed rule
// down to make room, and says what a release over it does before it does it.
function NewSectionTarget({ afterSectionId, armed }: NewSectionTargetState) {
  return (
    <div
      className="new-section-target"
      data-new-section-after={afterSectionId}
      data-active={armed ? 'true' : undefined}
      aria-hidden="true"
    >
      Drop here to create a new section
    </div>
  )
}

/** Rewords a Question Section's heading on this Exam; `null` restores a part. */
export type SetSectionHeading = (sectionId: string, change: SectionHeadingChange) => void

/** What a Question Section's own controls do: move it past a neighbour, or
 *  delete it and Remove its questions. */
export type SectionControls = {
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (direction: -1 | 1) => void
  onDelete: () => void
}

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
  autoFocus = false,
  onChange,
  onFocusChange,
}: {
  label: string
  value: string
  placeholder: string
  disabled: boolean
  /** Focused as it appears: what bringing a cleared heading back does. */
  autoFocus?: boolean
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
        autoFocus={autoFocus}
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
// they leave it; a heading cleared of both is kept at no height, and the
// Section's controls in the gutter beside the sheet can give it one again.
function EditableSectionHeading({
  item,
  disabled,
  onChange,
  emptyActive,
  newSectionTarget,
  revealTitle,
  onRevealed,
}: {
  item: SectionHeadingItem
  disabled: boolean
  onChange: SetSectionHeading
  /** For an empty Section: whether a gesture would land in it. */
  emptyActive: boolean
  newSectionTarget: NewSectionTargetState | null
  /** Asked, from the Section's controls, to open its cleared heading. */
  revealTitle: boolean
  onRevealed: () => void
}) {
  const [focused, setFocused] = useState<'title' | 'instructions' | null>(null)
  const focus = (part: 'title' | 'instructions') => (on: boolean) => {
    if (on && part === 'title') onRevealed()
    setFocused((current) => (on ? part : current === part ? null : current))
  }
  const showTitle = item.title !== '' || focused === 'title' || revealTitle
  const showInstructions = item.instructions !== '' || focused === 'instructions'
  // An empty Section prints just its heading, so at rest that is all the sheet
  // draws of it, and its heading is where a gesture drops into it. While a
  // gesture is aimed at it, a box opens in the sheet's flow below the heading,
  // pushing what follows down, to show where the questions will go.
  const emptyMarks = item.empty
    ? { 'data-empty-section': '', 'data-section-id': item.sectionId }
    : {}
  const hint = item.empty && emptyActive && (
    <div className="exam-section-empty-drop" data-active="true" {...emptyMarks}>
      Drag questions here
    </div>
  )
  const opened = newSectionTarget && <NewSectionTarget {...newSectionTarget} />
  if (!showTitle && !showInstructions) {
    return (
      <>
        <div className="exam-section-hidden" {...emptyMarks} data-section-id={item.sectionId} />
        {hint}
        {opened}
      </>
    )
  }
  const styles = sectionHeadingStyles(item.size)
  return (
    <>
    <header
      className="exam-section exam-section--editable"
      {...emptyMarks}
      data-section-id={item.sectionId}
    >
      {showTitle && (
        <h2 className="section-title" style={styles.title}>
          <SectionHeadingField
            label="Section heading"
            value={item.title}
            placeholder="Section heading"
            disabled={disabled}
            autoFocus={revealTitle}
            onChange={(title) => onChange(item.sectionId, { title })}
            onFocusChange={focus('title')}
          />
        </h2>
      )}
      {showInstructions && (
        <p className="section-instructions" style={styles.instructions}>
          <SectionHeadingField
            label="Section directions"
            value={item.instructions}
            placeholder="Directions"
            disabled={disabled}
            onChange={(instructions) => onChange(item.sectionId, { instructions })}
            onFocusChange={focus('instructions')}
          />
        </p>
      )}
    </header>
    {hint}
    {opened}
    </>
  )
}

// The controls of the Section the pointer is in — anywhere across its rows, on
// the paper or beside it — drawn in the gutter to the left of the sheet, at the
// top of that Section's stretch of the sheet. Pointing at them highlights the
// Section they act on.
function SectionRail({
  controls,
  hidden,
  disabled,
  style,
  onRevealTitle,
  onHover,
}: {
  controls: SectionControls
  /** Whether the Section's heading is cleared, which offers one again. */
  hidden: boolean
  disabled: boolean
  style: CSSProperties
  onRevealTitle: () => void
  onHover: (on: boolean) => void
}) {
  return (
    <div
      className="section-rail"
      style={style}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
    >
      {hidden && (
        <button
          type="button"
          className="question-handle"
          aria-label="Add a section heading"
          title="Add a heading"
          disabled={disabled}
          onClick={onRevealTitle}
        >
          <Heading aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        className="question-handle"
        aria-label="Move section up"
        title="Move section up"
        disabled={disabled || !controls.canMoveUp}
        onClick={() => controls.onMove(-1)}
      >
        <ArrowUp aria-hidden="true" />
      </button>
      <button
        type="button"
        className="question-handle"
        aria-label="Move section down"
        title="Move section down"
        disabled={disabled || !controls.canMoveDown}
        onClick={() => controls.onMove(1)}
      >
        <ArrowDown aria-hidden="true" />
      </button>
      <button
        type="button"
        className="question-handle"
        aria-label="Delete section"
        title="Delete section and remove its questions"
        disabled={disabled}
        onClick={controls.onDelete}
      >
        <X aria-hidden="true" />
      </button>
    </div>
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
  onSectionHeadingChange,
  sectionHeadingDisabled = false,
  sectionIdOf,
  newSectionTarget,
  emptySectionActive,
  revealTitleOf,
  onTitleRevealed,
}: {
  item: PageItem
  /** Present in the editor: rewords a section heading where it prints. */
  onSectionHeadingChange?: SetSectionHeading
  sectionHeadingDisabled?: boolean
  /** The Section whose cleared heading its controls asked to open, if any. */
  revealTitleOf: string | null
  onTitleRevealed: () => void
  /** The Section each question on the sheet is in. */
  sectionIdOf: (questionId: string) => string
  /** The new-Section target a gesture has opened beneath this item, if any. */
  newSectionTarget: (item: PageItem) => NewSectionTargetState | null
  /** Whether a gesture would land in this empty Section. */
  emptySectionActive: (sectionId: string) => boolean
  orderedIds: readonly string[]
  selection: Selection
  onEdit: (questionId: string) => void
  onOpenMenu: (questionId: string, point: MenuPoint, side?: MenuSide) => void
  onSetWorkSpace: SetWorkSpace
  draggedQuestionIds: ReadonlySet<string>
  droppedQuestionIds: ReadonlySet<string>
  dropState: (item: QuestionItem) => QuestionDropState
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
          disabled={sectionHeadingDisabled}
          onChange={onSectionHeadingChange}
          emptyActive={emptySectionActive(item.sectionId)}
          newSectionTarget={newSectionTarget(item)}
          revealTitle={revealTitleOf === item.sectionId}
          onRevealed={onTitleRevealed}
        />
      ) : (
        <SectionHeadingContent item={item} />
      )
    case 'question': {
      const target = newSectionTarget(item)
      return (
        <>
        <QuestionView
          item={item}
          sectionId={sectionIdOf(item.question.id)}
          selected={selection.isSelected(item.question.id)}
          orderedIds={orderedIds}
          selection={selection}
          onEdit={onEdit}
          onOpenMenu={onOpenMenu}
          onSetWorkSpace={onSetWorkSpace}
          dragging={draggedQuestionIds.has(item.question.id)}
          dropped={droppedQuestionIds.has(item.question.id) && item.numbered}
          dropState={dropState(item)}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
        />
        {target && <NewSectionTarget {...target} />}
        </>
      )
    }
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
      return `heading-${item.sectionId}`
    case 'question':
      // A split question never has two of its pieces on one page, so its id is
      // still unique within the page that keys by it.
      return `question-${item.question.id}`
    case 'answer-key-heading':
      return 'answer-key-heading'
    case 'answer-key-section':
      return `answer-key-section-${item.sectionId}`
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
          <div className="page-content" style={pageContentStyle(plan.textSize)}>
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
  onMoveSection,
  onDeleteSection,
  onHeaderLineChange,
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
  /** Moves a Question Section past its neighbour. */
  onMoveSection?: (sectionId: string, direction: -1 | 1) => void
  /** Deletes a Question Section and Removes its questions. */
  onDeleteSection?: (sectionId: string) => void
  /** Rewords a test page's header line; `null` restores its default. */
  onHeaderLineChange?: (line: HeaderLine, text: string | null) => void
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
  // The page order when a reorder was lifted. See the landing effect below.
  const orderAtLift = useRef<string | null>(null)
  const beginDrag = useCallback((
    question: PlannedQuestion,
    element: HTMLElement,
    point: { x: number; y: number },
  ) => {
    const ids = selection.isSelected(question.id)
      ? [...new Set(orderedIds.filter((id) => selection.isSelected(id)))]
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
    orderAtLift.current = orderedIds.join('\n')
    drag.begin(
      { pane: 'exam-draft', questionIds: ids, type: question.type },
      { elements, bounds: element.getBoundingClientRect(), point },
    )
  }, [drag, orderedIds, selection])

  // A question split across sheets draws its line above on its first piece and
  // its line below on its last, which is where the drop would actually land.
  const piecesOf = new Map<string, { first: QuestionItem; last: QuestionItem }>()
  for (const item of pages.flatMap((page) => page.items)) {
    if (item.kind !== 'question') continue
    const pieces = piecesOf.get(item.question.id)
    if (pieces) pieces.last = item
    else piecesOf.set(item.question.id, { first: item, last: item })
  }
  const questionDropState = (item: QuestionItem): QuestionDropState => {
    const state = dropStateOf(drag.intent, item.question.id)
    const pieces = piecesOf.get(item.question.id)
    if (state === 'before') return pieces?.first === item ? state : null
    if (state === 'after') return pieces?.last === item ? state : null
    return null
  }

  // Following a reordered question to where it landed.
  //
  // A drop lands at the nearest legal line, which need not be anywhere near
  // the pointer — a question flicked into another section goes to the edge of
  // its own, perhaps sheets away. A reorder repaginates in the same frame, but
  // the commit that records the drop is still drawing the old order, so this
  // waits until the page order has actually changed from the one the gesture
  // lifted, then scrolls the moved question into view. A drop that moved
  // nothing never changes the order, and scrolls nowhere.
  useLayoutEffect(() => {
    if (droppedQuestionIds.size === 0 || orderAtLift.current === null) return
    if (orderedIds.join('\n') === orderAtLift.current) return
    orderAtLift.current = null
    const moved = orderedIds.find((id) => droppedQuestionIds.has(id))
    if (!moved) return
    workspace.current
      ?.querySelector<HTMLElement>(`.exam-question[data-question-id="${CSS.escape(moved)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [plan, droppedQuestionIds, orderedIds])

  // Revealing a question an authoring action has just put on the Working Copy.
  //
  // Insertion changes the exam's *content*, and content changes wait
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
  // The Exam's Sections, and the one each question is in: what a Section's
  // controls, and a gesture reading the sheet, both need.
  const sections = sectionsOf(exam)
  const sectionOfQuestion = new Map(
    sections.flatMap((section) =>
      questionsInSection(exam, arrangement, section.id).map(({ id }) => [id, section.id] as const),
    ),
  )
  const sectionIdOf = (questionId: string) => sectionOfQuestion.get(questionId) ?? ''
  // Where each Section is drawn: one band per sheet it appears on, across the
  // paper's whole width, from just above its heading — its dashed rule — to
  // where the next Section begins, or just below its last piece. Read off the
  // rendered pieces, since a Section may run across several sheets and the
  // plan knows nothing of where they are drawn. Each band is kept both from
  // its sheet's top edge, for the highlight drawn on the sheet, and from the
  // workspace's, for the controls drawn in the gutter beside it.
  const [sectionBands, setSectionBands] = useState<SectionBand[]>([])
  const measureSectionBands = useCallback(() => {
    const root = workspace.current
    if (!root) return
    const origin = root.getBoundingClientRect()
    const bands: SectionBand[] = []
    root.querySelectorAll<HTMLElement>('.exam-page').forEach((page, pageIndex) => {
      const sheet = page.getBoundingClientRect()
      const spans = new Map<string, { top: number; bottom: number }>()
      for (const piece of page.querySelectorAll<HTMLElement>(
        '.page-content [data-section-id]',
      )) {
        const id = piece.dataset.sectionId!
        const box = piece.getBoundingClientRect()
        const span = spans.get(id)
        if (span) {
          span.top = Math.min(span.top, box.top)
          span.bottom = Math.max(span.bottom, box.bottom)
        } else {
          spans.set(id, { top: box.top, bottom: box.bottom })
        }
      }
      const onSheet = [...spans].sort(([, a], [, b]) => a.top - b.top)
      onSheet.forEach(([sectionId, span], index) => {
        const top = span.top - SECTION_RULE_OFFSET
        const next = onSheet[index + 1]
        const bottom = next ? next[1].top - SECTION_RULE_OFFSET : span.bottom + SECTION_BAND_BLEED
        bands.push({
          sectionId,
          pageIndex,
          topInPage: top - sheet.top,
          height: bottom - top,
          top: top - origin.top,
          bottom: bottom - origin.top,
          pageLeft: sheet.left - origin.left,
        })
      })
    })
    setSectionBands((current) =>
      current.length === bands.length
      && current.every((band, index) => sameBand(band, bands[index]!))
        ? current
        : bands,
    )
  }, [])
  useLayoutEffect(measureSectionBands, [measureSectionBands, plan, drag.intent])
  useEffect(() => {
    window.addEventListener('resize', measureSectionBands)
    return () => window.removeEventListener('resize', measureSectionBands)
  }, [measureSectionBands])
  // The Section band the pointer is in, anywhere across its rows — never while
  // a gesture is in flight, which has its own feedback to give.
  const [pointedBand, setPointedBand] = useState<SectionBand | null>(null)
  // A Section just moved from its controls: where its band was, and where on
  // screen. Once the sheet has repaginated, the Exam is scrolled so its band —
  // and its controls — are back where they were, under a pointer that has not
  // moved, ready to be pressed again.
  //
  // A move repaginates in more than one pass — once at once, and again as
  // what it moved is measured afresh — so the Exam is scrolled back into place
  // after every pass that moves the Section, for as long as the move is recent.
  const moveAnchor = useRef<{
    sectionId: string
    from: SectionBand
    screenTop: number
    until: number
  } | null>(null)
  useLayoutEffect(() => {
    const anchor = moveAnchor.current
    const root = workspace.current
    if (!anchor || !root) return
    if (performance.now() > anchor.until) {
      moveAnchor.current = null
      return
    }
    const band = sectionBands.find(({ sectionId }) => sectionId === anchor.sectionId)
    if (!band || sameBand(band, anchor.from)) return
    anchor.from = band
    const lane = root.closest('.editor-output')
    const scroller =
      lane && /auto|scroll/.test(getComputedStyle(lane).overflowY)
        ? lane
        : document.scrollingElement
    if (scroller) {
      scroller.scrollTop += root.getBoundingClientRect().top + band.top - anchor.screenTop
    }
    setPointedBand(band)
  }, [sectionBands])
  const pointAt = (clientY: number, target: EventTarget | null) => {
    // Over the controls themselves, they stay with their Section, however
    // short it is: reaching down to delete an empty Section must not pass
    // into the next one first.
    if (target instanceof Element && target.closest('.section-rail')) return
    const origin = workspace.current?.getBoundingClientRect()
    if (!origin || drag.source) return setPointedBand(null)
    const y = clientY - origin.top
    const band = sectionBands.find(({ top, bottom }) => y >= top && y < bottom) ?? null
    setPointedBand((current) => (current && band && sameBand(current, band) ? current : band))
  }
  // The Section pointed at through its controls, whose every band is
  // highlighted so the teacher sees what they would move or delete. Editing
  // its heading highlights nothing.
  const [hoveredSectionId, setHoveredSectionId] = useState<string | null>(null)
  const highlightedSectionId = drag.source ? null : hoveredSectionId
  // A cleared heading its controls asked to open, until its field has focus.
  const [revealTitleOf, setRevealTitleOf] = useState<string | null>(null)
  const sectionControls =
    onMoveSection && onDeleteSection
      ? (sectionId: string): SectionControls => {
          const index = sections.findIndex(({ id }) => id === sectionId)
          return {
            canMoveUp: index > 0,
            canMoveDown: index >= 0 && index < sections.length - 1,
            onMove: (direction) => {
              // Where this Section's controls are on screen now, so the sheet
              // can be scrolled to put them back there once it has moved.
              const band = pointedBand?.sectionId === sectionId ? pointedBand : null
              const origin = workspace.current?.getBoundingClientRect()
              moveAnchor.current = band && origin
                ? {
                    sectionId,
                    from: band,
                    screenTop: origin.top + band.top,
                    until: performance.now() + MOVE_ANCHOR_MS,
                  }
                : null
              onMoveSection(sectionId, direction)
            },
            onDelete: () => onDeleteSection(sectionId),
          }
        }
      : undefined
  // Where a gesture has opened a new-Section target: beneath the last piece of
  // the last question of that Section it is not carrying — or, for an empty
  // Section, beneath its box.
  const opensBelow = drag.intent?.opensBelow ?? null
  const armed = drag.intent?.kind === 'new-section' && drag.intent.armed
  const footQuestionId = opensBelow
    ? orderedIds
        .filter((id) => sectionOfQuestion.get(id) === opensBelow && !draggedQuestionIds.has(id))
        .at(-1) ?? null
    : null
  const newSectionTarget = (item: PageItem): NewSectionTargetState | null => {
    if (!opensBelow) return null
    const target: NewSectionTargetState = { afterSectionId: opensBelow, armed }
    // An empty Section never has a new Section opened beneath it.
    if (item.kind === 'section-heading') return null
    if (item.kind !== 'question' || item.question.id !== footQuestionId) return null
    return piecesOf.get(item.question.id)?.last === item ? target : null
  }
  const emptySectionActive = (sectionId: string) =>
    drag.intent?.kind === 'section-end' && drag.intent.sectionId === sectionId
  // An Exam with nothing on it yet: the whole pane is the target, and the
  // first question starts its first Section.
  const startsFirstSection =
    drag.intent?.kind === 'new-section' && drag.intent.afterSectionId === null
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

  // The name is typed once, on the first sheet that prints it. Every later
  // repetition — a continuation page's, the answer key's — is that same name
  // shown again, so it is drawn as text rather than as a second field.
  const titleLine = pages.findIndex((page) => page.furniture.title !== null)
  // Every test page's header line can be typed on, and every later page shows
  // the one later line: they are the same words printed again.
  const identityEditorFor = (header: PageHeader): IdentityLineEditor | undefined => {
    if (!onHeaderLineChange || (header !== 'first' && header !== 'later')) return undefined
    return {
      text: headerLineOf(exam.header, header),
      edited: exam.header?.[header] !== undefined,
      disabled: titleDisabled,
      onChange: (text) => onHeaderLineChange(header, text),
    }
  }
  const workspaceClasses = ['exam-workspace']
  if (unsavedDraft) workspaceClasses.push('exam-workspace--unsaved')
  if (draggedQuestionIds.size > 0) workspaceClasses.push('exam-workspace--dragging')
  if (droppedQuestionIds.size > 0) workspaceClasses.push('exam-workspace--drop-feedback')

  return (
    <main
      className={workspaceClasses.join(' ')}
      ref={workspace}
      style={PAGE_GEOMETRY}
      data-drop-zone=""
      data-active={startsFirstSection ? 'true' : undefined}
      onClick={clearOnBackground}
      onPointerMove={(event) => {
        if (!drag.source && droppedQuestionIds.size > 0) drag.clearDropFeedback()
        pointAt(event.clientY, event.target)
      }}
      onPointerLeave={() => setPointedBand(null)}
    >
      {pages.map((page, index) => (
        <article
          className="exam-page"
          key={`${page.header}-${page.number}`}
          onClick={clearOnBackground}
        >
          {sectionBands
            .filter((band) => band.pageIndex === index && band.sectionId === highlightedSectionId)
            .map((band) => (
              <div
                key={band.sectionId}
                className="section-highlight"
                style={{ top: band.topInPage, height: band.height }}
                aria-hidden="true"
              />
            ))}
          {/* The Section the pointer is in is marked off by a dashed rule above
              and below its stretch of each sheet, while its controls show. */}
          {pointedBand && !drag.source && sectionBands
            .filter((band) => band.pageIndex === index && band.sectionId === pointedBand.sectionId)
            .flatMap((band) => [
              <div
                key={`${band.sectionId}-top`}
                className="section-rule"
                style={{ top: band.topInPage }}
                aria-hidden="true"
              />,
              <div
                key={`${band.sectionId}-bottom`}
                className="section-rule"
                style={{ top: band.topInPage + band.height }}
                aria-hidden="true"
              />,
            ])}
          <PageHeaderContent
            header={page.header}
            furniture={page.furniture}
            identityEditor={identityEditorFor(page.header)}
            onTitleChange={index === titleLine ? onTitleChange : undefined}
            titleDisabled={titleDisabled}
          />
          <div
            className="page-content"
            style={pageContentStyle(plan.textSize)}
            onClick={clearOnBackground}
          >
            {/* An exam with nothing in it yet offers the first question where
                the first question will go, rather than leaving a blank sheet
                and a button in the header as the only way in. It is editing
                chrome: it appears only while the exam is empty, and it is
                never part of the printed document. It lights up with the
                pane, which is the drop target; it is not one of its own. */}
            {blank && index === 0 && (
              <div
                className="secondary-button empty-exam-button"
                data-active={startsFirstSection ? 'true' : undefined}
              >
                Drag or add a Question from an open Question Bank
              </div>
            )}
            {page.items.map((item) => (
              <PageItemView
                key={keyOf(item)}
                item={item}
                onSectionHeadingChange={onSectionHeadingChange}
                revealTitleOf={revealTitleOf}
                onTitleRevealed={() => setRevealTitleOf(null)}
                sectionHeadingDisabled={titleDisabled}
                sectionIdOf={sectionIdOf}
                newSectionTarget={newSectionTarget}
                emptySectionActive={emptySectionActive}
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
      ))}

      {pointedBand && sectionControls && !drag.source && (
        <SectionRail
          controls={sectionControls(pointedBand.sectionId)}
          hidden={(() => {
            const section = sections.find(({ id }) => id === pointedBand.sectionId)
            return !!section && section.title === '' && section.instructions === ''
          })()}
          disabled={titleDisabled}
          style={{ top: pointedBand.top + SECTION_RULE_OFFSET, left: pointedBand.pageLeft }}
          onRevealTitle={() => setRevealTitleOf(pointedBand.sectionId)}
          onHover={(on) => setHoveredSectionId(on ? pointedBand.sectionId : null)}
        />
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
