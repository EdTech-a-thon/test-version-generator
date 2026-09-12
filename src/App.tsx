import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
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
import {
  cleanDocument,
  suggestedAnswerDocumentOf,
  withSuggestedAnswer,
  withoutSuggestedAnswer,
} from './question-doc'
import type { ProseMirrorJSON } from './question-doc'
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  SECTION_LABELS,
  SECTION_ORDER,
  createQuestion,
  topicsOf,
  withTopicAdded,
} from './exam'
import type { Difficulty, Question, QuestionPlacement, QuestionType } from './exam'
import { DifficultyBadge, TopicBadge } from './badges'
import { bankQuestionById } from './question-bank'
import { createExamStore, loadExamStore, type ExamStore } from './exam-store'
import { ExamPage } from './exam-page'
import { QuestionBankPane } from './question-bank-pane'
import { NO_FILTER, topicOptions, type QuestionBankFilter } from './question-bank-view'
import { useSelection } from './use-selection'
import { useWorkspaceDrag } from './use-workspace-drag'
import { WorkspaceSplit } from './workspace-split'
import {
  DEFAULT_EXPORT_CONFIGURATION,
  prepareExport,
  prepareHistoricalExport,
  readExportPreferences,
  writeExportPreferences,
  type ExportConfiguration,
  type PreparationProgress,
  type PreparedExport,
} from './export-preparation'
import { ExportDialog } from './export-dialog'
import { domMeasure } from './dom-measure'
import { ownDocumentMedia, saveImage } from './local-images'
import { configurePastedImages, settlePendingMedia } from './pasted-images'
import {
  AlignLeft,
  Check,
  CircleDot,
  FileType2,
  FolderOpen,
  Gauge,
  History,
  ListChecks,
  Plus,
  Redo2,
  RefreshCw,
  Save,
  SaveAll,
  Tags,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react'
import { ContextMenu, type MenuPoint } from './context-menu'
import { BEFORE_NAVIGATE_EVENT, useRoute } from './use-route'
import { Footer } from './site-chrome'
import { HomePage } from './home-page'
import type { ExamWorkspaceService, QuestionDeletionImpact, QuestionUsage, RecentExam } from './exam-workspaces'
import {
  type QuestionBankResource,
  type QuestionBankSummary,
  type QuestionBankTabsWorkspace,
  type BankWorkspaceContext,
  closeBankTab,
  openBankTab,
  type QuestionBankWorkspaceService,
} from './question-bank-workspaces'
import {
  ExportHistoryDrawer,
  HistoricalExportRecord,
} from './export-history'
import { AppShell } from './app-shell'
import { AboutPage, PrivacyPage } from './site-pages'
import { persistentStorageStatus, requestPersistentStorage, type PersistentStorageStatus } from './durable-storage'
import { ResourceCollectionPage } from './resource-collection-page'
import { BankFileDropTarget } from './bank-file-drop'
import { questionBankCollection, type QuestionBankCollectionItem } from './resource-collections'
import { QuestionBankExportDialog } from './question-bank-export-dialog'
import { QuestionBankImportDialog } from './question-bank-import-dialog'
import {
  keepSuggestedAnswer,
  suggestedAnswerMode,
  suggestedAnswerSchema,
  suggestedAnswerView,
} from './suggested-answer'

/** The mark each Question Section goes by, so a type reads the same wherever
 *  it is named — the picker that chooses one, and the dialog that states it. */
const QUESTION_TYPE_ICONS: Record<QuestionType, ReactNode> = {
  'multiple-choice': <ListChecks />,
  open: <AlignLeft />,
}

const STORAGE_NOTICE_DURATION = 8_000

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
  suggestedAnswer = false,
}: {
  value: ProseMirrorJSON
  onChange: (doc: ProseMirrorJSON) => void
  onReady: (readDocument: () => ProseMirrorJSON) => void
  suggestedAnswer?: boolean
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
      .use(suggestedAnswerMode(suggestedAnswer))
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
      .use(suggestedAnswerSchema)
      .use(suggestedAnswerView)
      .use(keepSuggestedAnswer)
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
          if (
            node?.type?.name === 'multipleChoiceChoice'
            || node?.type?.name === 'suggestedAnswer'
          ) return false
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
  ownerName,
  usage,
  onCancel,
  onSave,
  onDelete,
}: {
  question: Question
  isNew: boolean
  /** Every Topic already used in the Question Bank, offered so a teacher picks
   *  the spelling they used last time rather than inventing a near-duplicate. */
  topicSuggestions: readonly string[]
  ownerName?: string
  usage?: readonly QuestionUsage[]
  onCancel: () => void
  onSave: (question: Question) => Promise<void>
  onDelete?: () => void
}) {
  // A question's type is settled when it is created, so the dialog reads it
  // and never changes it: there is no switch to make, and nothing to preserve
  // across one.
  const { type } = question
  const [doc] = useState<ProseMirrorJSON>(() =>
    type === 'open'
      ? withSuggestedAnswer(question.doc, question.suggestedAnswer)
      : question.doc,
  )
  const [difficulty, setDifficulty] = useState<Difficulty | ''>(question.difficulty ?? '')
  const [topics, setTopics] = useState<readonly string[]>(topicsOf(question))
  const latestDoc = useRef(doc)
  const readEditorDocument = useRef<(() => ProseMirrorJSON) | null>(null)
  const dialog = useRef<HTMLElement>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

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
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try {
      await settlePendingMedia()
      const edited = cleanDocument(
        readEditorDocument.current?.() ?? latestDoc.current,
      )
      const saved: Question = {
        ...question,
        type,
        doc: await ownDocumentMedia(
          type === 'open' ? withoutSuggestedAnswer(edited) : edited,
        ),
      }
      if (difficulty) saved.difficulty = difficulty
      else delete saved.difficulty
      if (topics.length > 0) saved.topics = [...topics]
      else delete saved.topics
      if (type === 'open') {
        const answer = suggestedAnswerDocumentOf(edited)
        if (answer) saved.suggestedAnswer = await ownDocumentMedia(answer)
        else delete saved.suggestedAnswer
      }
      await onSave(saved)
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : 'The Question could not be saved. Your changes are still here; try again.',
      )
    } finally {
      setSaving(false)
    }
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
          <div>
            <h2>{isNew ? 'Add question' : 'Edit question'}</h2>
            {!isNew && ownerName && <p className="question-owner">Question Bank: {ownerName}</p>}
          </div>
          {!isNew && usage && (
            <details className="question-usage">
              <summary>Used in {usage.length} {usage.length === 1 ? 'Exam' : 'Exams'}</summary>
              {usage.length === 0 ? <p>Not used in any Exams.</p> : <ul>
                {usage.map((item) => <li key={item.examId}>
                  <strong>{item.title}</strong>{' — '}
                  {item.saved && item.workingCopy
                    ? 'saved state and Working Copy'
                    : item.saved ? 'saved state' : 'Working Copy'}
                </li>)}
              </ul>}
            </details>
          )}
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
            suggestedAnswer={type === 'open'}
            onReady={(readDocument) => {
              readEditorDocument.current = readDocument
            }}
            onChange={(next) => {
              latestDoc.current = next
            }}
          />
        </div>
        <footer className="dialog-actions">
          {!isNew && onDelete && <button type="button" className="danger-button question-delete-button" onClick={onDelete}><Trash2 />Delete Question</button>}
          {saveError && <p className="dialog-save-error" role="alert">{saveError}</p>}
          <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="primary-button"
            disabled={saving}
            onClick={() => void saveQuestion()}
          >
            {saving ? 'Saving…' : 'Save question'}
          </button>
        </footer>
      </section>
    </div>
  )
}

function DestructiveConfirmation({ label, title, children, confirmLabel, onCancel, onConfirm }: {
  label: string
  title: string
  children: ReactNode
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  const titleId = useId()
  const dialog = useRef<HTMLElement>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    requestAnimationFrame(() => dialog.current?.querySelector<HTMLElement>('button')?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !deleting) onCancel()
      if (event.key !== 'Tab') return
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])
      if (controls.length === 0) return
      const first = controls[0]!
      const last = controls.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      requestAnimationFrame(() => { if (previous?.isConnected) previous.focus() })
    }
  }, [deleting, onCancel])
  return createPortal(<div className="dialog-backdrop" role="presentation" onKeyDown={(event) => {
    event.stopPropagation()
    if (event.key === 'Escape' && !deleting) onCancel()
  }}>
    <section ref={dialog} className="destructive-dialog" role="dialog" aria-modal="true" aria-label={label} aria-labelledby={titleId}>
      <h2 id={titleId}>{title}</h2>
      {children}
      {error && <p className="dialog-save-error" role="alert">{error}</p>}
      <footer className="destructive-dialog-actions">
        <button type="button" className="secondary-button" disabled={deleting} onClick={onCancel}>Cancel</button>
        <button type="button" className="danger-button" disabled={deleting} onClick={() => {
          setDeleting(true)
          setError(null)
          void onConfirm().catch((reason) => {
            setError(reason instanceof Error ? reason.message : 'Nothing was deleted. Please try again.')
            setDeleting(false)
          })
        }}>{deleting ? 'Deleting…' : confirmLabel}</button>
      </footer>
    </section>
  </div>, document.body)
}

