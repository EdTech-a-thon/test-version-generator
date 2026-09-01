// The Question Bank, beside the Exam Draft.
//
// A compact, scannable table of the canonical questions a teacher has written,
// newest first, with everything needed to find one and put it on the exam
// without ever picking up the mouse: a stem search, Question Type, Difficulty
// and Topic filters, and an action menu that Inserts or Replaces against the
// question currently selected on the Exam Draft.
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

import { useEffect, useRef, useState } from 'react'
import {
  CornerDownRight,
  EllipsisVertical,
  ListPlus,
  Pencil,
  Plus,
  Replace,
  Search,
} from 'lucide-react'
import { ContextMenu, type MenuItem, type MenuPoint } from './context-menu'
import { stemPreview, type StemPreviewBadge } from './stem-preview'
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  SECTION_ORDER,
  topicsOf,
  type Question,
  type QuestionType,
} from './exam'
import type { QuestionBank } from './question-bank'
import {
  NO_FILTER,
  browseQuestionBank,
  isFilterActive,
  topicOptions,
  type DifficultyFilter,
  type QuestionBankFilter,
} from './question-bank-view'

const TYPE_LABELS: Record<QuestionType, string> = {
  'multiple-choice': 'Multiple choice',
  open: 'Short answer',
}

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

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

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
      {open && (
        <div className="bank-filter-list" role="group" aria-label={label}>
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
        </div>
      )}
    </div>
  )
}

// The fixed Question Sections, in the order the exam prints them.
const TYPE_OPTIONS: FilterOption<QuestionType>[] = SECTION_ORDER.map((type) => ({
  value: type,
  label: TYPE_LABELS[type],
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
  examDraftSelection,
  onSelect,
  onCreate,
  onEdit,
  onAddToExamDraft,
  onInsertAfterExamDraftSelection,
  onReplaceExamDraftSelection,
}: {
  bank: QuestionBank
  /** Which bank records the Exam Draft currently references. */
  examDraftIds: ReadonlySet<string>
  filter: QuestionBankFilter
  onFilterChange: (filter: QuestionBankFilter) => void
  /** The row a teacher has clicked, if any. Transient: selecting is not an
   *  authoring action. */
  selectedQuestionId: string | null
  /** The one question selected on the Exam Draft, when exactly one is — what
   *  Insert and Replace act against. */
  examDraftSelection: Question | null
  onSelect: (questionId: string) => void
  onCreate: () => void
  onEdit: (questionId: string) => void
  onAddToExamDraft: (questionId: string) => void
  onInsertAfterExamDraftSelection: (questionId: string) => void
  onReplaceExamDraftSelection: (questionId: string) => void
}) {
  const [menu, setMenu] = useState<{ questionId: string; point: MenuPoint } | null>(null)
  const questions = browseQuestionBank(bank, filter)
  const filtered = isFilterActive(filter)

  const menuItems = (question: Question): MenuItem[] => {
    const items: MenuItem[] = [
      {
        kind: 'action',
        label: 'Edit question',
        icon: <Pencil />,
        onSelect: () => onEdit(question.id),
      },
    ]
    // A question already on the Exam Draft offers no way onto it a second time:
    // a reference occurs at most once, and saying so before the click is
    // clearer than refusing it afterwards.
    if (!examDraftIds.has(question.id)) {
      items.push({
        kind: 'action',
        label: 'Add to the exam',
        icon: <ListPlus />,
        onSelect: () => onAddToExamDraft(question.id),
      })
      // Composition needs somewhere to compose against, and the Question
      // Sections are fixed: a Multiple Choice question can only reach a
      // Multiple Choice position. An incompatible target offers nothing rather
      // than an action that would be refused.
      if (examDraftSelection && examDraftSelection.type === question.type) {
        items.push(
          { kind: 'separator' },
          {
            kind: 'action',
            label: 'Insert after selected question',
            icon: <CornerDownRight />,
            onSelect: () => onInsertAfterExamDraftSelection(question.id),
          },
          {
            kind: 'action',
            label: 'Replace selected question',
            icon: <Replace />,
            onSelect: () => onReplaceExamDraftSelection(question.id),
          },
        )
      }
    }
    return items
  }

  const isMenuOpenFor = (question: Question) => menu?.questionId === question.id

  return (
    <section className="question-bank" aria-label="Question Bank">
      <header className="question-bank-header">
        <h2>Question Bank</h2>
        <button type="button" className="secondary-button" onClick={onCreate}>
          <Plus />
          New question
        </button>
      </header>

      <div className="question-bank-filters">
        <div className="bank-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            aria-label="Search question stems"
            placeholder="Search stems"
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
                aria-current={selectedQuestionId === question.id ? 'true' : undefined}
                tabIndex={0}
                onClick={() => onSelect(question.id)}
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
                      {TYPE_LABELS[question.type]}
                    </span>
                    {question.difficulty && (
                      <span className="question-bank-row-difficulty">
                        {DIFFICULTY_LABELS[question.difficulty]}
                      </span>
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
                        <span className="question-bank-row-topic" key={topic}>
                          {topic}
                        </span>
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
                  <button
                    type="button"
                    className="question-bank-action"
                    aria-haspopup="menu"
                    aria-label={`Actions for ${name}`}
                    onClick={(event) => {
                      // Acting on a row selects it: the menu's Insert and
                      // Replace name "the selected question", and the row they
                      // act on should be the one saying so.
                      onSelect(question.id)
                      // Beside the button and to its left, so the menu reads as
                      // belonging to the row rather than covering it.
                      const bounds = event.currentTarget.getBoundingClientRect()
                      setMenu({
                        questionId: question.id,
                        point: { x: bounds.left - 6, y: bounds.bottom + 4 },
                      })
                    }}
                  >
                    <EllipsisVertical />
                  </button>
                </div>
                {isMenuOpenFor(question) && menu && (
                  <ContextMenu
                    point={menu.point}
                    side="left"
                    items={menuItems(question)}
                    ariaLabel={`Actions for ${name}`}
                    onClose={() => setMenu(null)}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
