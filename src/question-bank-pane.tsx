// The Question Bank, beside the Exam Draft.
//
// A compact, scannable table of the canonical questions a teacher has written,
// newest first, with everything needed to find one and put it on the exam: a
// stem search, Question Type, Difficulty and Topic filters, and a row that
// opens, adds and removes its own question. Where on the exam a question lands
// is said by dragging it there, rather than by a row action reaching for
// whatever happens to be selected on the sheet.
//
// A row is a projection, not a rendering. It shows one line of the stem, the
// classification, and whether the question is on the exam; answer choices and
// correctness stay behind the popup, which remains the only place the whole of
// a question is presented.
//
// Nothing here can Delete Question Content, and nothing here assembles an
// authoring action out of smaller ones: every action calls exactly one of the
// store's operations, so it is one undo step however it was reached. Search,
// filter values and row selection are transient UI state — they are handed in
// rather than stored, and they never enter the authoring history.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, CircleMinus, Pencil, Plus, Search } from 'lucide-react'
import { DifficultyBadge, TopicBadge } from './badges'
import type { MenuPoint } from './context-menu'
import { stemPreview, type StemPreviewBadge } from './stem-preview'
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  SECTION_LABELS,
  SECTION_ORDER,
  topicsOf,
  type Question,
  type QuestionType,
} from './exam'
import type { QuestionBank } from './question-bank'
import type { WorkspaceDrag } from './use-workspace-drag'
import {
  NO_FILTER,
  browseQuestionBank,
  isFilterActive,
  topicOptions,
  type DifficultyFilter,
  type QuestionBankFilter,
} from './question-bank-view'

/** The width the filter list is laid out at, and the gap it keeps from the
 *  window edge. Both are also in the stylesheet; they are here because the
 *  list is placed against the viewport rather than by the cascade. */
const LIST_WIDTH = 190
const MARGIN = 8

const BADGE_LABELS: Record<StemPreviewBadge, string> = {
  image: 'Image',
  math: 'Math',
}

/** What a row with nothing written into it is called. A question saves whether
 *  or not it says anything, so this is a real state rather than a placeholder. */
const UNTITLED = 'Untitled question'

type FilterOption<T extends string> = { value: T; label: string }

/**
 * One filter category: a button that opens a list of the values in it.
 *
 * Every category permits several values, so these are checkboxes rather than a
 * choice — the view combines what is ticked with OR, and combines the
 * categories with AND.
 */
function FilterDropdown<T extends string>({
  label,
  options,
  selected,
  emptyMessage,
  onChange,
}: {
  label: string
  options: readonly FilterOption<T>[]
  selected: readonly T[]
  emptyMessage: string
  onChange: (values: T[]) => void
}) {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  // Where the list sits, in viewport coordinates. The bank scrolls, so a list
  // positioned within it is clipped by the pane it belongs to; anchoring it to
  // the viewport is what lets a list longer than the bank is tall still be
  // read. Measured when it opens, and again if the workspace moves under it.
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)

  const placeList = useCallback(() => {
    const bounds = button.current?.getBoundingClientRect()
    if (!bounds) return
    // The list stays over the bank it belongs to. Past the pane's right edge
    // are the divider and the rendered sheet — a different surface, and a list
    // spilling onto the paper reads as something printed on it.
    const pane = container.current?.closest('.question-bank')?.getBoundingClientRect()
    const limit = (pane?.right ?? window.innerWidth) - MARGIN
    // Right-aligned to the button when a left-aligned list would run past that
    // edge, which is the ordinary case for the filters at the pane's own end.
    const wanted = bounds.left + LIST_WIDTH > limit ? bounds.right - LIST_WIDTH : bounds.left
    setAnchor({
      left: Math.max(MARGIN, Math.min(wanted, limit - LIST_WIDTH)),
      top: bounds.bottom + 4,
    })
  }, [])

  useEffect(() => {
    if (!open) return
    placeList()
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      // The list is portalled out of this element, so "outside" means outside
      // both halves of the control.
      if (container.current?.contains(target) || list.current?.contains(target)) return
      setOpen(false)
    }
    // A scroll or a resize moves the button out from under its own list.
    const reposition = () => placeList()
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open, placeList])

  return (
    <div
      className="bank-filter"
      ref={container}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return
        // Closing the list is the whole of what Escape means while it is open;
        // the workspace listens for the same key to clear its selection.
        event.stopPropagation()
        setOpen(false)
      }}
    >
      <button
        ref={button}
        type="button"
        className="bank-filter-button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="true"
        data-active={selected.length > 0 ? 'true' : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {label}
        {selected.length > 0 && <span className="bank-filter-count">{selected.length}</span>}
      </button>
      {/* Portalled to the body: the bank pane is `position: sticky`, which
          makes it a stacking context, and a list left inside it is painted
          under the divider and the sheet however high its `z-index` is. */}
      {open && anchor && createPortal(
        <div
          className="bank-filter-list"
          ref={list}
          role="group"
          aria-label={label}
          style={{ left: anchor.left, top: anchor.top }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.stopPropagation()
            setOpen(false)
            button.current?.focus()
          }}
        >
          {options.length === 0 ? (
            <p className="bank-filter-empty">{emptyMessage}</p>
          ) : (
            options.map((option) => (
              <label className="bank-filter-option" key={option.value}>
                <input
                  type="checkbox"
                  checked={selected.includes(option.value)}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...selected, option.value]
                        : selected.filter((value) => value !== option.value),
                    )
                  }
                />
                {option.label}
              </label>
            ))
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}