function QuestionDeletionConfirmation({ usage, onCancel, onConfirm }: {
  usage: readonly QuestionUsage[]
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  const count = usage.length
  return <DestructiveConfirmation
    label="Permanently delete Question"
    title="Permanently delete this Question?"
    confirmLabel={count === 0 ? 'Delete Question' : `Delete and remove from ${count} ${count === 1 ? 'Exam' : 'Exams'}`}
    onCancel={onCancel}
    onConfirm={onConfirm}
  >
    <p>This cannot be undone.</p>
    {count === 0 ? <p>This Question is not used in any Exams.</p> : <>
      <p>This Question will be removed from every saved Exam and Working Copy below:</p>
      <ul>{usage.map((item) => <li key={item.examId}>{item.title}</li>)}</ul>
    </>}
  </DestructiveConfirmation>
}

function BankDeletionConfirmation({ bank, impact, onCancel, onConfirm }: {
  bank: QuestionBankCollectionItem
  impact: readonly QuestionDeletionImpact[]
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  return <DestructiveConfirmation
    label="Permanently delete Question Bank"
    title={`Permanently delete “${bank.name}”?`}
    confirmLabel="Delete Question Bank"
    onCancel={onCancel}
    onConfirm={onConfirm}
  >
    <p>This cannot be undone.</p>
    {bank.questionCount === 0 ? <p>This empty Question Bank will be permanently deleted.</p> : <>
      <p>{bank.questionCount} {bank.questionCount === 1 ? 'Question' : 'Questions'} will be permanently deleted.</p>
      <p>{impact.length} affected {impact.length === 1 ? 'Exam' : 'Exams'}:</p>
      {impact.length > 0 && <ul>{impact.map((item) => <li key={item.examId}>{item.title} — {item.questionCount} {item.questionCount === 1 ? 'Question' : 'Questions'} removed</li>)}</ul>}
      <p><strong>Export History remains unchanged.</strong> Historical exports stay viewable and can be exported again.</p>
    </>}
  </DestructiveConfirmation>
}

function ResourcePicker({
  title,
  closeLabel,
  emptyMessage,
  resources,
  onChoose,
  onClose,
}: {
  title: string
  closeLabel: string
  emptyMessage: string
  resources: readonly { id: string; name: string; questionCount: number }[]
  onChoose: (id: string) => void
  onClose: () => void
}) {
  const titleId = useId()
  const dialog = useRef<HTMLElement>(null)
  const chosen = useRef(false)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const focusable = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])
    requestAnimationFrame(() => focusable()[0]?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const controls = focusable()
      if (controls.length === 0) return
      const first = controls[0]!
      const last = controls.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (!chosen.current) {
        requestAnimationFrame(() => { if (previous?.isConnected) previous.focus() })
      }
    }
  }, [])

  return createPortal(<div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose()
  }}>
    <section
      ref={dialog}
      className="resource-picker"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <header className="resource-picker-header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="question-bank-action" aria-label={closeLabel} onClick={onClose}><X /></button>
      </header>
      {resources.length === 0 ? <p>{emptyMessage}</p> :
        <div className="resource-picker-list">
          {resources.map((resource) => <button key={resource.id} type="button" onClick={() => {
            chosen.current = true
            onChoose(resource.id)
          }}>
            <strong>{resource.name}</strong>
            <span>{resource.questionCount} {resource.questionCount === 1 ? 'Question' : 'Questions'}</span>
          </button>)}
        </div>}
    </section>
  </div>, document.body)
}

/**
 * One Question Bank, open and editable: its list, its filters, and the dialogs
 * that create, edit, delete and share the Questions in it.
 *
 * It knows nothing about where it is being shown. The Exam editor mounts it in
 * the right-hand pane under a strip of tabs; the Question Bank page mounts one
 * of them full width with no tabs at all. Mount it with `key={bank.id}` — a
 * different bank is a different workspace, and none of the selection or dialog
 * state below should survive the change.
 */
function QuestionBankWorkspace({
  bank,
  heading,
  extraActions,
  service,
  filter,
  onFilterChange,
  onBankChange,
  onBankGone,
  workingCopyIds = new Set(),
  drag: providedDrag,
  examsService,
  onAddToExam,
  onRemoveFromExam,
  beforeCanonicalQuestionCommit,
  onCanonicalQuestionCommitted,
  onQuestionDeleted,
}: {
  bank: QuestionBankResource
  /** Handed to the pane's header, where the surface this is mounted on names
   *  the bank and adds the actions that belong to the surface rather than to
   *  the bank. See `QuestionBankPane`. */
  heading?: ReactNode
  extraActions?: ReactNode
  service: QuestionBankWorkspaceService
  filter: QuestionBankFilter
  onFilterChange: (filter: QuestionBankFilter) => void
  onBankChange: (bank: QuestionBankResource) => void
  /** The bank was disposed of by the deletion that emptied it. */
  onBankGone: () => void
  workingCopyIds?: ReadonlySet<string>
  drag?: ReturnType<typeof useWorkspaceDrag>
  examsService?: ExamWorkspaceService
  onAddToExam?: (question: Question) => void
  onRemoveFromExam?: (questionId: string) => void
  beforeCanonicalQuestionCommit?: () => Promise<void>
  onCanonicalQuestionCommitted?: (question: Question) => void
  onQuestionDeleted?: (questionId: string) => void
}) {
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null)
  const [choosingType, setChoosingType] = useState<MenuPoint | null>(null)
  const [editing, setEditing] = useState<Question | null>(null)
  const [usage, setUsage] = useState<QuestionUsage[] | undefined>()
  const [confirmingDeletion, setConfirmingDeletion] = useState(false)
  const [exporting, setExporting] = useState(false)
  const unavailableDrag = useWorkspaceDrag(() => undefined)
  const drag = providedDrag ?? unavailableDrag

  return <>
    <QuestionBankPane
      bank={{ questions: bank.questions }}
      heading={heading}
      extraActions={extraActions}
      workingCopyIds={workingCopyIds}
      filter={filter}
      onFilterChange={onFilterChange}
      selectedQuestionId={selectedQuestionId}
      onSelect={setSelectedQuestionId}
      drag={drag}
      onCreate={setChoosingType}
      onExport={() => setExporting(true)}
      exportBlocked={editing !== null}
      onEdit={(questionId) => {
        const question = bank.questions.find((candidate) => candidate.id === questionId)
        if (!question) return
        if (!examsService) {
          setEditing(question)
          setUsage(undefined)
          return
        }
        void examsService.questionUsage(questionId).then((questionUsage) => {
          setEditing(question)
          setUsage(questionUsage)
        })
      }}
      onAddToWorkingCopy={onAddToExam
        ? (questionId) => {
            const question = bank.questions.find(({ id }) => id === questionId)
            if (question) onAddToExam(question)
          }
        : undefined}
      onRemoveFromWorkingCopy={onRemoveFromExam}
    />
    {exporting && <QuestionBankExportDialog bank={bank} onClose={() => setExporting(false)} />}
    {choosingType && <ContextMenu
      point={choosingType}
      ariaLabel="Question type"
      items={SECTION_ORDER.map((type) => ({
        kind: 'action' as const,
        label: SECTION_LABELS[type],
        icon: QUESTION_TYPE_ICONS[type],
        onSelect: () => {
          setEditing(createQuestion(type))
          setUsage(undefined)
        },
      }))}
      onClose={() => setChoosingType(null)}
    />}
    {editing && <QuestionDialog
      question={editing}
      isNew={!bank.questions.some((question) => question.id === editing.id)}
      topicSuggestions={topicOptions({ questions: bank.questions })}
      ownerName={bank.name}
      usage={usage}
      onCancel={() => setEditing(null)}
      onDelete={bank.questions.some(({ id }) => id === editing.id) ? () => setConfirmingDeletion(true) : undefined}
      onSave={async (question) => {
        const existing = bank.questions.some((candidate) => candidate.id === question.id)
        if (existing) await beforeCanonicalQuestionCommit?.()
        const updated = existing && examsService
          ? await service.commitCanonicalQuestion(
              bank.id,
              question,
              (canonical) => examsService.propagateCanonicalQuestion(canonical),
            )
          : await service.commit(bank.id, {
              kind: existing ? 'update-question' : 'create-question',
              question,
            })
        onBankChange(updated)
        if (existing) onCanonicalQuestionCommitted?.(question)
        setEditing(null)
      }}
    />}
    {confirmingDeletion && editing && <QuestionDeletionConfirmation
      usage={usage ?? []}
      onCancel={() => setConfirmingDeletion(false)}
      onConfirm={async () => {
        await beforeCanonicalQuestionCommit?.()
        const updated = await service.permanentlyDeleteQuestion(
          bank.id,
          editing.id,
          (ids) => examsService?.forceDeleteQuestions(ids) ?? Promise.resolve({ rollback: async () => undefined, finalize: async () => undefined }),
        )
        if (updated) onBankChange(updated)
        else onBankGone()
        onQuestionDeleted?.(editing.id)
        setSelectedQuestionId(null)
        drag.cancel()
        setConfirmingDeletion(false)
        setEditing(null)
      }}
    />}
  </>
}

