import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Milkdown, useEditor } from '@milkdown/react'
import { Crepe } from '@milkdown/crepe'
import { keymapRef } from '@milkdown/crepe/feature/toolbar'
import type { Ctx } from '@milkdown/kit/ctx'
import { editorViewCtx } from '@milkdown/kit/core'
import { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import { blockConfig } from '@milkdown/kit/plugin/block'
import { uploadConfig } from '@milkdown/kit/plugin/upload'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import {
  multipleChoiceChoiceSchema,
  multipleChoiceChoiceView,
  multipleChoiceKeymap,
  multipleChoiceMode,
  multipleChoiceSchema,
  multipleChoiceView,
  uniqueChoiceIds,
} from './multiple-choice'
import {
  isScriptActive,
  scriptKeymap,
  subscriptIcon,
  subscriptSchema,
  superscriptIcon,
  superscriptSchema,
  toggleScript,
} from './script-marks'
import { leftArrowInputRule, rightArrowInputRule } from './text-arrows'
import type { ReactNode } from 'react'
import { cleanDocument } from './question-doc'
import type { ProseMirrorJSON } from './question-doc'
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  DEFAULT_COLUMNS,
  SECTION_LABELS,
  SECTION_ORDER,
  columnsOf,
  createQuestion,
  topicsOf,
  withTopicAdded,
} from './exam'
import type { ColumnSetting, Difficulty, Question, QuestionPlacement, QuestionType } from './exam'
import { DifficultyBadge, TopicBadge } from './badges'
import { bankQuestionById } from './question-bank'
import type { ExamStore } from './exam-store'
import { ExamPage, PrintDocument } from './exam-page'
import { QuestionBankPane } from './question-bank-pane'
import { NO_FILTER, topicOptions, type QuestionBankFilter } from './question-bank-view'
import { useSelection } from './use-selection'
import { useWorkspaceDrag } from './use-workspace-drag'
import { WorkspaceSplit } from './workspace-split'
import type { LayoutPlan } from './export-plan'
import {
  DEFAULT_EXPORT_CONFIGURATION,
  plansOf,
  prepareExport,
  type ExportConfiguration,
  type PreparationProgress,
} from './export-preparation'
import { ExportDialog } from './export-dialog'
import { domMeasure } from './dom-measure'
import { ownDocumentMedia, saveImage } from './local-images'
import { configurePastedImages, settlePendingMedia } from './pasted-images'
import {
  AlignLeft,
  Check,
  FileType2,
  Gauge,
  ListChecks,
  Plus,
  Redo2,
  Tags,
  Undo2,
} from 'lucide-react'
import { ContextMenu, type MenuPoint } from './context-menu'
import { useRoute } from './use-route'
import { Footer } from './site-chrome'
import { AboutPage, PrivacyPage } from './site-pages'

/** The mark each Question Section goes by, so a type reads the same wherever
 *  it is named — the picker that chooses one, and the dialog that states it. */
const QUESTION_TYPE_ICONS: Record<QuestionType, ReactNode> = {
  'multiple-choice': <ListChecks />,
  open: <AlignLeft />,
}

/**
 * One line of a question's front matter: an icon and a label on the left, and
 * what has been chosen on the right — or nothing at all, because Difficulty
 * and Topics are both optional and a blank field is the normal state rather
 * than an omission to be nagged about.
 *
 * Choosing opens a list under the field with a box to type in. Typing filters
 * what is on offer and moves the highlight to the best match, so a Topic is
 * reached by typing enough of it and pressing Enter. Filtering never rewrites a
 * value: casing and spelling are the teacher's.
 *
 * A single-select field replaces what is there and closes, and choosing what is
 * already chosen clears it — which is the whole of what a Clear button was for.
 * A multi-select one toggles and stays open, because choosing several is one
 * thought rather than several visits.
 *
 * `onCreate` is what makes the Topic field different from the Difficulty one:
 * Difficulty is a closed set of three, while a Topic that does not exist yet
 * is made by typing it. Writing one is the last row of the list rather than
 * something Enter does behind the highlight's back, so typing "mol" and
 * pressing Enter reaches the "Mole Ratio" that is already there.
 */