// The fixed Question Sections, in the order the exam prints them.
const TYPE_OPTIONS: FilterOption<QuestionType>[] = SECTION_ORDER.map((type) => ({
  value: type,
  label: SECTION_LABELS[type],
}))

const DIFFICULTY_OPTIONS: FilterOption<DifficultyFilter>[] = [
  ...DIFFICULTIES.map((value) => ({ value, label: DIFFICULTY_LABELS[value] })),
  // Optional classification must never put a question out of reach.
  { value: 'unspecified', label: 'Unspecified' },
]

export function QuestionBankPane({
  bank,
  examDraftIds,
  filter,
  onFilterChange,
  selectedQuestionId,
  onSelect,
  onCreate,
  onEdit,
  onAddToExamDraft,
  onRemoveFromExamDraft,
  drag,
}: {
  bank: QuestionBank
  /** Which bank records the Exam Draft currently references. */
  examDraftIds: ReadonlySet<string>
  filter: QuestionBankFilter
  onFilterChange: (filter: QuestionBankFilter) => void
  /** The row a teacher has clicked, if any. Transient: selecting is not an
   *  authoring action. */
  selectedQuestionId: string | null
  onSelect: (questionId: string) => void
  onCreate: (point: MenuPoint) => void
  onEdit: (questionId: string) => void
  onAddToExamDraft: (questionId: string) => void
  /** Takes the question back off the Exam Draft, leaving its bank record be. */
  onRemoveFromExamDraft: (questionId: string) => void
  /** The gesture in flight. A row that is not already on the Exam Draft is a
   *  drag source for it; a row that is offers no gesture at all, because a
   *  reference occurs at most once and refusing a drop after the fact would be
   *  a worse way to say so. */
  drag: WorkspaceDrag
}) {
  const questions = browseQuestionBank(bank, filter)
  const filtered = isFilterActive(filter)
  // A gesture that has not yet moved far enough to be a drag. One pointer
  // drags at a time, so this is the pane's rather than each row's — and until
  // it passes the threshold a press is still on its way to being a click.
  const gesture = useRef<{
    id: number
    questionId: string
    type: QuestionType
    startX: number
    startY: number
    dragging: boolean
  } | null>(null)
  // The row whose next click is the tail of a drag rather than a selection.
  // Kept as an id rather than a flag, and given up on its own, so a click that
  // never arrives — a row remounted under the pointer, a capture lost on a path
  // nobody has thought of — cannot leave the whole bank unclickable.
  const suppressClickFor = useRef<string | null>(null)

  const forgetSuppressedClick = () => {
    setTimeout(() => {
      suppressClickFor.current = null
    }, 0)
  }

  const releasePointer = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  /** The pointer handlers a row that is not on the Exam Draft carries. A row
   *  that is carries none: it has nowhere to be dropped. */
  const dragHandlers = (question: Question) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      const target = event.target as HTMLElement
      if (target.closest('button, input, textarea, select, a')) return
      gesture.current = {
        id: event.pointerId,
        questionId: question.id,
        type: question.type,
        startX: event.clientX,
        startY: event.clientY,
        dragging: false,
      }
      suppressClickFor.current = null
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const held = gesture.current
      if (!held || held.id !== event.pointerId) return
      if (!held.dragging) {
        const distance = Math.hypot(
          event.clientX - held.startX,
          event.clientY - held.startY,
        )
        if (distance < 5) return
        held.dragging = true
        suppressClickFor.current = held.questionId
        drag.begin(
          { pane: 'question-bank', questionId: held.questionId, type: held.type },
          {
            elements: [event.currentTarget],
            bounds: event.currentTarget.getBoundingClientRect(),
            point: { x: held.startX, y: held.startY },
          },
        )
      }
      event.preventDefault()
      drag.move({ x: event.clientX, y: event.clientY })
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      const held = gesture.current
      if (!held || held.id !== event.pointerId) return
      gesture.current = null
      releasePointer(event)
      if (!held.dragging) return
      event.preventDefault()
      drag.drop()
      // The click this press is about to raise is the one to swallow. A timer
      // rather than a flag left standing: click is dispatched before timers, so
      // this runs after the click that is coming and nothing survives it.
      forgetSuppressedClick()
    },
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => {
      const held = gesture.current
      if (!held || held.id !== event.pointerId) return
      gesture.current = null
      releasePointer(event)
      if (held.dragging) {
        suppressClickFor.current = null
        drag.cancel()
      }
    },
    onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => {
      const held = gesture.current
      if (!held || held.id !== event.pointerId) return
      gesture.current = null
      if (held.dragging) {
        suppressClickFor.current = null
        drag.cancel()
      }
    },
  })

  return (
    <section className="question-bank" aria-label="Question Bank">
      <header className="question-bank-header">
        <h2>Question Bank</h2>
        <div className="question-bank-header-actions">
          <button
            type="button"
            className="secondary-button"
            aria-haspopup="menu"
            onClick={(event) => {
              // Below the button and aligned with it, so the list of types
              // reads as belonging to the control that asked for it.
              const bounds = event.currentTarget.getBoundingClientRect()
              onCreate({ x: bounds.left, y: bounds.bottom + 4 })
            }}
          >
            <Plus />
            New question
          </button>
        </div>
      </header>

      <div className="question-bank-filters">
        <div className="bank-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            aria-label="Search question stems"
            placeholder="Search questions"
            value={filter.search}
            onChange={(event) => onFilterChange({ ...filter, search: event.target.value })}
          />
        </div>
        <FilterDropdown
          label="Question Type"
          options={TYPE_OPTIONS}
          selected={filter.types}
          emptyMessage="No Question Types"
          onChange={(types) => onFilterChange({ ...filter, types })}
        />
        <FilterDropdown
          label="Difficulty"
          options={DIFFICULTY_OPTIONS}
          selected={filter.difficulties}
          emptyMessage="No Difficulties"
          onChange={(difficulties) => onFilterChange({ ...filter, difficulties })}
        />
        {/* The Topics actually in the bank, exactly as they were typed. There is
            no vocabulary to offer beyond what the teacher has already used. */}
        <FilterDropdown
          label="Topic"
          options={topicOptions(bank).map((topic) => ({ value: topic, label: topic }))}
          selected={filter.topics}
          emptyMessage="No Topics yet"
          onChange={(topics) => onFilterChange({ ...filter, topics })}
        />
        {filtered && (
          <button
            type="button"
            className="bank-filter-clear"
            onClick={() => onFilterChange(NO_FILTER)}
          >
            Clear filters
          </button>
        )}
      </div>

      {questions.length === 0 ? (
        // Two different nothings: a bank nobody has written into yet, and a
        // bank whose questions are all behind the current search.
        filtered ? (
          <p className="question-bank-empty" data-empty="no-matches">
            No questions match this search and these filters. Clear filters shows
            the whole Question Bank again.
          </p>
        ) : (
          <p className="question-bank-empty" data-empty="no-questions">
            No questions yet. New question writes one into the bank without
            putting it on the exam.
          </p>
        )
      ) : (
        <ul className="question-bank-list">
          {questions.map((question) => {
            const inExamDraft = examDraftIds.has(question.id)
            const preview = stemPreview(question)
            const name = preview.text || UNTITLED
            const topics = topicsOf(question)
            return (
              <li
                className="question-bank-row"
                key={question.id}
                data-question-id={question.id}
                data-in-exam={inExamDraft ? 'true' : undefined}
                // An unused row is a drag source; a row already on the Exam
                // Draft is not one, and says so before the gesture starts.
                data-draggable={inExamDraft ? undefined : 'true'}
                data-dragging={
                  drag.source?.pane === 'question-bank'
                  && drag.source.questionId === question.id
                    ? 'true'
                    : undefined
                }
                aria-current={selectedQuestionId === question.id ? 'true' : undefined}
                tabIndex={0}
                {...(inExamDraft ? {} : dragHandlers(question))}
                onClick={() => {
                  // The press that has just finished dragging is not a click —
                  // that press, on that row, and no other click anywhere.
                  if (suppressClickFor.current === question.id) {
                    suppressClickFor.current = null
                    return
                  }
                  onSelect(question.id)
                }}
                // Single-click selects, so opening the whole question needs a
                // second click, the Enter key, or the Edit action.
                onDoubleClick={() => onEdit(question.id)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.target !== event.currentTarget) return
                  event.preventDefault()
                  onEdit(question.id)
                }}
              >
                <div className="question-bank-row-content">
                  <span className="question-bank-row-meta">
                    <span className="question-bank-row-type">
                      {SECTION_LABELS[question.type]}
                    </span>
                    {question.difficulty && (
                      <DifficultyBadge difficulty={question.difficulty} />
                    )}
                    {inExamDraft && (
                      <span className="question-bank-row-badge">In exam</span>
                    )}
                  </span>
                  <span className="question-bank-row-stem">
                    <span className="question-bank-row-line">{name}</span>
                    {preview.badges.map((badge) => (
                      <span className="question-bank-row-content-badge" key={badge}>
                        {BADGE_LABELS[badge]}
                      </span>
                    ))}
                  </span>
                  {topics.length > 0 && (
                    <span className="question-bank-row-topics">
                      {topics.map((topic) => (
                        <TopicBadge topic={topic} key={topic} />
                      ))}
                    </span>
                  )}
                </div>
                <div
                  className="question-bank-row-actions"
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    className="question-bank-action"
                    aria-label={`Edit ${name}`}
                    title="Edit"
                    onClick={() => onEdit(question.id)}
                  >
                    <Pencil />
                  </button>
                  {/* A question already on the Exam Draft offers no way onto it
                      a second time — a reference occurs at most once — so the
                      plus becomes a tick: the same slot answers "can I add
                      this?" and "is it already on?". Reaching for it is the
                      one thing a teacher could still want from that slot, so
                      under the cursor the tick becomes the minus that takes
                      the question back off the exam. */}
                  {inExamDraft ? (
                    <button
                      type="button"
                      className="question-bank-action question-bank-included"
                      aria-label={`Remove ${name} from the exam`}
                      title="Remove from the exam"
                      onClick={() => onRemoveFromExamDraft(question.id)}
                    >
                      <Check className="question-bank-included-resting" />
                      <CircleMinus className="question-bank-included-hover" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="question-bank-action"
                      aria-label={`Add ${name} to the exam`}
                      title="Add to the exam"
                      onClick={() => onAddToExamDraft(question.id)}
                    >
                      <Plus />
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