function QuestionBankTabsPane({
  context,
  service,
  fallback,
  workingCopyIds = new Set(),
  onQuestionsChange,
  onAddToExam,
  onRemoveFromExam,
  workspaceDrag,
  resourceRevision = 0,
  examsService,
  beforeCanonicalQuestionCommit,
  onCanonicalQuestionCommitted,
  onQuestionDeleted,
}: {
  context: BankWorkspaceContext
  service: QuestionBankWorkspaceService
  fallback?: ReactNode
  workingCopyIds?: ReadonlySet<string>
  onQuestionsChange?: (questions: readonly Question[]) => void
  onAddToExam?: (question: Question) => void
  onRemoveFromExam?: (questionId: string) => void
  workspaceDrag?: ReturnType<typeof useWorkspaceDrag>
  resourceRevision?: number
  examsService?: ExamWorkspaceService
  beforeCanonicalQuestionCommit?: () => Promise<void>
  onCanonicalQuestionCommitted?: (question: Question) => void
  onQuestionDeleted?: (questionId: string) => void
}) {
  const stableContext = useMemo<BankWorkspaceContext>(
    () => ({ examId: context.examId }),
    [context.examId],
  )
  const [workspace, setWorkspace] = useState<QuestionBankTabsWorkspace>(() => ({
    openBankIds: [],
    activeBankId: null,
    filters: {},
    pane: { bankPercent: 33 },
  }))
  const [resources, setResources] = useState<Record<string, QuestionBankResource>>({})
  const [pickerBanks, setPickerBanks] = useState<QuestionBankSummary[] | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [creatingBank, setCreatingBank] = useState(false)

  useEffect(() => {
    let current = true
    void (async () => {
      const saved = await service.workspace(stableContext)
      const loaded = await Promise.all(saved.openBankIds.map((id) => service.read(id)))
      if (!current) return
      const valid = loaded.filter((bank): bank is QuestionBankResource => bank !== null)
      const validIds = valid.map((bank) => bank.id)
      const sanitized = validIds.length === saved.openBankIds.length ? saved : {
        ...saved,
        openBankIds: validIds,
        activeBankId: validIds.includes(saved.activeBankId ?? '')
          ? saved.activeBankId
          : validIds[0] ?? null,
        filters: Object.fromEntries(validIds.map((id) => [id, saved.filters[id] ?? NO_FILTER])),
      }
      setResources(Object.fromEntries(valid.map((bank) => [bank.id, bank])))
      setWorkspace(sanitized)
      if (sanitized !== saved) {
        setMessage('A Question Bank in this workspace is unavailable on this device.')
        await service.saveWorkspace(stableContext, sanitized)
      }
      setHydrated(true)
    })()
    return () => { current = false }
  }, [resourceRevision, service, stableContext])

  const active = workspace.activeBankId ? resources[workspace.activeBankId] : undefined
  useEffect(() => {
    if (hydrated) onQuestionsChange?.(
      Object.values(resources).flatMap((resource) => resource.questions),
    )
  }, [hydrated, onQuestionsChange, resources])
  const filter = active ? workspace.filters[active.id] ?? NO_FILTER : NO_FILTER
  const updateResource = (resource: QuestionBankResource) => {
    setResources((current) => ({ ...current, [resource.id]: resource }))
  }
  const openPicker = async () => setPickerBanks(await service.recent())
  const createBank = async () => {
    setCreatingBank(true)
    setMessage(null)
    try {
      const bank = await service.create()
      const opened = await service.openTab(stableContext, bank.id)
      if (!opened) throw new Error('The new Question Bank could not be opened.')
      setWorkspace(opened.workspace)
      updateResource(opened.bank)
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[role="tab"][data-bank-id="${CSS.escape(bank.id)}"]`)?.focus())
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The Question Bank could not be created.')
    } finally {
      setCreatingBank(false)
    }
  }
  const chooseBank = async (id: string) => {
    const opened = await service.openTab(stableContext, id)
    if (!opened) {
      setMessage('That Question Bank is unavailable on this device.')
      setPickerBanks(null)
      return
    }
    setWorkspace(opened.workspace)
    updateResource(opened.bank)
    setPickerBanks(null)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[role="tab"][data-bank-id="${CSS.escape(id)}"]`)?.focus())
  }
  const activate = async (id: string) => {
    const previousActiveBankId = workspace.activeBankId
    setWorkspace((current) => openBankTab(current, id))
    const opened = await service.openTab(stableContext, id)
    if (!opened) {
      setWorkspace((current) => current.activeBankId === id
        ? { ...current, activeBankId: previousActiveBankId }
        : current)
      setMessage('That Question Bank is unavailable on this device.')
      return
    }
    // The durable response can finish after the teacher has changed this or
    // another tab's filters. Keep the newer in-memory workspace instead of
    // replacing it with the response's earlier snapshot.
    updateResource(opened.bank)
  }
  const close = async (id: string) => {
    const next = closeBankTab(workspace, id)
    setWorkspace((current) => closeBankTab(current, id))
    setResources((current) => {
      const remaining = { ...current }
      delete remaining[id]
      return remaining
    })
    await service.closeTab(stableContext, id)
    requestAnimationFrame(() => {
      const target = next.activeBankId
        ? document.querySelector<HTMLElement>(`[role="tab"][data-bank-id="${CSS.escape(next.activeBankId)}"]`)
        : document.querySelector<HTMLElement>('[aria-label="Open Question Bank"]')
      target?.focus()
    })
  }

  return <div className="bank-tabs-pane">
    {message && <p className="home-error bank-tabs-error" role="alert">{message}</p>}
    <div className="bank-tabs-bar">
      <div className="bank-tabs" role="tablist" aria-label="Open Question Banks">
        {workspace.openBankIds.map((id, index) => {
          const bank = resources[id]
          if (!bank) return null
          return <div className="bank-tab" key={id} data-active={id === workspace.activeBankId ? 'true' : undefined}>
            <button
              type="button"
              role="tab"
              data-bank-id={id}
              aria-selected={id === workspace.activeBankId}
              tabIndex={id === workspace.activeBankId ? 0 : -1}
              onClick={() => void activate(id)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                let next = index
                if (event.key === 'ArrowLeft') next = (index - 1 + workspace.openBankIds.length) % workspace.openBankIds.length
                if (event.key === 'ArrowRight') next = (index + 1) % workspace.openBankIds.length
                if (event.key === 'Home') next = 0
                if (event.key === 'End') next = workspace.openBankIds.length - 1
                const nextId = workspace.openBankIds[next]!
                void activate(nextId).then(() => requestAnimationFrame(() =>
                  document.querySelector<HTMLElement>(`[role="tab"][data-bank-id="${CSS.escape(nextId)}"]`)?.focus(),
                ))
              }}
            >{bank.name}</button>
            <button
              type="button"
              aria-label={`Close ${bank.name}`}
              onClick={() => void close(id)}
            ><X /></button>
          </div>
        })}
      </div>
      {/* Where Chrome keeps it: a plus at the end of the strip, next to the
          tab that was opened last. With no tabs, the empty state below offers
          the same action with a full label instead. */}
      {workspace.openBankIds.length > 0 && <button
        type="button"
        className="open-bank-button"
        aria-label="Open Question Bank"
        title="Open Question Bank"
        disabled={!hydrated}
        onClick={() => void openPicker()}
      ><Plus /></button>}
    </div>
    {active ? <QuestionBankWorkspace
      key={active.id}
      bank={active}
      service={service}
      filter={filter}
      onFilterChange={(nextFilter) => {
        setWorkspace((current) => ({ ...current, filters: { ...current.filters, [active.id]: nextFilter } }))
        void service.updateFilter(stableContext, active.id, nextFilter)
      }}
      onBankChange={updateResource}
      onBankGone={() => void close(active.id)}
      workingCopyIds={workingCopyIds}
      drag={workspaceDrag}
      examsService={examsService}
      onAddToExam={onAddToExam}
      onRemoveFromExam={onRemoveFromExam}
      beforeCanonicalQuestionCommit={beforeCanonicalQuestionCommit}
      onCanonicalQuestionCommitted={onCanonicalQuestionCommitted}
      onQuestionDeleted={onQuestionDeleted}
    /> : fallback ?? <div className="question-bank question-bank-no-tab">
      <div className="question-bank-no-tab-content">
        <h2>Question Bank</h2>
        <p>No Question Bank is open.</p>
        <div className="question-bank-no-tab-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={!hydrated || creatingBank}
            onClick={() => void openPicker()}
          >
            Open Question Bank
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!hydrated || creatingBank}
            onClick={() => void createBank()}
          >
            {creatingBank ? 'Creating…' : 'Create new Question Bank'}
          </button>
        </div>
      </div>
    </div>}
    {pickerBanks && <ResourcePicker
      title="Open Question Bank"
      closeLabel="Close Question Bank picker"
      emptyMessage="No Question Banks are available on this device."
      resources={pickerBanks}
      onChoose={(id) => void chooseBank(id)}
      onClose={() => setPickerBanks(null)}
    />}
  </div>
}