function FrontMatterSelect({
  icon,
  label,
  options,
  selected,
  multiple,
  onChange,
  onCreate,
  renderValue,
}: {
  icon: ReactNode
  label: string
  /** What can be chosen, in the order it should be offered. */
  options: readonly { value: string; label: string }[]
  selected: readonly string[]
  multiple: boolean
  onChange: (values: string[]) => void
  /** Given the trimmed text typed, when it names nothing already on offer. */
  onCreate?: (value: string) => void
  /** How one chosen value is drawn, on the field and in the list. */
  renderValue: (value: string) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // Which row Enter would take. Reset to the top whenever the list changes
  // underneath it, so the highlight is always on a row that is still there.
  const [active, setActive] = useState(0)
  const field = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)

  // Closing takes the focus back to the field, because the box that had it is
  // about to be unmounted: left where it fell, focus lands on the document
  // body and the dialog behind stops hearing Escape at all.
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!field.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const trimmed = query.trim()
  const needle = trimmed.toLowerCase()
  const matching = options.filter((option) =>
    option.label.toLowerCase().includes(needle),
  )
  // Offered when what has been typed is not already a value, compared exactly.
  // Filtering is case-insensitive because that is what searching means, but two
  // spellings of one subject are two Topics: only the teacher knows whether
  // they mean the same thing, so a near-miss is offered as a new one.
  const creatable =
    onCreate !== undefined
    && trimmed.length > 0
    && !options.some((option) => option.label === trimmed)

  // Every row Enter or an arrow key can land on, in the order they are drawn.
  // Writing a new Topic is the last of them rather than a separate gesture.
  const rows: (
    | { kind: 'choose'; value: string }
    | { kind: 'create' }
  )[] = [
    ...matching.map((option) => ({ kind: 'choose' as const, value: option.value })),
    ...(creatable ? [{ kind: 'create' as const }] : []),
  ]
  const activeRow = Math.min(active, Math.max(rows.length - 1, 0))

  const choose = (value: string) => {
    if (!multiple) {
      // Choosing what is already chosen clears the field: one value, and the
      // way to have none of it is to take back the one you picked.
      onChange(selected.includes(value) ? [] : [value])
      close()
    } else {
      onChange(
        selected.includes(value)
          ? selected.filter((item) => item !== value)
          : [...selected, value],
      )
      // The row that was clicked is about to be re-rendered under a cleared
      // query; keeping the typing where the typing happens is what lets a
      // teacher name three Topics without reaching for the mouse in between.
      search.current?.focus()
    }
    setQuery('')
  }

  const create = () => {
    if (!creatable) return
    onCreate?.(trimmed)
    setQuery('')
    if (multiple) search.current?.focus()
    else close()
  }

  const commit = (row: (typeof rows)[number] | undefined) => {
    if (!row) return
    if (row.kind === 'create') create()
    else choose(row.value)
  }

  return (
    <div
      className="front-matter-field"
      ref={field}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return
        // The dialog behind listens for the same key to close itself.
        event.stopPropagation()
        close()
      }}
    >
      <span className="front-matter-label">
        {icon}
        {label}
      </span>
      <button
        type="button"
        className="front-matter-value"
        ref={trigger}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((current) => !current)}
      >
        {selected.length === 0 ? (
          <span className="front-matter-blank">Empty</span>
        ) : (
          selected.map((value) => (
            <Fragment key={value}>{renderValue(value)}</Fragment>
          ))
        )}
      </button>
      {open && (
        <div className="front-matter-list" role="group" aria-label={label}>
          <input
            className="front-matter-search"
            ref={search}
            autoFocus
            aria-label={`Filter ${label}`}
            placeholder={onCreate ? `Search or add a ${label.replace(/s$/, '')}` : 'Search'}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                if (rows.length === 0) return
                const step = event.key === 'ArrowDown' ? 1 : -1
                setActive((current) => {
                  const from = Math.min(current, rows.length - 1)
                  return (from + step + rows.length) % rows.length
                })
                return
              }
              if (event.key !== 'Enter') return
              event.preventDefault()
              commit(rows[activeRow])
            }}
          />
          <div className="front-matter-options">
            {rows.map((row, index) =>
              row.kind === 'choose' ? (
                <button
                  type="button"
                  className="front-matter-option"
                  key={row.value}
                  data-active={index === activeRow ? 'true' : undefined}
                  data-chosen={selected.includes(row.value) ? 'true' : undefined}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(row.value)}
                >
                  {renderValue(row.value)}
                  {selected.includes(row.value) && <Check />}
                </button>
              ) : (
                <button
                  type="button"
                  className="front-matter-option"
                  key="create"
                  data-active={index === activeRow ? 'true' : undefined}
                  onMouseEnter={() => setActive(index)}
                  onClick={create}
                >
                  <Plus />
                  Add {renderValue(trimmed)}
                </button>
              ),
            )}
            {rows.length === 0 && (
              <p className="front-matter-empty">Nothing to choose</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function CrepeQuestion({
  value,
  onChange,
  onReady,
}: {
  value: ProseMirrorJSON
  onChange: (doc: ProseMirrorJSON) => void
  onReady: (readDocument: () => ProseMirrorJSON) => void
}) {
  useEditor((root) => {
    const safeValue = cleanDocument(value)
    const crepe = new Crepe({
      root,
      defaultValue: '',
      features: {
        [Crepe.Feature.CodeMirror]: true,
        [Crepe.Feature.Latex]: true,
      },
      featureConfigs: {
        [Crepe.Feature.BlockEdit]: { advancedGroup: { codeBlock: null } },
        // The browser's own caret is the caret (see `caret-color` in
        // styles.css). Crepe's painted stand-in would be a second one: it
        // stays where the selection last was after the editor loses focus,
        // stops blinking there, and reads as a stray mark left in the text.
        [Crepe.Feature.Cursor]: { virtual: false },
        [Crepe.Feature.ImageBlock]: { onUpload: saveImage },
        [Crepe.Feature.Placeholder]: { text: 'Write the question…' },
        [Crepe.Feature.Toolbar]: {
          buildToolbar: (builder) => {
            builder
              .getGroup('formatting')
              .addItem('subscript', {
                icon: subscriptIcon,
                label: 'Subscript',
                keymap: keymapRef<'ToggleSubscript' | 'ToggleSuperscript'>(
                  scriptKeymap.key,
                  'ToggleSubscript',
                ),
                active: (ctx: Ctx) => isScriptActive(ctx, 'subscript'),
                onRun: (ctx: Ctx) => toggleScript(ctx, 'subscript'),
              })
              .addItem('superscript', {
                icon: superscriptIcon,
                label: 'Superscript',
                keymap: keymapRef<'ToggleSubscript' | 'ToggleSuperscript'>(
                  scriptKeymap.key,
                  'ToggleSuperscript',
                ),
                active: (ctx: Ctx) => isScriptActive(ctx, 'superscript'),
                onRun: (ctx: Ctx) => toggleScript(ctx, 'superscript'),
              })
          },
        },
      },
    })
    crepe.editor
      .use(multipleChoiceMode(true))
      .use(subscriptSchema)
      .use(superscriptSchema)
      .use(scriptKeymap)
      .use(rightArrowInputRule)
      .use(leftArrowInputRule)
      .use(multipleChoiceSchema)
      .use(multipleChoiceChoiceSchema)
      .use(multipleChoiceView)
      .use(multipleChoiceChoiceView)
      .use(multipleChoiceKeymap)
      .use(uniqueChoiceIds)
    // Make the whole multiple-choice block the drag target instead of a single
    // answer row: never offer a handle for a choice itself, so Crepe's handle
    // climbs to the multipleChoice node. Paragraphs inside a choice keep their
    // own handle, so lines can still be dragged within a choice or out of it.
    crepe.editor.config((ctx) => {
      configurePastedImages(ctx)
      ctx.update(uploadConfig.key, (prev) => ({
        ...prev,
        enableHtmlFileUploader: true,
      }))
      ctx.update(blockConfig.key, (prev) => ({
        ...prev,
        filterNodes: (pos, node) => {
          for (let depth = pos.depth; depth > 0; depth -= 1) {
            const name = pos.node(depth).type.name
            if (name === 'table' || name === 'blockquote' || name === 'math_inline') {
              return false
            }
          }
          if (node?.type?.name === 'multipleChoiceChoice') return false
          return true
        },
      }))
    })
    crepe.on((listener) => {
      listener.mounted((ctx) => {
        const view = ctx.get(editorViewCtx)
        onReady(() => cleanDocument(view.state.doc.toJSON() as ProseMirrorJSON))
        const loadedDocument = ProseNode.fromJSON(view.state.schema, safeValue)
        const tr = view.state.tr.replaceWith(
          0,
          view.state.doc.content.size,
          loadedDocument.content,
        )
        // Start the dialog with the cursor on the first line (the question) so
        // typing goes there straight away.
        tr.setSelection(TextSelection.atStart(tr.doc))
        view.dispatch(tr)
        view.focus()
      })
      listener.updated((_ctx, doc) =>
        onChange(cleanDocument(doc.toJSON() as ProseMirrorJSON)),
      )
    })
    return crepe
  }, [])
  return <Milkdown />
}

function QuestionDialog({
  question,
  isNew,
  topicSuggestions,
  onCancel,
  onSave,
}: {
  question: Question
  isNew: boolean
  /** Every Topic already used in the Question Bank, offered so a teacher picks
   *  the spelling they used last time rather than inventing a near-duplicate. */
  topicSuggestions: readonly string[]
  onCancel: () => void
  onSave: (question: Question) => Promise<void>
}) {
  // A question's type is settled when it is created, so the dialog reads it
  // and never changes it: there is no switch to make, and nothing to preserve
  // across one.
  const { type } = question
  const [doc] = useState<ProseMirrorJSON>(question.doc)
  const [difficulty, setDifficulty] = useState<Difficulty | ''>(question.difficulty ?? '')
  const [topics, setTopics] = useState<readonly string[]>(topicsOf(question))
  const latestDoc = useRef(doc)
  const readEditorDocument = useRef<(() => ProseMirrorJSON) | null>(null)
  const dialog = useRef<HTMLElement>(null)

  // Escape that lands on nothing: a click on a bare patch of the dialog, or a
  // popup closing under the focus it held, leaves focus on the document body,
  // and a key pressed there never reaches the dialog's own handler. Anything
  // inside the dialog is left to that handler, so a Crepe menu still gets to
  // consume the key first.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (dialog.current?.contains(event.target as Node)) return
      onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  const saveQuestion = async () => {
    await settlePendingMedia()
    const saved: Question = {
      ...question,
      type,
      doc: await ownDocumentMedia(
        cleanDocument(readEditorDocument.current?.() ?? latestDoc.current),
      ),
    }
    if (difficulty) saved.difficulty = difficulty
    else delete saved.difficulty
    if (topics.length > 0) saved.topics = [...topics]
    else delete saved.topics
    await onSave(saved)
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
      onKeyDown={(event) => {
        // Bubble phase: a Crepe menu/tooltip that consumes Escape to close
        // itself stops propagation first, so the dialog only closes when
        // nothing inside handled the key.
        if (event.key === 'Escape') {
          event.stopPropagation()
          onCancel()
        }
      }}
      onKeyDownCapture={(event) => {
        if (
          event.key === 'Enter'
          && (event.ctrlKey || event.metaKey)
          && !event.altKey
        ) {
          event.preventDefault()
          event.stopPropagation()
          void saveQuestion()
        }
      }}
    >
      <section
        className="question-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Question editor"
      >
        <header className="dialog-header">
          <h2>{isNew ? 'Add question' : 'Edit question'}</h2>
        </header>
        {/* The question's front matter, indented to the document's own margin
            because it is the head of the question rather than a strip bolted
            above it. Type is stated: it was settled when the question was
            created and the answer choices below depend on it. Difficulty and
            Topics are optional and both open blank. */}
        <div className="front-matter">
          <div className="front-matter-field">
            <span className="front-matter-label">
              <FileType2 />
              Type
            </span>
            <span className="front-matter-value front-matter-stated">
              <span className="badge badge-type">
                {QUESTION_TYPE_ICONS[type]}
                {SECTION_LABELS[type]}
              </span>
            </span>
          </div>
          <FrontMatterSelect
            icon={<Gauge />}
            label="Difficulty"
            options={DIFFICULTIES.map((value) => ({
              value,
              label: DIFFICULTY_LABELS[value],
            }))}
            selected={difficulty ? [difficulty] : []}
            multiple={false}
            onChange={(values) => setDifficulty((values[0] as Difficulty) ?? '')}
            renderValue={(value) => <DifficultyBadge difficulty={value as Difficulty} />}
          />
          <FrontMatterSelect
            icon={<Tags />}
            label="Topics"
            options={Array.from(new Set([...topics, ...topicSuggestions])).map(
              (topic) => ({ value: topic, label: topic }),
            )}
            selected={topics}
            multiple
            onChange={setTopics}
            onCreate={(value) => setTopics(withTopicAdded(topics, value))}
            renderValue={(value) => <TopicBadge topic={value} />}
          />
        </div>
        <div className="dialog-editor">
          <CrepeQuestion
            value={doc}
            onReady={(readDocument) => {
              readEditorDocument.current = readDocument
            }}
            onChange={(next) => {
              latestDoc.current = next
            }}
          />
        </div>
        <footer className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void saveQuestion()}
          >
            Save question
          </button>
        </footer>
      </section>
    </div>
  )
}

function ExamEditor({ store }: { store: ExamStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  // What the page renders and what an export publishes: the Question Bank
  // records the Exam Draft references, in Exam Draft order, and nothing else.
  // The store derives it once per change, so it is a stable dependency.
  const { exam, version } = useSyncExternalStore(store.subscribe, store.selectedExam)
  const examDraftIds = new Set(state.examDraft.questionIds)
  // A question being written in the popup, and where saving it should put it.
  //
  // `destination` is what the popup was opened from: the Question Bank on its
  // own, or a place on the Exam Draft — `after` being the question a plus was
  // clicked beside. Editing an existing question ignores both: the popup only
  // ever changes canonical Question Content.
  // Which Question Section a question about to be written belongs to. Asked
  // only where the position does not already answer it: a question added below
  // another one takes that one's section, but a bank-only question and the
  // first question on an empty sheet could be either.
  const [choosingType, setChoosingType] = useState<{
    point: MenuPoint
    destination: 'question-bank' | 'exam-draft'
    after: string | null
  } | null>(null)
  const [editing, setEditing] = useState<{
    question: Question
    destination: 'question-bank' | 'exam-draft'
    after: string | null
  } | null>(null)
  // The export dialog, and the configuration it is showing. The configuration
  // lives here rather than inside the dialog so that an export which fails
  // after the dialog closed can reopen it with the teacher's settings intact;
  // opening it from the Export button always starts from the defaults, because
  // export configuration is deliberately not remembered between openings.
  const [exportDialog, setExportDialog] = useState<{
    configuration: ExportConfiguration
    error: string | null
  } | null>(null)
  const exportButton = useRef<HTMLButtonElement>(null)
  // What a finished preparation handed over: the plans print mounts, or the
  // Word file to save. Set only once the dialog has closed, so the native
  // action never starts behind a modal that is still up.
  const [handoff, setHandoff] = useState<
    | { format: 'print'; plans: LayoutPlan[]; configuration: ExportConfiguration }
    | { format: 'docx'; blob: Blob; filename: string; configuration: ExportConfiguration }
    | null
  >(null)
  // Selection lives here, alongside the store, so page interactions and
  // selection-wide context-menu actions share one source of truth.
  const selection = useSelection()
  const clearSelection = selection.clear
  const selectOnExamDraft = selection.select
  // How the Question Bank is being browsed, and which of its rows was last
  // clicked. Both are transient UI state: they live here rather than in the
  // store, so narrowing the bank or picking a row is never an authoring action,
  // never dirties the exam and never appears in undo history.
  const [bankFilter, setBankFilter] = useState<QuestionBankFilter>(NO_FILTER)
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null)
  // A question an authoring action has just put on the Exam Draft, waiting to be
  // revealed. `ExamPage` clears it once repagination has actually put it on a
  // page, which — for a change of content — is not the same moment.
  const [revealQuestionId, setRevealQuestionId] = useState<string | null>(null)
  const clearReveal = useCallback(() => setRevealQuestionId(null), [])
  // The outcome of the latest Vary command stays visible and is announced to
  // assistive technology. It is transient UI feedback, not authoring state.
  const [varySummary, setVarySummary] = useState<string | null>(null)
  useEffect(() => {
    if (!varySummary) return
    const timer = window.setTimeout(() => setVarySummary(null), 4_000)
    return () => window.clearTimeout(timer)
  }, [varySummary])
  // A highlighted bank row is a place to read from, not a thing being acted
  // against, so it lasts exactly as long as the teacher is looking at it: the
  // next press anywhere but on a row takes it back, and so does Escape (with
  // the workspace's other selections, in the keyboard handler below).
  useEffect(() => {
    if (!selectedBankId) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.question-bank-row')) return
      setSelectedBankId(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [selectedBankId])

  // One composition, however it was asked for.
  //
  // A pointer gesture, the row's Add button and the row menu's Insert and
  // Replace are four ways of saying the same three things, so they say them
  // here: exactly one call to the authoring boundary, then the incoming
  // question becomes the selected one and is queued to be revealed. That is
  // what makes the paths yield the same Question Bank and Exam Draft state
  // rather than merely similar ones — and what stops a question composed one
  // way being findable while the same question composed another way is not.
  const selectAndReveal = (questionId: string) => {
    selectOnExamDraft(questionId)
    setRevealQuestionId(questionId)
  }
  // The answer layout a question about to be written starts with: the one the
  // question it is being added below uses, else the one the last multiple-choice
  // question written uses, else two columns. A teacher who lays their answers
  // out in one column lays the next question out that way too, and saying so
  // once is the whole of the setting they should have to touch.
  const columnsForNewQuestion = (afterQuestionId: string | null): ColumnSetting => {
    const above = afterQuestionId
      ? bankQuestionById(state.questionBank, afterQuestionId)
      : undefined
    if (above?.type === 'multiple-choice') return columnsOf(above)
    const questions = state.questionBank.questions
    for (let index = questions.length - 1; index >= 0; index -= 1) {
      const question = questions[index]!
      if (question.type === 'multiple-choice') return columnsOf(question)
    }
    return DEFAULT_COLUMNS
  }

  const addToExamDraft = (questionId: string) => {
    store.addToExamDraft(questionId)
    selectAndReveal(questionId)
  }
  const insertIntoExamDraft = (
    questionId: string,
    targetQuestionId: string,
    placement: QuestionPlacement,
  ) => {
    store.addToExamDraft(questionId, targetQuestionId, placement)
    selectAndReveal(questionId)
  }
  const replaceInExamDraft = (outgoingQuestionId: string, incomingQuestionId: string) => {
    store.replaceInExamDraft(outgoingQuestionId, incomingQuestionId)
    // Necessary rather than merely tidy: the outgoing question is off the exam
    // now, and a selection pointing at it names no position on the Exam Draft.
    selectAndReveal(incomingQuestionId)
  }
  const shuffleSelectedQuestions = (questionIds: readonly string[]) => {
    store.shuffleSelectedQuestions(questionIds)
    setVarySummary('Shuffled question order.')
  }

  const shuffleSelectedAnswers = (questionIds: readonly string[]) => {
    store.shuffleSelectedAnswers(questionIds)
    setVarySummary('Shuffled answer order.')
  }

  const replaceWithEquivalentQuestions = (questionIds: readonly string[]) => {
    const before = store.getState().examDraft.questionIds
    const positions = questionIds
      .map((questionId) => before.indexOf(questionId))
      .filter((index) => index !== -1)
    const result = store.replaceWithEquivalentQuestions(questionIds)
    const after = store.getState().examDraft.questionIds

    // Selection follows the occupied positions: replaced questions stay acted
    // on under their incoming identities, while unmatched questions remain
    // selected under the identities they already had.
    selection.clear()
    for (const index of positions) selection.toggle(after[index]!)
    const questionNoun = result.replaced === 1 ? 'question' : 'questions'
    setVarySummary(
      `Replaced ${result.replaced} ${questionNoun}; ${result.unmatched} unmatched.`,
    )
  }

  // Where a released gesture goes. Each branch is one store call, so one drag
  // is one dirty flag, one mirrored write and one undo step — and the store
  // itself refuses a cross-section or duplicating drop, so the geometry above
  // only ever has to decide *where*, never *whether*.
  const drag = useWorkspaceDrag((source, intent) => {
    if (source.pane === 'exam-draft') {
      // Dragging inside the Exam Draft reorders and nothing else: the pane a
      // gesture starts in is what gives it its meaning.
      if (intent.kind !== 'insert') return
      store.moveInExamDraft(source.questionIds, intent.targetQuestionId, intent.placement)
      return
    }
    if (intent.kind === 'insert') {
      insertIntoExamDraft(source.questionId, intent.targetQuestionId, intent.placement)
    } else if (intent.kind === 'replace') {
      replaceInExamDraft(intent.outgoingQuestionId, source.questionId)
    } else {
      addToExamDraft(source.questionId)
    }
  })

  useEffect(() => {
    if (editing || exportDialog) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === 'z'
        && (event.ctrlKey || event.metaKey)
        && !event.altKey
      ) {
        event.preventDefault()
        if (event.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        // Not while something is being typed into: the bank's search box and
        // the filter lists are on the same page, and Backspace there means
        // what it always means.
        const target = event.target as HTMLElement | null
        const typing =
          target?.isContentEditable === true
          || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')
        if (typing || selection.selectedIds.size === 0) return
        event.preventDefault()
        // Remove, not Delete: the questions come off the Exam Draft and stay in
        // the Question Bank, which is why this needs no confirmation.
        store.removeFromExamDraft([...selection.selectedIds])
        clearSelection()
        return
      }
      if (event.key !== 'Escape') return
      clearSelection()
      setSelectedBankId(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [clearSelection, editing, exportDialog, selection.selectedIds, store])

  const closeExportDialog = () => {
    setExportDialog(null)
    exportButton.current?.focus()
  }

  /**
   * One export, from the Export button to the moment the browser takes over.
   *
   * Saving first is what stops stale content being published: there is no Save
   * button, so the export is the commit, and a failed write aborts the export
   * with a message rather than quietly printing yesterday's exam.
   *
   * Then one call to the preparation seam, which is the only thing that decides
   * how many Versions there are and what each of them says. DOCX is packaged
   * here too, while the dialog is still up and can show progress and catch a
   * failure; the final native action is handed back so it starts after the
   * dialog has closed and focus is back on Export.
   */
  const runExport = async (
    configuration: ExportConfiguration,
    onProgress: (progress: PreparationProgress) => void,
  ) => {
    try {
      await store.save()
    } catch (error) {
      console.error('Could not save the exam before exporting', error)
      throw new Error(
        'Your latest changes could not be saved, so the export was stopped. '
        + 'Check your connection and try again.',
      )
    }

    const prepared = prepareExport({
      ...store.selectedExam(),
      configuration,
      // Not seeded: a later export deliberately draws a fresh set rather than
      // reproducing an earlier one.
      random: Math.random,
      measure: domMeasure,
      onProgress,
    })
    const plans = plansOf(prepared)

    if (configuration.format === 'print') {
      setHandoff({ format: 'print', plans, configuration })
      return
    }
    try {
      // Loaded on demand: the Word writer and its ZIP machinery stay out of the
      // application's initial bundle.
      const { createExamDocx } = await import('./docx-export')
      setHandoff({
        format: 'docx',
        blob: await createExamDocx(plans),
        filename: prepared.filename,
        configuration,
      })
    } catch (error) {
      console.error('Could not create the DOCX file', error)
      throw new Error('The Word file could not be created. Please try again.')
    }
  }

  /** A native action that never started: reopen the dialog on the same
   *  configuration with something the teacher can act on. */
  const exportFailed = (configuration: ExportConfiguration, message: string) => {
    setHandoff(null)
    setExportDialog({ configuration, error: message })
  }

  // The handoff, once the dialog is out of the way.
  //
  // The print document stays mounted until `afterprint` says the browser is
  // done with it. Unmounting in the frame that follows `window.print()` assumes
  // the dialog has already read the DOM, and a preview that re-reads it — or a
  // headless capture that never opens a dialog at all — would find nothing
  // there. Off screen the extra markup costs nothing: `.print-output` is
  // `display: none` until print media applies.
  useEffect(() => {
    if (!handoff) return
    if (handoff.format === 'docx') {
      const { blob, filename, configuration } = handoff
      void import('./docx-export')
        .then(({ saveDocxFile }) => {
          saveDocxFile(blob, filename)
          setHandoff(null)
        })
        .catch((error: unknown) => {
          console.error('Could not start the DOCX download', error)
          exportFailed(configuration, 'The download could not be started. Please try again.')
        })
      return
    }
    const done = () => setHandoff(null)
    window.addEventListener('afterprint', done)
    const frame = window.requestAnimationFrame(() => {
      try {
        window.print()
      } catch (error) {
        console.error('Could not open the print dialog', error)
        exportFailed(
          handoff.configuration,
          'The print dialog could not be opened. Please try again.',
        )
      }
    })
    return () => {
      window.removeEventListener('afterprint', done)
      window.cancelAnimationFrame(frame)
    }
  }, [handoff])

  return (
    <>
      <header className="document-bar">
        {/* The mark sits at the far left of the bar with the exam's name beside
            it, the way a document editor puts its logo next to the file name. */}
        <div className="document-identity">
          <img className="app-logo" src="/logo.png" alt="Test Parrot" width={36} height={36} />
          <input
            aria-label="Exam name"
            className="document-title"
            value={state.examDraft.title}
            onChange={(event) => store.setTitle(event.target.value)}
          />
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="toolbar-icon-button"
            aria-label="Undo"
            title="Undo (Ctrl/Cmd+Z)"
            disabled={!store.canUndo()}
            onClick={store.undo}
          >
            <Undo2 />
          </button>
          <button
            type="button"
            className="toolbar-icon-button"
            aria-label="Redo"
            title="Redo (Ctrl/Cmd+Shift+Z)"
            disabled={!store.canRedo()}
            onClick={store.redo}
          >
            <Redo2 />
          </button>
          <button
            ref={exportButton}
            type="button"
            className="export-button"
            aria-haspopup="dialog"
            aria-expanded={exportDialog !== null}
            onClick={() =>
              setExportDialog({
                configuration: DEFAULT_EXPORT_CONFIGURATION,
                error: null,
              })
            }
          >
            Export
          </button>
        </div>
      </header>

      {exportDialog && (
        <ExportDialog
          exam={exam}
          version={version}
          configuration={exportDialog.configuration}
          onConfigurationChange={(configuration) =>
            setExportDialog((current) => (current ? { ...current, configuration } : current))
          }
          initialError={exportDialog.error}
          onSubmit={async (configuration, onProgress) => {
            await runExport(configuration, onProgress)
            closeExportDialog()
          }}
          onCancel={closeExportDialog}
        />
      )}

      {/* The split authoring workspace: the Question Bank beside the rendered
          Exam Draft. The bank opens as the narrower pane — it is picked from
          rather than read — and the divider moves. */}
      <WorkspaceSplit
        bank={
          <QuestionBankPane
            bank={state.questionBank}
            examDraftIds={examDraftIds}
            filter={bankFilter}
            onFilterChange={setBankFilter}
            selectedQuestionId={selectedBankId}
            onSelect={setSelectedBankId}
            drag={drag}
            onCreate={(point) =>
              setChoosingType({ point, destination: 'question-bank', after: null })
            }
            onEdit={(questionId) => {
              const question = bankQuestionById(state.questionBank, questionId)
              if (question) {
                setEditing({ question, destination: 'question-bank', after: null })
              }
            }}
            onAddToExamDraft={addToExamDraft}
            onRemoveFromExamDraft={(questionId) => {
              store.removeFromExamDraft([questionId])
              // A selection pointing at a question that is no longer on the
              // sheet names no position, and only this one has left it.
              if (selection.isSelected(questionId)) selection.toggle(questionId)
            }}
          />
        }
        examDraft={
          <ExamPage
            exam={exam}
            version={version}
            selection={selection}
            drag={drag}
            revealQuestionId={revealQuestionId}
            onRevealed={clearReveal}
            onEdit={(questionId) => {
              const question = bankQuestionById(state.questionBank, questionId)
              if (question) {
                setEditing({ question, destination: 'exam-draft', after: null })
              }
            }}
            onDuplicate={(questionId) => store.duplicateInExamDraft(questionId)}
            onReplaceWithEquivalents={replaceWithEquivalentQuestions}
            onShuffleSelected={shuffleSelectedQuestions}
            onShuffleSelectedAnswers={shuffleSelectedAnswers}
            onRemove={(questionIds) => {
              store.removeFromExamDraft(questionIds)
              selection.clear()
            }}
            onAdd={(section, afterQuestionId) =>
              setEditing({
                question: createQuestion(
                  section,
                  columnsForNewQuestion(afterQuestionId ?? null),
                ),
                destination: 'exam-draft',
                after: afterQuestionId ?? null,
              })
            }
            onAddFirst={(point) =>
              setChoosingType({ point, destination: 'exam-draft', after: null })
            }
            onSetColumns={(questionIds, columns) =>
              store.setQuestionColumns(questionIds, columns)
            }
            unsavedDraft={!store.hasSavedExam()}
          />
        }
      />

      {varySummary && (
        <p className="vary-summary" role="status" aria-live="polite">
          {varySummary}
        </p>
      )}

      <Footer />

      {handoff?.format === 'print' && <PrintDocument plans={handoff.plans} />}

      {choosingType && (
        <ContextMenu
          point={choosingType.point}
          ariaLabel="Question type"
          items={SECTION_ORDER.map((type) => ({
            kind: 'action' as const,
            label: SECTION_LABELS[type],
            icon: QUESTION_TYPE_ICONS[type],
            onSelect: () => {
              setEditing({
                question: createQuestion(
                  type,
                  columnsForNewQuestion(choosingType.after),
                ),
                destination: choosingType.destination,
                after: choosingType.after,
              })
            },
          }))}
          onClose={() => setChoosingType(null)}
        />
      )}

      {editing && (
        <QuestionDialog
          question={editing.question}
          isNew={!bankQuestionById(state.questionBank, editing.question.id)}
          topicSuggestions={topicOptions(state.questionBank)}
          onCancel={() => setEditing(null)}
          onSave={async (saved) => {
            // One authoring action, whichever way the popup was opened, so a
            // saved question is one undo step and cancelling is none at all.
            if (bankQuestionById(state.questionBank, saved.id)) {
              store.updateInQuestionBank(saved)
            } else if (editing.destination === 'question-bank') {
              store.createInQuestionBank(saved)
            } else {
              store.createInExamDraft(saved, editing.after)
            }
            await store.whenSettled()
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

/**
 * The site's three pages. The editor is the app; About and Privacy are the
 * ordinary pages a public tool is expected to have, reached from the footer.
 */
export default function App({ store }: { store: ExamStore }) {
  const route = useRoute()
  if (route === '/about') return <AboutPage />
  if (route === '/privacy') return <PrivacyPage />
  return <ExamEditor store={store} />
}