/**
 * The Question Bank page: one bank, full screen, in the same chrome as Home
 * and the collections.
 *
 * Opening a Question Bank is not opening the editor. The editor edits an Exam;
 * a bank is a place you go to write and organise Questions, reached by its own
 * breadcrumb trail and leaving no Exam behind it. Double-clicking a Question
 * here opens the same Question editor the Exam editor's pane opens.
 */
function QuestionBankPage({
  bank: initialBank,
  bankWorkspaces,
  workspaces,
  persistentStorage,
  launchError,
}: {
  bank: QuestionBankResource
  bankWorkspaces: QuestionBankWorkspaceService
  workspaces: ExamWorkspaceService
  persistentStorage: PersistentStorageStatus
  launchError: string | null
}) {
  const [bank, setBank] = useState(initialBank)
  const [name, setName] = useState(initialBank.name)
  const [filter, setFilter] = useState<QuestionBankFilter>(NO_FILTER)
  const [nameError, setNameError] = useState<string | null>(null)
  const [editingDetails, setEditingDetails] = useState(false)
  const [details, setDetails] = useState({
    description: initialBank.description ?? '',
    author: initialBank.author ?? '',
    licenseName: initialBank.license?.name ?? '',
    licenseUrl: initialBank.license?.url ?? '',
  })
  const [detailsBusy, setDetailsBusy] = useState(false)
  const [importAnnouncement] = useState(() => {
    const message = window.sessionStorage.getItem('test-parrot-import-announcement')
    window.sessionStorage.removeItem('test-parrot-import-announcement')
    return message
  })

  useEffect(() => setName(bank.name), [bank.name])

  const commitName = async () => {
    if (name === bank.name) return
    setNameError(null)
    try {
      setBank(await bankWorkspaces.commit(bank.id, { kind: 'rename', name }))
    } catch (error) {
      setNameError(error instanceof Error ? error.message : 'The Question Bank name could not be saved.')
    }
  }

  return <AppShell
    crumbs={[
      { label: 'Home', href: '/' },
      { label: 'Question Banks', href: '/question-banks' },
      { label: bank.name },
    ]}
    persistentStorage={persistentStorage}
    actions={<span className="bank-save-status">Changes save immediately</span>}
  >
    {launchError && <p className="home-error" role="alert">{launchError}</p>}
    {importAnnouncement && <p className="sr-only" role="status" aria-live="polite">{importAnnouncement}</p>}
    <div className="bank-page">
      <QuestionBankWorkspace
        key={bank.id}
        bank={bank}
        // The bank's name is the page's title, so it is what the pane's header
        // row is built around: the actions sit beside it rather than under a
        // second heading that would only say "Question Bank" again.
        heading={<div className="bank-page-heading">
          <input
            aria-label="Question Bank name"
            className="bank-page-title"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => void commitName()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
          {nameError && <p className="home-error bank-name-error" role="alert">{nameError}</p>}
        </div>}
        extraActions={<button type="button" className="secondary-button" aria-haspopup="dialog" onClick={() => setEditingDetails(true)}>Bank details</button>}
        service={bankWorkspaces}
        filter={filter}
        onFilterChange={setFilter}
        onBankChange={setBank}
        onBankGone={() => window.location.assign('/question-banks')}
        examsService={workspaces}
      />
    </div>
    {editingDetails && <div className="dialog-backdrop" role="presentation">
      <section className="question-bank-details-dialog" role="dialog" aria-modal="true" aria-labelledby="bank-details-title">
        <h2 id="bank-details-title">Question Bank details</h2>
        <p>Only details you enter are included when this Question Bank is shared.</p>
        <label>Description<textarea value={details.description} disabled={detailsBusy} onChange={(event) => setDetails({ ...details, description: event.target.value })} /></label>
        <label>Declared author<input value={details.author} disabled={detailsBusy} onChange={(event) => setDetails({ ...details, author: event.target.value })} /></label>
        <label>License name<input value={details.licenseName} disabled={detailsBusy} onChange={(event) => setDetails({ ...details, licenseName: event.target.value })} /></label>
        <label>License URL<input type="url" value={details.licenseUrl} disabled={detailsBusy} onChange={(event) => setDetails({ ...details, licenseUrl: event.target.value })} /></label>
        <div className="dialog-actions">
          <button type="button" className="secondary-button" disabled={detailsBusy} onClick={() => setEditingDetails(false)}>Cancel</button>
          <button type="button" className="primary-button" disabled={detailsBusy} onClick={() => {
            setDetailsBusy(true)
            setNameError(null)
            void bankWorkspaces.commit(bank.id, {
              kind: 'update-provenance',
              provenance: {
                description: details.description,
                author: details.author,
                ...(details.licenseName.trim() ? { license: { name: details.licenseName, ...(details.licenseUrl.trim() ? { url: details.licenseUrl } : {}) } } : {}),
              },
            }).then((updated) => {
              setBank(updated)
              setEditingDetails(false)
            }).catch((error: unknown) => {
              setNameError(error instanceof Error ? error.message : 'Question Bank details could not be saved.')
            }).finally(() => setDetailsBusy(false))
          }}>{detailsBusy ? 'Saving…' : 'Save details'}</button>
        </div>
      </section>
    </div>}
  </AppShell>
}


/** What the Working Copy's state is, in a slot that never changes size. */
const WORKING_COPY_STATES = {
  pending: { Icon: RefreshCw, label: 'Backing up…', detail: 'This change is still being written to this browser.' },
  failed: { Icon: TriangleAlert, label: 'Backup failed', detail: 'This change could not be written to this browser. Export to keep it.' },
  dirty: { Icon: CircleDot, label: 'Unsaved changes · backed up locally', detail: 'Backed up in this browser. Save to update the Exam itself.' },
  saved: { Icon: Check, label: 'Saved', detail: 'Everything in this Working Copy is in the saved Exam.' },
} as const

function WorkingCopyStatus({ dirty, backupStatus }: {
  dirty: boolean
  backupStatus: 'pending' | 'failed' | 'ready'
}) {
  const state = backupStatus === 'pending' ? 'pending'
    : backupStatus === 'failed' ? 'failed'
      : dirty ? 'dirty' : 'saved'
  const { Icon, label, detail } = WORKING_COPY_STATES[state]
  return (
    <div className="working-copy-badge" data-state={state}>
      <button type="button" className="working-copy-badge-button" aria-label={label} aria-describedby="working-copy-tip">
        <Icon aria-hidden="true" />
      </button>
      {/* The words are still here for anyone who needs them: on hover, on
          focus, and — because this is what changed — announced. */}
      <div className="storage-tip working-copy-tip" id="working-copy-tip" role="tooltip">
        <strong>{label}</strong>
        <p>{detail}</p>
      </div>
      <span className="sr-only" role="status" aria-live="polite" aria-label="Working Copy status">{label}</span>
    </div>
  )
}

function ExamEditor({
  store,
  examId,
  bankWorkspaces,
  workspaces,
  exams,
  onHome,
  onOpenExam,
  onSaveAs,
  launchError,
}: {
  store: ExamStore
  examId: string
  bankWorkspaces: QuestionBankWorkspaceService
  workspaces: ExamWorkspaceService
  exams: readonly RecentExam[]
  onHome: () => void
  onOpenExam: (id: string) => void
  onSaveAs: () => Promise<void>
  launchError: string | null
}) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const backupStatus = useSyncExternalStore(store.subscribe, store.backupStatus)
  useEffect(() => {
    if (state.workingCopy.title === 'Untitled Exam' && state.workingCopy.questionIds.length === 0) return
    let current = true
    void store.whenSettled().then(() => {
      if (current && store.backupStatus() === 'ready') void requestPersistentStorage()
    })
    return () => { current = false }
  }, [state.workingCopy.questionIds.length, state.workingCopy.title, store])
  // What the page renders and what an export publishes: the Question Bank
  // records the Working Copy references, in Working Copy order, and nothing else.
  // The store derives it once per change, so it is a stable dependency.
  const { exam, arrangement } = useSyncExternalStore(store.subscribe, store.selectedExam)
  const workingCopyIds = new Set(state.workingCopy.questionIds)
  // A Question being edited. Creation is owned by the active Question Bank;
  // the Exam only opens existing canonical Questions for editing.
  const [editing, setEditing] = useState<{
    question: Question
    destination: 'question-bank'
    after: string | null
    owner?: QuestionBankResource
    usage?: QuestionUsage[]
  } | null>(null)
  // The export dialog owns no Exam state. Its globally remembered preferences
  // survive between Exams without dirtying or saving either Working Copy.
  const [exportDialog, setExportDialog] = useState<{
    configuration: ExportConfiguration
    error: string | null
  } | null>(null)
  const exportButton = useRef<HTMLButtonElement>(null)
  // Export can be opened by its visible button or Cmd/Ctrl+P. Remember the
  // actual focusable opener so dismissing it returns a keyboard user to where
  // they started, rather than always moving them to the toolbar.
  const exportTrigger = useRef<HTMLElement | null>(null)
  const historyButton = useRef<HTMLButtonElement>(null)
  // Browsing an Export Record hides the mounted Exam and puts its immutable
  // stored Layout Plans in the center lane. Current authoring is never rebuilt.
  const [historyOpen, setHistoryOpen] = useState(false)
  const [viewingRecordId, setViewingRecordId] = useState<string | null>(null)
  const [historicalFocusKey, setHistoricalFocusKey] = useState(0)
  const [confirmingQuestionDeletion, setConfirmingQuestionDeletion] = useState(false)
  const priorDraftFocus = useRef<HTMLElement | null>(null)
  const reExportButton = useRef<HTMLButtonElement>(null)
  const exportHistory = store.exportHistory()
  const viewingRecord = exportHistory.records.find(
    (candidate) => candidate.id === viewingRecordId,
  ) ?? null
  const isHistoricalBrowsing = historyOpen || viewingRecord !== null
  const [storageNotice, setStorageNotice] = useState<string | null>(null)
  const [choosingExam, setChoosingExam] = useState(false)
  const [documentMenu, setDocumentMenu] = useState<{
    kind: 'file' | 'edit'
    point: MenuPoint
  } | null>(null)
  const closeExportHistory = useCallback(() => {
    setHistoryOpen(false)
    requestAnimationFrame(() => historyButton.current?.focus())
  }, [])
  const returnToExam = useCallback(() => {
    setViewingRecordId(null)
    requestAnimationFrame(() => {
      if (priorDraftFocus.current?.isConnected) {
        priorDraftFocus.current.focus()
      }
    })
  }, [])
  // Selection lives here, alongside the store, so page interactions and
  // selection-wide context-menu actions share one source of truth.
  const selection = useSelection()
  const clearSelection = selection.clear
  const selectOnWorkingCopy = selection.select
  const [bankPercent, setBankPercent] = useState(33)
  const [bankRevision, setBankRevision] = useState(0)
  useEffect(() => {
    let current = true
    void bankWorkspaces.workspace({ examId }).then((workspace) => {
      if (current) setBankPercent(workspace.pane.bankPercent)
    })
    return () => { current = false }
  }, [bankWorkspaces, examId])
  // A question an authoring action has just put on the Working Copy, waiting to be
  // revealed. `ExamPage` clears it once repagination has actually put it on a
  // page, which — for a change of content — is not the same moment.
  const [revealQuestionId, setRevealQuestionId] = useState<string | null>(null)
  const clearReveal = useCallback(() => setRevealQuestionId(null), [])
  // The outcome of the latest Vary command stays visible and is announced to
  // assistive technology. It is transient UI feedback, not authoring state.
  const [varySummary, setVarySummary] = useState<string | null>(null)
  // Remember the actual authoring control that last held focus. History owns
  // focus while it is open, so it must not replace this restoration target.
  useEffect(() => {
    const remember = (event: FocusEvent) => {
      const target = event.target
      if (
        viewingRecord === null
        && target instanceof HTMLElement
        && target.closest('.draft-document, .document-identity')
      ) {
        priorDraftFocus.current = target
      }
    }
    document.addEventListener('focusin', remember)
    return () => document.removeEventListener('focusin', remember)
  }, [viewingRecord])
  useEffect(() => {
    if (!varySummary) return
    const timer = window.setTimeout(() => setVarySummary(null), 4_000)
    return () => window.clearTimeout(timer)
  }, [varySummary])
  // Storage durability is useful feedback immediately after first
  // publication, not a permanent obstruction over the workspace. It can be
  // dismissed sooner, and otherwise leaves on the same short-lived cadence as
  // the other notices.
  useEffect(() => {
    if (!storageNotice) return
    const timer = window.setTimeout(
      () => setStorageNotice(null),
      STORAGE_NOTICE_DURATION,
    )
    return () => window.clearTimeout(timer)
  }, [storageNotice])
  // One composition, however it was asked for.
  //
  // A pointer gesture, the row's Add button and the row menu's Insert and
  // Replace are four ways of saying the same three things, so they say them
  // here: exactly one call to the authoring boundary, then the incoming
  // question becomes the selected one and is queued to be revealed. That is
  // what makes the paths yield the same Question Bank and Working Copy state
  // rather than merely similar ones — and what stops a question composed one
  // way being findable while the same question composed another way is not.
  const selectAndReveal = (questionId: string) => {
    selectOnWorkingCopy(questionId)
    setRevealQuestionId(questionId)
  }
  const addToWorkingCopy = (question: Question) => {
    store.addToWorkingCopy(question)
    selectAndReveal(question.id)
  }
  const insertIntoWorkingCopy = (
    question: Question,
    targetQuestionId: string,
    placement: QuestionPlacement,
  ) => {
    store.addToWorkingCopy(question, targetQuestionId, placement)
    selectAndReveal(question.id)
  }
  const replaceInWorkingCopy = (outgoingQuestionId: string, incoming: Question) => {
    store.replaceInWorkingCopy(outgoingQuestionId, incoming)
    // Necessary rather than merely tidy: the outgoing question is off the exam
    // now, and a selection pointing at it names no position on the Working Copy.
    selectAndReveal(incoming.id)
  }
  const shuffleSelectedQuestions = (questionIds: readonly string[]) => {
    store.shuffleSelectedQuestions(questionIds)
    setVarySummary('Shuffled question order.')
  }

  const shuffleSelectedAnswers = (questionIds: readonly string[]) => {
    store.shuffleSelectedAnswers(questionIds)
    setVarySummary('Shuffled answer order.')
  }

  // Where a released gesture goes. Each branch is one store call, so one drag
  // is one dirty flag, one mirrored write and one undo step — and the store
  // itself refuses a cross-section or duplicating drop, so the geometry above
  // only ever has to decide *where*, never *whether*.
  const drag = useWorkspaceDrag((source, intent) => {
    if (source.pane === 'exam-draft') {
      // Dragging inside the Working Copy reorders and nothing else: the pane a
      // gesture starts in is what gives it its meaning.
      if (intent.kind !== 'insert') return
      store.moveInWorkingCopy(source.questionIds, intent.targetQuestionId, intent.placement)
      return
    }
    if (intent.kind === 'insert') {
      const question = bankQuestionById(store.getState().questionBank, source.questionId)
      if (question) insertIntoWorkingCopy(question, intent.targetQuestionId, intent.placement)
    } else if (intent.kind === 'replace') {
      const question = bankQuestionById(store.getState().questionBank, source.questionId)
      if (question) replaceInWorkingCopy(intent.outgoingQuestionId, question)
    } else {
      const question = bankQuestionById(store.getState().questionBank, source.questionId)
      if (question) addToWorkingCopy(question)
    }
  })

  const openExport = useCallback(() => {
    // A command may start with focus on the document body. That is not a useful
    // restoration target, so fall back to the visible Export button in that
    // case. A real control, such as the Exam name field, retains its own focus.
    const active = document.activeElement
    exportTrigger.current =
      active instanceof HTMLElement && active !== document.body
        ? active
        : exportButton.current
    setExportDialog({
      configuration: readExportPreferences(),
      error: null,
    })
  }, [])

  useEffect(() => {
    const onSaveShortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === 's'
        && (event.ctrlKey || event.metaKey)
        && !event.altKey
      ) {
        event.preventDefault()
        if (editing || exportDialog || isHistoricalBrowsing) return
        if (event.shiftKey) void onSaveAs()
        else void store.save()
      }
    }
    document.addEventListener('keydown', onSaveShortcut)
    return () => document.removeEventListener('keydown', onSaveShortcut)
  }, [editing, exportDialog, isHistoricalBrowsing, onSaveAs, store])

  useEffect(() => {
    const backupNeedsWarning = () => store.backupStatus() !== 'ready'
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!backupNeedsWarning()) return
      event.preventDefault()
      event.returnValue = ''
    }
    const onBeforeNavigate = (event: Event) => {
      if (!backupNeedsWarning()) return
      // The browser-native beforeunload prompt is unavailable to pushState.
      // Make the same choice explicit for in-app routes.
      if (!window.confirm('Your latest Working Copy has not been backed up locally. Leave anyway?')) {
        event.preventDefault()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener(BEFORE_NAVIGATE_EVENT, onBeforeNavigate)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener(BEFORE_NAVIGATE_EVENT, onBeforeNavigate)
    }
  }, [backupStatus, store])

  useEffect(() => {
    const onPrintShortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === 'p'
        && (event.ctrlKey || event.metaKey)
        && !event.altKey
      ) {
        // There is deliberately no browser-print fallback: even while another
        // modal owns focus, Cmd/Ctrl+P must not bypass recorded export.
        event.preventDefault()
        if (editing || exportDialog || isHistoricalBrowsing || exam.questions.length === 0) return
        openExport()
      }
    }
    document.addEventListener('keydown', onPrintShortcut)
    return () => document.removeEventListener('keydown', onPrintShortcut)
  }, [editing, exam.questions.length, exportDialog, isHistoricalBrowsing, openExport])

  useEffect(() => {
    if (editing || exportDialog) return
    const onKeyDown = (event: KeyboardEvent) => {
      const authoringShortcut =
        (event.key.toLowerCase() === 'z' && (event.ctrlKey || event.metaKey) && !event.altKey)
        || event.key === 'Delete'
        || event.key === 'Backspace'
      if (isHistoricalBrowsing && authoringShortcut) {
        // Do not let Backspace navigate away either: during history inspection
        // these keys name no authoring action at all.
        event.preventDefault()
        return
      }
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
        // Remove, not Delete: the questions come off the Working Copy and stay in
        // the Question Bank, which is why this needs no confirmation.
        store.removeFromWorkingCopy([...selection.selectedIds])
        clearSelection()
        return
      }
      if (event.key !== 'Escape') return
      if (historyOpen) {
        event.preventDefault()
        closeExportHistory()
        return
      }
      if (viewingRecord) {
        event.preventDefault()
        returnToExam()
        return
      }
      clearSelection()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [clearSelection, closeExportHistory, editing, exportDialog, historyOpen, isHistoricalBrowsing, returnToExam, selection.selectedIds, store, viewingRecord])

  const closeExportDialog = () => {
    const trigger = exportTrigger.current
    exportTrigger.current = null
    setExportDialog(null)
    requestAnimationFrame(() => {
      const active = document.activeElement
      if (active && active !== document.body && active !== document.documentElement) return
      if (trigger?.isConnected) trigger.focus()
      else exportButton.current?.focus()
    })
  }

  const prepareForPublication = (
    configuration: ExportConfiguration,
    onProgress?: (progress: PreparationProgress) => void,
  ) => prepareExport({
    examId,
    exam,
    arrangement,
    configuration,
    history: exportHistory,
    measure: domMeasure,
    createdAt: new Date().toISOString(),
    onProgress,
  })

  /**
   * One export, from the Export button to the moment the browser takes over.
   *
   * The selected artifact is fully packaged first. Only then does one IndexedDB
   * transaction commit immutable history, required media, and the current
   * authoring state. The browser receives the download after that commit.
   */
  const runPreparedExport = async (prepared: PreparedExport) => {
    const format = prepared.record.format
    let blob: Blob
    try {
      if (format === 'pdf') {
        const pdf = await import('./pdf-export')
        blob = pdf.pdfBlob(await pdf.createPublicationPdf(prepared.documents))
      } else {
        const docx = await import('./docx-export')
        blob = await docx.createPublicationDocx(prepared.documents)
      }
    } catch (error) {
      console.error(`Could not create the ${format.toUpperCase()} file`, error)
      const media = await import('./export-media')
      const pdf = format === 'pdf' ? await import('./pdf-export') : null
      if (
        media.isRequiredMediaError(error)
        || pdf?.isPdfUnsupportedCharacterError(error)
        || pdf?.isPdfLayoutError(error)
      ) throw error
      throw new Error(
        format === 'pdf'
          ? 'The PDF file could not be created in this browser. Choose DOCX or try again.'
          : 'The Word file could not be created. Please try again.',
      )
    }

    let durability: 'granted' | 'denied' | null = null
    if (exportHistory.records.length === 0) {
      try {
        const storageResult = await requestPersistentStorage()
        durability = storageResult === 'unavailable' ? null : storageResult
      } catch {
        durability = 'denied'
      }
    }

    try {
      await store.publish(prepared.record)
    } catch (error) {
      console.error('Could not commit the Export Record', error)
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        throw new Error(
          'Browser storage is full. Free space in this browser, then try exporting again.',
        )
      }
      throw new Error(
        'The Export Record could not be saved to browser storage, so no download was started. Try again.',
      )
    }

    if (durability) {
      setStorageNotice(
        durability === 'granted'
          ? 'Export History is stored locally in this browser with persistent storage enabled. Keep an external archival copy of important files.'
          : 'Persistent storage was not granted. Export History remains browser-local and may be cleared by the browser; keep an external archival copy.',
      )
    }
    try {
      if (format === 'pdf') {
        const { savePdfFile } = await import('./pdf-export')
        savePdfFile(blob, prepared.filename)
      } else {
        const { saveDocxFile } = await import('./docx-export')
        saveDocxFile(blob, prepared.filename)
      }
    } catch (error) {
      console.error(`Could not start the ${format.toUpperCase()} download`, error)
      throw new Error('The download could not be started. The Export Record remains in History.')
    }
  }

  let exportPreview: PreparedExport | null = null
  let previewError: string | null = null
  if (exportDialog) {
    try {
      const hasNoSelectedContent =
        !exportDialog.configuration.selection.test
        && !exportDialog.configuration.selection.answerKey
      // Prepare the default streams for preview while the selection is invalid,
      // then deliberately show no paper until the teacher chooses content.
      const previewConfiguration = hasNoSelectedContent
        ? DEFAULT_EXPORT_CONFIGURATION
        : exportDialog.configuration
      const prepared = prepareForPublication(previewConfiguration)
      exportPreview = hasNoSelectedContent
        ? { ...prepared, documents: [] }
        : prepared
    } catch (error) {
      previewError = error instanceof Error ? error.message : 'The export cannot be prepared.'
    }
  }

  return (
    <>
      {launchError && <p className="home-error editor-launch-error" role="alert">{launchError}</p>}
      {/* This bar belongs to the Exam. The mark is the way home and the name
          sits beside it, where a document's name sits — the same name that is
          printed on the page's own title line, and the same field: typing in
          either is typing the Exam's name. */}
      <div className="editor-shell">
      <header className="document-bar">
        <div className="document-identity">
          <button
            type="button"
            className="editor-home-mark"
            aria-label="Test Parrot home"
            title="Home"
            onClick={onHome}
          >
            <img className="app-logo" src="/logo.png" alt="" width={36} height={36} />
          </button>
          <div className="document-title-stack">
            <input
              aria-label="Exam name"
              className="document-title"
              value={state.workingCopy.title}
              disabled={isHistoricalBrowsing}
              placeholder="Untitled Exam"
              onChange={(event) => store.setTitle(event.target.value)}
            />
            <nav className="document-menus" aria-label="Exam menus">
              {(['file', 'edit'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className="document-menu-button"
                  aria-haspopup="menu"
                  aria-expanded={documentMenu?.kind === kind}
                  onClick={(event) => {
                    const bounds = event.currentTarget.getBoundingClientRect()
                    setDocumentMenu((current) => current?.kind === kind
                      ? null
                      : { kind, point: { x: bounds.left, y: bounds.bottom + 4 } })
                  }}
                >
                  {kind === 'file' ? 'File' : 'Edit'}
                </button>
              ))}
            </nav>
          </div>
        </div>
        <div className="header-actions">
          <div className="document-edit-actions" aria-label="Editing actions">
            <button
              type="button"
              className="toolbar-icon-button"
              aria-label="Undo"
              title="Undo (Ctrl/Cmd+Z)"
              disabled={isHistoricalBrowsing || !store.canUndo()}
              onClick={() => {
                if (!isHistoricalBrowsing) store.undo()
              }}
            >
              <Undo2 />
            </button>
            <button
              type="button"
              className="toolbar-icon-button"
              aria-label="Redo"
              title="Redo (Ctrl/Cmd+Shift+Z)"
              disabled={isHistoricalBrowsing || !store.canRedo()}
              onClick={() => {
                if (!isHistoricalBrowsing) store.redo()
              }}
            >
              <Redo2 />
            </button>
          </div>
          {/* A mark, not a sentence. It changes on every keystroke, and four
              different sentences in a flex row that wraps means the whole bar
              reflowing under the teacher's hands while they type. The text is
              still there — in the tooltip, and announced to a screen reader —
              but the slot it lives in never changes size. */}
          <WorkingCopyStatus dirty={state.dirty} backupStatus={backupStatus} />
          <button
            ref={historyButton}
            type="button"
            className="toolbar-icon-button"
            aria-label="Export History"
            title="Export History"
            aria-expanded={historyOpen}
            aria-controls="export-history"
            onPointerDown={() => {
              // Reopening History while inspecting a record retains the
              // original target for Back to Exam.
              if (viewingRecord !== null) return
              const active = document.activeElement
              priorDraftFocus.current = active instanceof HTMLElement ? active : null
            }}
            onClick={() => setHistoryOpen((open) => !open)}
          >
            <History aria-hidden="true" />
          </button>
          <button
            type="button"
            className="primary-button"
            aria-label="Save"
            disabled={isHistoricalBrowsing || !state.dirty || backupStatus !== 'ready'}
            onClick={() => void store.save()}
          >
            Save
          </button>
          <button
            ref={exportButton}
            type="button"
            className="secondary-button"
            disabled={backupStatus !== 'ready' || isHistoricalBrowsing}
            aria-haspopup="dialog"
            aria-expanded={exportDialog !== null}
            onClick={() => openExport()}
          >
            Export
          </button>
        </div>
      </header>

      {documentMenu && <ContextMenu
        point={documentMenu.point}
        ariaLabel={`${documentMenu.kind === 'file' ? 'File' : 'Edit'} menu`}
        items={documentMenu.kind === 'file' ? [
          {
            kind: 'action',
            label: 'Open Exam',
            icon: <FolderOpen />,
            onSelect: () => setChoosingExam(true),
          },
          { kind: 'separator' },
          {
            kind: 'action',
            label: 'Save',
            icon: <Save />,
            disabled: isHistoricalBrowsing || !state.dirty || backupStatus !== 'ready',
            onSelect: () => { void store.save() },
          },
          {
            kind: 'action',
            label: 'Save As',
            icon: <SaveAll />,
            disabled: isHistoricalBrowsing,
            onSelect: () => { void onSaveAs() },
          },
          {
            kind: 'action',
            label: 'Discard changes',
            icon: <RefreshCw />,
            disabled: !state.dirty,
            onSelect: () => { void store.discard() },
          },
          { kind: 'separator' },
          {
            kind: 'action',
            label: 'Export',
            icon: <FileType2 />,
            disabled: backupStatus !== 'ready' || isHistoricalBrowsing,
            onSelect: openExport,
          },
          {
            kind: 'action',
            label: 'Export History',
            icon: <History />,
            onSelect: () => {
              if (viewingRecord === null) {
                const active = document.activeElement
                priorDraftFocus.current = active instanceof HTMLElement ? active : null
              }
              setHistoryOpen(true)
            },
          },
        ] : [
          {
            kind: 'action',
            label: 'Undo',
            icon: <Undo2 />,
            disabled: isHistoricalBrowsing || !store.canUndo(),
            onSelect: () => store.undo(),
          },
          {
            kind: 'action',
            label: 'Redo',
            icon: <Redo2 />,
            disabled: isHistoricalBrowsing || !store.canRedo(),
            onSelect: () => store.redo(),
          },
        ]}
        onClose={() => setDocumentMenu(null)}
      />}

      {choosingExam && <ResourcePicker
        title="Open Exam"
        closeLabel="Close Exam picker"
        emptyMessage="No other Exams are available on this device."
        resources={exams
          .filter((candidate) => candidate.id !== examId)
          .map((candidate) => ({
            id: candidate.id,
            name: candidate.title,
            questionCount: candidate.questionCount,
          }))}
        onChoose={onOpenExam}
        onClose={() => setChoosingExam(false)}
      />}

      {exportDialog && (
        <ExportDialog
          configuration={exportDialog.configuration}
          onConfigurationChange={(configuration) => {
            writeExportPreferences(configuration)
            setExportDialog((current) => (current ? { ...current, configuration } : current))
          }}
          previewPlans={exportPreview?.documents ?? []}
          empty={exam.questions.length === 0}
          initialError={exportDialog.error ?? previewError}
          onSubmit={async (configuration, onProgress) => {
            await runPreparedExport(prepareForPublication(configuration, onProgress))
            closeExportDialog()
          }}
          onCancel={closeExportDialog}
        />
      )}

      <ExportHistoryDrawer
        records={exportHistory.records}
        selectedRecordId={viewingRecord?.id ?? null}
        open={historyOpen}
        onOpenChange={(open) => {
          if (open) setHistoryOpen(true)
          else closeExportHistory()
        }}
        onSelect={(selectedRecord) => {
          setViewingRecordId(selectedRecord.id)
          setHistoricalFocusKey((key) => key + 1)
          setHistoryOpen(false)
        }}
      />

      {/* The split authoring workspace: the Question Bank beside the rendered
          Working Copy. The bank opens as the narrower pane — it is picked from
          rather than read — and the divider moves. */}
      <WorkspaceSplit
        initialBankPercent={bankPercent}
        onBankPercentChange={(percent) => {
          setBankPercent(percent)
          void bankWorkspaces.updatePane({ examId }, percent)
        }}
        bank={
          <div
            className="question-bank-authoring"
            inert={isHistoricalBrowsing || undefined}
            aria-hidden={isHistoricalBrowsing || undefined}
          >
          <QuestionBankTabsPane
            context={{ examId }}
            service={bankWorkspaces}
            workingCopyIds={workingCopyIds}
            onQuestionsChange={store.syncCanonicalQuestions}
            onAddToExam={addToWorkingCopy}
            onRemoveFromExam={(questionId) => {
              store.removeFromWorkingCopy([questionId])
              if (selection.isSelected(questionId)) selection.toggle(questionId)
            }}
            workspaceDrag={drag}
            resourceRevision={bankRevision}
            examsService={workspaces}
            beforeCanonicalQuestionCommit={() => store.whenSettled()}
            onCanonicalQuestionCommitted={(question) => store.syncCanonicalQuestions([question])}
            onQuestionDeleted={(questionId) => {
              store.acceptForcedDeletion([questionId])
              clearSelection()
              drag.cancel()
              setBankRevision((revision) => revision + 1)
            }}
          />
          </div>
        }
        workingCopy={
          <>
            <div
              className="draft-document"
              hidden={viewingRecord !== null}
              // The drawer is itself historical browsing, so the exposed part
              // of the draft cannot receive pointer authoring gestures either.
              inert={isHistoricalBrowsing || undefined}
              aria-hidden={isHistoricalBrowsing || undefined}
            >
              <ExamPage
            exam={exam}
            arrangement={arrangement}
            selection={selection}
            drag={drag}
            revealQuestionId={revealQuestionId}
            onRevealed={clearReveal}
            onTitleChange={(title) => store.setTitle(title)}
            titleDisabled={isHistoricalBrowsing}
            onEdit={(questionId) => {
              const question = bankQuestionById(state.questionBank, questionId)
              if (!question) return
              void Promise.all([
                bankWorkspaces.ownerOfQuestion(questionId),
                workspaces.questionUsage(questionId),
              ]).then(([owner, usage]) => {
                setEditing({ question, destination: 'question-bank', after: null, owner: owner ?? undefined, usage })
              })
            }}
            onDuplicate={(questionId) => {
              void (async () => {
                const original = bankQuestionById(store.getState().questionBank, questionId)
                if (!original) return
                const owner = await bankWorkspaces.ownerOfQuestion(questionId)
                if (!owner) {
                  store.duplicateInWorkingCopy(questionId)
                  return
                }
                const before = new Set(owner.questions.map(({ id }) => id))
                const updated = await bankWorkspaces.commit(owner.id, {
                  kind: 'duplicate-question',
                  questionId,
                })
                const copy = updated.questions.find(({ id }) => !before.has(id))
                if (!copy) return
                store.duplicateInWorkingCopy(questionId, copy)
                setBankRevision((revision) => revision + 1)
              })()
            }}
            onShuffleSelected={shuffleSelectedQuestions}
            onShuffleSelectedAnswers={shuffleSelectedAnswers}
            onRemove={(questionIds) => {
              store.removeFromWorkingCopy(questionIds)
              selection.clear()
            }}
            onSetColumns={(questionIds, columns) =>
              store.setQuestionColumns(questionIds, columns)
            }
                unsavedDraft={!store.hasSavedExam()}
              />
            </div>
            {viewingRecord && (
              <HistoricalExportRecord
                record={viewingRecord}
                focusKey={historicalFocusKey}
                reExportButton={reExportButton}
                onBack={returnToExam}
                onReExport={() => {
                  void runPreparedExport(prepareHistoricalExport({
                    record: viewingRecord,
                    createdAt: new Date().toISOString(),
                  }))
                }}
              />
            )}
            <Footer />
          </>
        }
      />
      </div>

      {varySummary && (
        <p className="vary-summary" role="status" aria-live="polite">
          {varySummary}
        </p>
      )}

      {storageNotice && (
        <div className="storage-notice" role="status" aria-live="polite">
          <p>{storageNotice}</p>
          <button
            type="button"
            className="toolbar-icon-button"
            aria-label="Dismiss storage notice"
            onClick={() => setStorageNotice(null)}
          >
            ×
          </button>
        </div>
      )}

      {editing && (
        <QuestionDialog
          question={editing.question}
          isNew={!bankQuestionById(state.questionBank, editing.question.id)}
          topicSuggestions={topicOptions(state.questionBank)}
          ownerName={editing.owner?.name}
          usage={editing.usage}
          onCancel={() => setEditing(null)}
          onDelete={bankQuestionById(state.questionBank, editing.question.id) ? () => {
            void (async () => {
              const [owner, usage] = await Promise.all([
                editing.owner ? Promise.resolve(editing.owner) : bankWorkspaces.ownerOfQuestion(editing.question.id),
                editing.usage ? Promise.resolve(editing.usage) : workspaces.questionUsage(editing.question.id),
              ])
              setEditing((current) => current ? { ...current, owner: owner ?? undefined, usage } : current)
              setConfirmingQuestionDeletion(true)
            })()
          } : undefined}
          onSave={async (saved) => {
            // Existing Questions are committed through their owning bank even
            // when this canonical editor was opened from an Exam. Exam state
            // changes only after that durable commit succeeds.
            if (bankQuestionById(state.questionBank, saved.id)) {
              const owner = editing.owner ?? await bankWorkspaces.ownerOfQuestion(saved.id)
              if (!owner) throw new Error('The owning Question Bank is unavailable on this device.')
              await store.whenSettled()
              await bankWorkspaces.commitCanonicalQuestion(
                owner.id,
                saved,
                (canonical) => workspaces.propagateCanonicalQuestion(canonical),
              )
              store.syncCanonicalQuestions([saved])
              setBankRevision((revision) => revision + 1)
            } else {
              store.createInQuestionBank(saved)
              await store.whenSettled()
            }
            setEditing(null)
          }}
        />
      )}

      {confirmingQuestionDeletion && editing && editing.owner && <QuestionDeletionConfirmation
        usage={editing.usage ?? []}
        onCancel={() => setConfirmingQuestionDeletion(false)}
        onConfirm={async () => {
          await store.whenSettled()
          await bankWorkspaces.permanentlyDeleteQuestion(
            editing.owner!.id,
            editing.question.id,
            (ids) => workspaces.forceDeleteQuestions(ids),
          )
          store.acceptForcedDeletion([editing.question.id])
          clearSelection()
          drag.cancel()
          setBankRevision((revision) => revision + 1)
          setConfirmingQuestionDeletion(false)
          setEditing(null)
        }}
      />}
    </>
  )
}

/**
 * The site's three pages. The editor is the app; About and Privacy are the
 * ordinary pages a public tool is expected to have, reached from the footer.
 */
export default function App({
  store,
  bank,
  workspaces,
  bankWorkspaces,
  initialExams,
  initialBankCollection,
  persistentStorage,
  initialEditorId,
  initialError,
}: {
  store: ExamStore | null
  /** The Question Bank the `/question-bank` route was entered for. */
  bank: QuestionBankResource | null
  workspaces: ExamWorkspaceService
  bankWorkspaces: QuestionBankWorkspaceService
  initialExams: readonly RecentExam[]
  initialBankCollection: readonly QuestionBankCollectionItem[]
  persistentStorage: PersistentStorageStatus
  initialEditorId: string | null
  initialError: string | null
}) {
  const route = useRoute()
  const [exams, setExams] = useState(initialExams)
  const [bankCollection, setBankCollection] = useState(initialBankCollection)
  const [storageStatus, setStorageStatus] = useState(persistentStorage)
  const [editorStore, setEditorStore] = useState(store)
  const [editorId, setEditorId] = useState(initialEditorId)
  const [deletingBank, setDeletingBank] = useState<{ bank: QuestionBankCollectionItem; impact: QuestionDeletionImpact[] } | null>(null)
  const [inspectingBankFile, setInspectingBankFile] = useState(false)
  const [droppedBankFile, setDroppedBankFile] = useState<File | null>(null)
  const homeError = initialError
  const importBank = useCallback(async (
    proposal: import('./question-bank-import').QuestionBankImportProposal,
    proposedName: string,
  ) => {
    const imported = await bankWorkspaces.import(proposal, proposedName)
    window.sessionStorage.setItem(
      'test-parrot-import-announcement',
      `Imported ${imported.questions.length} ${imported.questions.length === 1 ? 'Question' : 'Questions'} into ${imported.name}.`,
    )
    window.location.assign(`/question-bank?id=${imported.id}`)
  }, [bankWorkspaces])
  const requestBankDeletion = useCallback((bank: QuestionBankCollectionItem) => {
    void bankWorkspaces.read(bank.id).then(async (resource) => {
      const impact = await workspaces.deletionImpact(resource?.questions.map(({ id }) => id) ?? [])
      setDeletingBank({ bank, impact })
    })
  }, [bankWorkspaces, workspaces])
  const bankDeletionConfirmation = deletingBank && <BankDeletionConfirmation
    bank={deletingBank.bank}
    impact={deletingBank.impact}
    onCancel={() => setDeletingBank(null)}
    onConfirm={async () => {
      const bank = await bankWorkspaces.read(deletingBank.bank.id)
      if (!bank) throw new Error('That Question Bank is unavailable on this device.')
      await bankWorkspaces.permanentlyDeleteBank(bank.id, (ids) => workspaces.forceDeleteQuestions(ids))
      setBankCollection((current) => current.filter(({ id }) => id !== bank.id))
      setExams(await workspaces.recent())
      setDeletingBank(null)
    }}
  />
  const saveAs = useCallback(async () => {
    if (!editorStore) return
    const sourceId = await workspaces.activeId()
    if (!sourceId) throw new Error('The source Exam is unavailable.')
    let targetId: string | null = null
    const session = await editorStore.saveAs(async (snapshot) => {
      targetId = (await workspaces.saveAs(sourceId, snapshot)).id
    })
    if (!targetId) throw new Error('The copied Exam is unavailable.')
    const target = session.initial
    const saved = {
      questionBank: target.questionBank,
      workingCopy: target.workingCopy,
    }
    setEditorStore(createExamStore({
      backend: workspaces.backendFor(targetId),
      saved,
      initial: target,
      initialHistory: session.history,
    }))
    setEditorId(targetId)
  }, [editorStore, workspaces])
  useEffect(() => {
    if (route !== '/') return
    let current = true
    void (async () => {
      await workspaces.cleanupPristine({ includeActive: true })
      await bankWorkspaces.cleanupPristine({ includeActive: true })
      const [recent, recentBanks] = await Promise.all([
        workspaces.recent(),
        bankWorkspaces.recent(),
      ])
      const [collection, currentStorageStatus] = await Promise.all([
        questionBankCollection(recentBanks, bankWorkspaces, workspaces),
        persistentStorageStatus(),
      ])
      if (current) {
        setExams(recent)
        setBankCollection(collection)
        setStorageStatus(currentStorageStatus)
      }
    })()
    return () => { current = false }
  }, [route, workspaces, bankWorkspaces])
  const newExam = () => { void workspaces.create().then((exam) => window.location.assign(`/editor?exam=${exam.id}`)) }
  const newBank = () => { void bankWorkspaces.create().then((bank) => window.location.assign(`/question-bank?id=${bank.id}`)) }
  const openExam = (id: string) => window.location.assign(`/editor?exam=${id}`)
  const openBank = (id: string) => window.location.assign(`/question-bank?id=${id}`)
  const importDialog = inspectingBankFile && <QuestionBankImportDialog
    key={droppedBankFile ? `${droppedBankFile.name}:${droppedBankFile.lastModified}` : 'chosen'}
    initialFile={droppedBankFile ?? undefined}
    onClose={() => { setInspectingBankFile(false); setDroppedBankFile(null) }}
    onImport={importBank}
  />
  // Importing by drop is offered on every page, the editor included, so the
  // overlay and the dialog live outside the route switch below.
  const globalChrome = <>
    <BankFileDropTarget onFile={(file) => { setDroppedBankFile(file); setInspectingBankFile(true) }} />
    {importDialog}
  </>
  if (route === '/about') return <>{globalChrome}<AboutPage persistentStorage={storageStatus} /></>
  if (route === '/privacy') return <>{globalChrome}<PrivacyPage persistentStorage={storageStatus} /></>
  if (route === '/exams') return <>{globalChrome}<ResourceCollectionPage
    kind="exams"
    exams={exams}
    banks={bankCollection}
    persistentStorage={storageStatus}
    onOpenExam={openExam}
    onOpenBank={openBank}
    onNewExam={newExam}
  />{bankDeletionConfirmation}</>
  if (route === '/question-banks') return <>{globalChrome}<ResourceCollectionPage
    kind="question-banks"
    exams={exams}
    banks={bankCollection}
    persistentStorage={storageStatus}
    onOpenExam={openExam}
    onOpenBank={openBank}
    onNewBank={newBank}
    onDeleteBank={requestBankDeletion}
    onImportBank={() => setInspectingBankFile(true)}
  />{bankDeletionConfirmation}</>
  if (route === '/') return <>{globalChrome}<HomePage
    exams={exams}
    banks={bankCollection}
    error={homeError}
    persistentStorage={storageStatus}
    onNewExam={newExam}
    onOpen={openExam}
    onNewBank={newBank}
    onImportBank={() => setInspectingBankFile(true)}
    onOpenBank={openBank}
    onDeleteBank={requestBankDeletion}
  />{bankDeletionConfirmation}</>
  if (route === '/question-bank') return bank ? <>{globalChrome}<QuestionBankPage
    bank={bank}
    bankWorkspaces={bankWorkspaces}
    workspaces={workspaces}
    persistentStorage={storageStatus}
    launchError={initialError}
  /></> : globalChrome
  return editorStore && editorId ? <>{globalChrome}<ExamEditor
    store={editorStore}
    examId={editorId}
    bankWorkspaces={bankWorkspaces}
    workspaces={workspaces}
    exams={exams}
    launchError={initialError}
    onSaveAs={saveAs}
    onOpenExam={(id) => {
      void (async () => {
        await bankWorkspaces.carryWorkspace({ examId: editorId }, { examId: id })
        if (!await workspaces.open(id)) return
        setEditorStore(await loadExamStore(workspaces.backendFor(id)))
        setEditorId(id)
      })()
    }}
    onHome={() => {
    void workspaces.activeId().then(async (id) => {
      if (id) await workspaces.removePristine(id)
      window.location.assign('/')
    })
  }} /></> : globalChrome
}
