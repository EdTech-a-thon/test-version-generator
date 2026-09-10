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
import { createExamStore, type ExamStore } from './exam-store'
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
  FileType2,
  Gauge,
  ListChecks,
  Plus,
  Redo2,
  Tags,
  Undo2,
  X,
} from 'lucide-react'
import { ContextMenu, type MenuPoint } from './context-menu'
import { BEFORE_NAVIGATE_EVENT, useRoute } from './use-route'
import { Footer } from './site-chrome'
import { HomePage } from './home-page'
import type { ExamWorkspaceService, RecentExam } from './exam-workspaces'
import {
  type QuestionBankResourceStore,
  type QuestionBankResource,
  type QuestionBankSummary,
  type QuestionBankTabsWorkspace,
  type BankWorkspaceContext,
  closeBankTab,
  openBankTab,
  type QuestionBankWorkspaceService,
} from './question-bank-workspaces'
import {
  HistoricalDocument,
  ReviewHistoricalQuestions,
  UseAsDraftConfirmation,
  VersionHistoryDrawer,
} from './version-history'
import {
  compatibleHistoricalDraft,
  draftMatchesHistoricalVersion,
  historicalReconciliation,
} from './historical-draft'
import { AboutPage, PrivacyPage } from './site-pages'

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

function QuestionBankTabsPane({
  context,
  service,
  initialResource,
  fallback,
  onActiveResourceChange,
}: {
  context: BankWorkspaceContext
  service: QuestionBankWorkspaceService
  initialResource?: QuestionBankResource
  fallback?: ReactNode
  onActiveResourceChange?: (resource: QuestionBankResource | null) => void
}) {
  const stableContext = useMemo<BankWorkspaceContext>(
    () => ({ mode: context.mode, resourceId: context.resourceId }),
    [context.mode, context.resourceId],
  )
  const [workspace, setWorkspace] = useState<QuestionBankTabsWorkspace>(() => ({
    openBankIds: initialResource ? [initialResource.id] : [],
    activeBankId: initialResource?.id ?? null,
    filters: initialResource ? { [initialResource.id]: NO_FILTER } : {},
    pane: { bankPercent: 33 },
  }))
  const [resources, setResources] = useState<Record<string, QuestionBankResource>>(() =>
    initialResource ? { [initialResource.id]: initialResource } : {},
  )
  const [pickerBanks, setPickerBanks] = useState<QuestionBankSummary[] | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null)
  const [choosingType, setChoosingType] = useState<MenuPoint | null>(null)
  const [editing, setEditing] = useState<Question | null>(null)
  const drag = useWorkspaceDrag(() => undefined)

  useEffect(() => {
    if (initialResource) {
      setResources((current) => ({ ...current, [initialResource.id]: initialResource }))
    }
  }, [initialResource])

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
  }, [service, stableContext])

  const active = workspace.activeBankId ? resources[workspace.activeBankId] : undefined
  useEffect(() => {
    if (hydrated) onActiveResourceChange?.(active ?? null)
  }, [active, hydrated, onActiveResourceChange])
  const filter = active ? workspace.filters[active.id] ?? NO_FILTER : NO_FILTER
  const updateResource = (resource: QuestionBankResource) => {
    setResources((current) => ({ ...current, [resource.id]: resource }))
  }
  const openPicker = async () => setPickerBanks(await service.recent())
  const chooseBank = async (id: string) => {
    const opened = await service.openTab(stableContext, id)
    if (!opened) {
      setMessage('That Question Bank is unavailable on this device.')
      setPickerBanks(null)
      return
    }
    setWorkspace(opened.workspace)
    updateResource(opened.bank)
    setSelectedQuestionId(null)
    setPickerBanks(null)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[role="tab"][data-bank-id="${CSS.escape(id)}"]`)?.focus())
  }
  const activate = async (id: string) => {
    const previousActiveBankId = workspace.activeBankId
    setWorkspace((current) => openBankTab(current, id))
    setSelectedQuestionId(null)
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
    setSelectedQuestionId(null)
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
      <button type="button" className="open-bank-button" aria-label="Open Question Bank" disabled={!hydrated} onClick={() => void openPicker()}>Open Question Bank</button>
    </div>
    {active ? <QuestionBankPane
      bank={{ questions: active.questions }}
      examDraftIds={new Set()}
      filter={filter}
      onFilterChange={(nextFilter) => {
        setWorkspace((current) => ({ ...current, filters: { ...current.filters, [active.id]: nextFilter } }))
        void service.updateFilter(stableContext, active.id, nextFilter)
      }}
      selectedQuestionId={selectedQuestionId}
      onSelect={setSelectedQuestionId}
      drag={drag}
      onCreate={setChoosingType}
      onEdit={(questionId) => {
        const question = active.questions.find((candidate) => candidate.id === questionId)
        if (question) setEditing(question)
      }}
    /> : fallback ?? <div className="question-bank question-bank-no-tab"><p>No Question Bank is open.</p></div>}
    {pickerBanks && <ResourcePicker
      title="Open Question Bank"
      closeLabel="Close Question Bank picker"
      emptyMessage="No Question Banks are available on this device."
      resources={pickerBanks}
      onChoose={(id) => void chooseBank(id)}
      onClose={() => setPickerBanks(null)}
    />}
    {choosingType && <ContextMenu
      point={choosingType}
      ariaLabel="Question type"
      items={SECTION_ORDER.map((type) => ({
        kind: 'action' as const,
        label: SECTION_LABELS[type],
        icon: QUESTION_TYPE_ICONS[type],
        onSelect: () => setEditing(createQuestion(type)),
      }))}
      onClose={() => setChoosingType(null)}
    />}
    {editing && active && <QuestionDialog
      question={editing}
      isNew={!active.questions.some((question) => question.id === editing.id)}
      topicSuggestions={topicOptions({ questions: active.questions })}
      onCancel={() => setEditing(null)}
      onSave={async (question) => {
        const updated = await service.commit(active.id, {
          kind: active.questions.some((candidate) => candidate.id === question.id)
            ? 'update-question'
            : 'create-question',
          question,
        })
        updateResource(updated)
        setEditing(null)
      }}
    />}
  </div>
}

function QuestionBankEditor({
  initialResource,
  bankWorkspaces,
  exams,
  onHome,
  onOpenExam,
  onNewExam,
  launchError,
}: {
  initialResource?: QuestionBankResource
  bankWorkspaces: QuestionBankWorkspaceService
  exams: readonly RecentExam[]
  onHome: () => void
  onOpenExam: (id: string) => void
  onNewExam: () => void
  launchError: string | null
}) {
  const [activeResource, setActiveResource] = useState<QuestionBankResource | null>(initialResource ?? null)
  const [name, setName] = useState(initialResource?.name ?? '')
  const [nameError, setNameError] = useState<string | null>(null)
  const [choosingExam, setChoosingExam] = useState(false)

  useEffect(() => setName(activeResource?.name ?? ''), [activeResource?.name])

  const commitName = async () => {
    if (!activeResource || name === activeResource.name) return
    setNameError(null)
    try {
      const updated = await bankWorkspaces.commit(activeResource.id, { kind: 'rename', name })
      setActiveResource(updated)
    } catch (error) {
      setNameError(error instanceof Error ? error.message : 'The Question Bank name could not be saved.')
    }
  }

  return <>
    {launchError && <p className="home-error editor-launch-error" role="alert">{launchError}</p>}
    <header className="document-bar">
      <div className="document-identity">
        <img className="app-logo" src="/logo.png" alt="Test Parrot" width={36} height={36} />
        {activeResource ? <input
          aria-label="Question Bank name"
          className="document-title"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void commitName()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        /> : <span className="document-title bank-workspace-title">Question Banks</span>}
      </div>
      <div className="header-actions">
        <span className="bank-save-status">Changes save immediately</span>
        <button type="button" className="site-link editor-home-link" onClick={onHome}>Home</button>
      </div>
    </header>
    {nameError && <p className="home-error bank-name-error" role="alert">{nameError}</p>}
    <div className="bank-only-workspace">
      <div className="question-bank-authoring">
        <QuestionBankTabsPane
          context={{ mode: 'bank', resourceId: initialResource?.id ?? '' }}
          service={bankWorkspaces}
          initialResource={activeResource ?? undefined}
          onActiveResourceChange={setActiveResource}
        />
      </div>
      <main className="bank-only-empty" aria-label="Bank-only editor">
        <h1>No Exam open</h1>
        <p>Create and edit reusable Questions here without creating or changing an Exam.</p>
        <div className="bank-only-actions">
          <button type="button" className="primary-button" onClick={onNewExam}>New Exam</button>
          <button type="button" className="secondary-button" onClick={() => setChoosingExam(true)}>Open existing Exam</button>
        </div>
      </main>
    </div>
    <Footer />
    {choosingExam && <ResourcePicker
      title="Open Exam"
      closeLabel="Close Exam picker"
      emptyMessage="No Exams are available on this device."
      resources={exams.map((exam) => ({ id: exam.id, name: exam.title, questionCount: exam.questionCount }))}
      onChoose={onOpenExam}
      onClose={() => setChoosingExam(false)}
    />}
  </>
}

function ExamEditor({
  store,
  examId,
  bankWorkspaces,
  onHome,
  onSaveAs,
  launchError,
}: {
  store: ExamStore
  examId: string
  bankWorkspaces: QuestionBankWorkspaceService
  onHome: () => void
  onSaveAs: () => Promise<void>
  launchError: string | null
}) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const backupStatus = useSyncExternalStore(store.subscribe, store.backupStatus)
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
    source: 'live-draft' | 'historical-version'
  } | null>(null)
  const exportButton = useRef<HTMLButtonElement>(null)
  // Export can be opened by its visible button or Cmd/Ctrl+P. Remember the
  // actual focusable opener so dismissing it returns a keyboard user to where
  // they started, rather than always moving them to the toolbar.
  const exportTrigger = useRef<HTMLElement | null>(null)
  const historyButton = useRef<HTMLButtonElement>(null)
  // Browsing a Version hides the mounted draft document and puts its immutable
  // stored Layout Plans in the same center lane. Returning therefore restores
  // the same editing view rather than rebuilding authoring state.
  const [historyOpen, setHistoryOpen] = useState(false)
  const [viewingVersionId, setViewingVersionId] = useState<string | null>(null)
  const [historicalFocusKey, setHistoricalFocusKey] = useState(0)
  const [confirmingUseAsDraft, setConfirmingUseAsDraft] = useState(false)
  const [reviewingHistoricalQuestions, setReviewingHistoricalQuestions] = useState(false)
  const priorDraftFocus = useRef<HTMLElement | null>(null)
  const useAsDraftButton = useRef<HTMLButtonElement>(null)
  const publicationHistory = store.publicationHistory()
  const viewingVersion = publicationHistory.versions.find(
    (candidate) => candidate.id === viewingVersionId,
  ) ?? null
  // History inspection is read-only: no authoring command may leak through to
  // the still-mounted draft while a drawer or stored Version is in front.
  const isHistoricalBrowsing = historyOpen || viewingVersion !== null
  const historicalDraft = viewingVersion
    ? compatibleHistoricalDraft(
      publicationHistory,
      viewingVersion,
      state.examDraft,
      state.questionBank,
    )
    : null
  const historicalReview = viewingVersion
    ? historicalReconciliation(
      publicationHistory,
      viewingVersion,
      state.questionBank,
    )
    : null
  const lastExportedVersion = state.lastExportedVersionId
    ? publicationHistory.versions.find((version) => version.id === state.lastExportedVersionId) ?? null
    : publicationHistory.versions.at(-1) ?? null
  const draftDiffersFromLastVersion = lastExportedVersion
    ? !draftMatchesHistoricalVersion(
      publicationHistory,
      lastExportedVersion,
      state.examDraft,
      state.questionBank,
    )
    : state.dirty
  const [storageNotice, setStorageNotice] = useState<string | null>(null)
  const closeVersionHistory = useCallback(() => {
    setHistoryOpen(false)
    requestAnimationFrame(() => historyButton.current?.focus())
  }, [])
  const returnToExamDraft = useCallback(() => {
    setViewingVersionId(null)
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
  const selectOnExamDraft = selection.select
  // The legacy per-Exam bank fallback keeps its filter here; real bank tabs
  // persist theirs through the separate workspace service. Neither path is an
  // authoring action, dirties the Exam, or appears in Undo history.
  const [bankFilter, setBankFilter] = useState<QuestionBankFilter>(NO_FILTER)
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null)
  const [bankPercent, setBankPercent] = useState(33)
  useEffect(() => {
    let current = true
    void bankWorkspaces.workspace({ mode: 'exam', resourceId: examId }).then((workspace) => {
      if (current) setBankPercent(workspace.pane.bankPercent)
    })
    return () => { current = false }
  }, [bankWorkspaces, examId])
  // A question an authoring action has just put on the Exam Draft, waiting to be
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
        viewingVersion === null
        && target instanceof HTMLElement
        && target.closest('.draft-document, .document-identity')
      ) {
        priorDraftFocus.current = target
      }
    }
    document.addEventListener('focusin', remember)
    return () => document.removeEventListener('focusin', remember)
  }, [viewingVersion])
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
    // The rendered Exam is the Working Copy's effective arrangement, including
    // any Exam-only column override; canonical Question Content is only the
    // fallback for a question not currently composed here.
    const above = afterQuestionId
      ? exam.questions.find((question) => question.id === afterQuestionId)
      : undefined
    if (above?.type === 'multiple-choice') return columnsOf(above)
    for (let index = exam.questions.length - 1; index >= 0; index -= 1) {
      const question = exam.questions[index]!
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

  const openExport = useCallback((
    source: 'live-draft' | 'historical-version' = viewingVersion
      ? 'historical-version'
      : 'live-draft',
  ) => {
    // A command may start with focus on the document body. That is not a useful
    // restoration target, so fall back to the visible Export button in that
    // case. A real control, such as the Exam name field, retains its own focus.
    const active = document.activeElement
    exportTrigger.current =
      active instanceof HTMLElement && active !== document.body
        ? active
        : exportButton.current
    setExportDialog({
      configuration: DEFAULT_EXPORT_CONFIGURATION,
      error: null,
      source,
    })
  }, [viewingVersion])

  useEffect(() => {
    const onSaveShortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === 's'
        && (event.ctrlKey || event.metaKey)
        && !event.altKey
      ) {
        event.preventDefault()
        if (editing || exportDialog || confirmingUseAsDraft || reviewingHistoricalQuestions || isHistoricalBrowsing) return
        if (event.shiftKey) void onSaveAs()
        else void store.save()
      }
    }
    document.addEventListener('keydown', onSaveShortcut)
    return () => document.removeEventListener('keydown', onSaveShortcut)
  }, [confirmingUseAsDraft, editing, exportDialog, isHistoricalBrowsing, onSaveAs, reviewingHistoricalQuestions, store])

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
        // modal owns focus, Cmd/Ctrl+P must not bypass Version publication.
        event.preventDefault()
        if (editing || exportDialog || confirmingUseAsDraft || reviewingHistoricalQuestions) return
        openExport()
      }
    }
    document.addEventListener('keydown', onPrintShortcut)
    return () => document.removeEventListener('keydown', onPrintShortcut)
  }, [confirmingUseAsDraft, editing, exportDialog, openExport, reviewingHistoricalQuestions])

  useEffect(() => {
    if (editing || exportDialog || confirmingUseAsDraft || reviewingHistoricalQuestions) return
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
        // Remove, not Delete: the questions come off the Exam Draft and stay in
        // the Question Bank, which is why this needs no confirmation.
        store.removeFromExamDraft([...selection.selectedIds])
        clearSelection()
        return
      }
      if (event.key !== 'Escape') return
      if (historyOpen) {
        event.preventDefault()
        closeVersionHistory()
        return
      }
      if (viewingVersion) {
        event.preventDefault()
        returnToExamDraft()
        return
      }
      clearSelection()
      setSelectedBankId(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [clearSelection, closeVersionHistory, confirmingUseAsDraft, editing, exportDialog, historyOpen, isHistoricalBrowsing, returnToExamDraft, reviewingHistoricalQuestions, selection.selectedIds, store, viewingVersion])

  const restoreUseAsDraftFocus = () => {
    requestAnimationFrame(() => useAsDraftButton.current?.focus())
  }

  const closeExportDialog = () => {
    const source = exportDialog?.source
    const trigger = exportTrigger.current
    exportTrigger.current = null
    setExportDialog(null)
    if (source === 'live-draft' && viewingVersion) {
      restoreUseAsDraftFocus()
      return
    }
    requestAnimationFrame(() => {
      const active = document.activeElement
      if (active && active !== document.body && active !== document.documentElement) return
      if (trigger?.isConnected) trigger.focus()
      else exportButton.current?.focus()
    })
  }

  const prepareForPublication = (
    configuration: ExportConfiguration,
    source: 'live-draft' | 'historical-version',
    onProgress?: (progress: PreparationProgress) => void,
  ) =>
    source === 'historical-version' && viewingVersion
      ? prepareHistoricalExport({
        history: publicationHistory,
        version: viewingVersion,
        configuration,
      })
      : prepareExport({
        exam,
        version,
        configuration,
        history: publicationHistory,
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
  const runExport = async (
    configuration: ExportConfiguration,
    source: 'live-draft' | 'historical-version',
    onProgress: (progress: PreparationProgress) => void,
  ) => {
    const prepared = prepareForPublication(configuration, source, onProgress)
    let blob: Blob
    try {
      if (configuration.format === 'pdf') {
        const pdf = await import('./pdf-export')
        blob = pdf.pdfBlob(await pdf.createPublicationPdf(prepared.documents))
      } else {
        const docx = await import('./docx-export')
        blob = await docx.createPublicationDocx(prepared.documents)
      }
    } catch (error) {
      console.error(`Could not create the ${configuration.format.toUpperCase()} file`, error)
      const media = await import('./export-media')
      const pdf = configuration.format === 'pdf' ? await import('./pdf-export') : null
      if (
        media.isRequiredMediaError(error)
        || pdf?.isPdfUnsupportedCharacterError(error)
        || pdf?.isPdfLayoutError(error)
      ) throw error
      throw new Error(
        configuration.format === 'pdf'
          ? 'The PDF file could not be created in this browser. Choose DOCX or try again.'
          : 'The Word file could not be created. Please try again.',
      )
    }

    let durability: 'granted' | 'denied' | null = null
    if (
      prepared.resolution.kind === 'new'
      && store.publicationHistory().versions.length === 0
    ) {
      try {
        durability = await navigator.storage?.persist?.() ? 'granted' : 'denied'
      } catch {
        durability = 'denied'
      }
    }

    try {
      // A historical export has no current authoring state to save and no
      // immutable records to append. Its artifact comes entirely from stored
      // plans and Media Assets, so leave the live draft untouched.
      if (source === 'live-draft') await store.publish(prepared.publication)
    } catch (error) {
      console.error('Could not commit the Version', error)
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        throw new Error(
          'Browser storage is full. Free space in this browser, then try exporting again.',
        )
      }
      throw new Error(
        'The Version could not be saved to browser storage, so no download was started. Try again.',
      )
    }

    if (durability) {
      setStorageNotice(
        durability === 'granted'
          ? 'Version History is stored locally in this browser with persistent storage enabled. Keep an external archival copy of important files.'
          : 'Persistent storage was not granted. Version History remains browser-local and may be cleared by the browser; keep an external archival copy.',
      )
    }
    // Trigger the browser handoff in this completed command rather than a
    // follow-up React effect. The dialog may now close, but no render timing or
    // later state update can leave an already durable artifact undispatched.
    try {
      if (configuration.format === 'pdf') {
        const { savePdfFile } = await import('./pdf-export')
        savePdfFile(blob, prepared.filename)
      } else {
        const { saveDocxFile } = await import('./docx-export')
        saveDocxFile(blob, prepared.filename)
      }
    } catch (error) {
      console.error(`Could not start the ${configuration.format.toUpperCase()} download`, error)
      throw new Error('The download could not be started. The Version remains in History.')
    }
  }

  let exportPreview: PreparedExport | null = null
  let previewError: string | null = null
  if (exportDialog) {
    try {
      const hasNoSelectedContent =
        !exportDialog.configuration.selection.test
        && !exportDialog.configuration.selection.answerKey
      // An invalid empty selection still has a well-defined Version identity.
      // Prepare both canonical streams just for that identity, then deliberately
      // show no paper until the teacher chooses content. This keeps the
      // re-export/new-Version state visible beside its validation message.
      const previewConfiguration = hasNoSelectedContent
        ? DEFAULT_EXPORT_CONFIGURATION
        : exportDialog.configuration
      const prepared = prepareForPublication(previewConfiguration, exportDialog.source)
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
      <header className="document-bar">
        {/* The mark sits at the far left of the bar with the exam's name beside
            it, the way a document editor puts its logo next to the file name. */}
        <div className="document-identity">
          <img className="app-logo" src="/logo.png" alt="Test Parrot" width={36} height={36} />
          <input
            aria-label="Exam name"
            className="document-title"
            value={state.examDraft.title}
            disabled={isHistoricalBrowsing}
            onChange={(event) => store.setTitle(event.target.value)}
          />
        </div>
        <div className="header-actions">
          <button type="button" className="site-link editor-home-link" onClick={onHome}>Home</button>
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
          <span
            className="working-copy-status"
            aria-label="Working Copy status"
            aria-live="polite"
          >
            {backupStatus === 'pending'
              ? 'Backing up…'
              : backupStatus === 'failed'
                ? 'Backup failed'
                : state.dirty
                  ? 'Unsaved changes · backed up locally'
                  : 'Saved'}
          </span>
          <button
            type="button"
            className="secondary-button"
            aria-label="Discard changes"
            disabled={!state.dirty}
            onClick={() => void store.discard()}
          >
            Discard
          </button>
          <button
            type="button"
            className="primary-button"
            aria-label="Save"
            disabled={!state.dirty || backupStatus !== 'ready'}
            onClick={() => void store.save()}
          >
            Save
          </button>
          <button
            type="button"
            className="secondary-button"
            aria-label="Save As"
            title="Save As (Ctrl/Cmd+Shift+S)"
            disabled={isHistoricalBrowsing}
            onClick={() => void onSaveAs()}
          >
            Save As
          </button>
          <button
            ref={historyButton}
            type="button"
            className="secondary-button"
            aria-expanded={historyOpen}
            aria-controls="version-history"
            onPointerDown={() => {
              // Reopening History while inspecting a Version must retain the
              // original draft target for Return to Exam Draft.
              if (viewingVersion !== null) return
              const active = document.activeElement
              priorDraftFocus.current = active instanceof HTMLElement ? active : null
            }}
            onClick={() => setHistoryOpen((open) => !open)}
          >
            Version History
          </button>
          <button
            ref={exportButton}
            type="button"
            className="export-button"
            aria-haspopup="dialog"
            aria-expanded={exportDialog !== null}
            onClick={() => openExport()}
          >
            {viewingVersion ? 'Historical Export' : 'Export'}
          </button>
        </div>
      </header>

      {exportDialog && (
        <ExportDialog
          configuration={exportDialog.configuration}
          onConfigurationChange={(configuration) =>
            setExportDialog((current) => (current ? { ...current, configuration } : current))
          }
          resolution={exportPreview?.resolution ?? null}
          previewPlans={exportPreview?.documents ?? []}
          // A stored Version is independently exportable even if the live
          // Exam Draft was emptied after it was published.
          empty={exportDialog.source === 'live-draft' && exam.questions.length === 0}
          initialError={
            exportDialog.error
            ?? (exportDialog.source === 'live-draft' && exam.questions.length === 0 ? null : previewError)
          }
          onSubmit={async (configuration, onProgress) => {
            await runExport(configuration, exportDialog.source, onProgress)
            closeExportDialog()
          }}
          onCancel={closeExportDialog}
        />
      )}

      <VersionHistoryDrawer
        versions={publicationHistory.versions}
        selectedVersionId={viewingVersion?.id ?? null}
        open={historyOpen}
        onOpenChange={(open) => {
          if (open) setHistoryOpen(true)
          else closeVersionHistory()
        }}
        onSelect={(selectedVersion) => {
          setViewingVersionId(selectedVersion.id)
          setHistoricalFocusKey((key) => key + 1)
          setHistoryOpen(false)
        }}
      />

      {/* The split authoring workspace: the Question Bank beside the rendered
          Exam Draft. The bank opens as the narrower pane — it is picked from
          rather than read — and the divider moves. */}
      <WorkspaceSplit
        initialBankPercent={bankPercent}
        onBankPercentChange={(percent) => {
          setBankPercent(percent)
          void bankWorkspaces.updatePane({ mode: 'exam', resourceId: examId }, percent)
        }}
        bank={
          <div
            className="question-bank-authoring"
            inert={isHistoricalBrowsing || undefined}
            aria-hidden={isHistoricalBrowsing || undefined}
          >
          <QuestionBankTabsPane
            context={{ mode: 'exam', resourceId: examId }}
            service={bankWorkspaces}
            fallback={<QuestionBankPane
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
                if (selection.isSelected(questionId)) selection.toggle(questionId)
              }}
            />}
          />
          </div>
        }
        examDraft={
          <>
            <div
              className="draft-document"
              hidden={viewingVersion !== null}
              // The drawer is itself historical browsing, so the exposed part
              // of the draft cannot receive pointer authoring gestures either.
              inert={isHistoricalBrowsing || undefined}
              aria-hidden={isHistoricalBrowsing || undefined}
            >
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
            </div>
            {viewingVersion && (
              <HistoricalDocument
                version={viewingVersion}
                plans={prepareHistoricalExport({
                  history: publicationHistory,
                  version: viewingVersion,
                  configuration: DEFAULT_EXPORT_CONFIGURATION,
                }).documents}
                focusKey={historicalFocusKey}
                canUseAsDraft={historicalDraft !== null || historicalReview !== null}
                useAsDraftButton={useAsDraftButton}
                onUseAsDraft={() => {
                  if (!viewingVersion || !historicalReview) return
                  if (draftDiffersFromLastVersion) {
                    setConfirmingUseAsDraft(true)
                  } else if (historicalReview.rows.length > 0) {
                    setReviewingHistoricalQuestions(true)
                  } else {
                    store.useHistoricalVersionAsDraft(viewingVersion.id)
                  }
                }}
                onBack={returnToExamDraft}
              />
            )}
            <Footer />
          </>
        }
      />

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

      {confirmingUseAsDraft && viewingVersion && (
        <UseAsDraftConfirmation
          onCancel={() => {
            setConfirmingUseAsDraft(false)
            restoreUseAsDraftFocus()
          }}
          onExportCurrent={() => {
            setConfirmingUseAsDraft(false)
            openExport('live-draft')
          }}
          onReplace={() => {
            setConfirmingUseAsDraft(false)
            if (historicalReview?.rows.length) {
              setReviewingHistoricalQuestions(true)
            } else {
              store.useHistoricalVersionAsDraft(viewingVersion.id)
              restoreUseAsDraftFocus()
            }
          }}
        />
      )}

      {reviewingHistoricalQuestions && viewingVersion && historicalReview && (
        <ReviewHistoricalQuestions
          rows={historicalReview.rows}
          onCancel={() => {
            setReviewingHistoricalQuestions(false)
            restoreUseAsDraftFocus()
          }}
          onConfirm={(resolutions) => {
            store.reconcileHistoricalVersionAsDraft(viewingVersion.id, resolutions)
            setReviewingHistoricalQuestions(false)
            restoreUseAsDraftFocus()
          }}
        />
      )}

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
export default function App({
  store,
  bankStore,
  workspaces,
  bankWorkspaces,
  initialExams,
  initialBanks,
  initialEditorId,
  initialEditorMode,
  initialError,
}: {
  store: ExamStore | null
  bankStore: QuestionBankResourceStore | null
  workspaces: ExamWorkspaceService
  bankWorkspaces: QuestionBankWorkspaceService
  initialExams: readonly RecentExam[]
  initialBanks: readonly QuestionBankSummary[]
  initialEditorId: string | null
  initialEditorMode: 'bank' | 'exam' | null
  initialError: string | null
}) {
  const route = useRoute()
  const [exams, setExams] = useState(initialExams)
  const [banks, setBanks] = useState(initialBanks)
  const [editorStore, setEditorStore] = useState(store)
  const [editorBankStore] = useState(bankStore)
  const [editorId, setEditorId] = useState(initialEditorId)
  const homeError = initialError
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
      examDraft: target.examDraft,
      ...(target.lastExportedVersionId ? { lastExportedVersionId: target.lastExportedVersionId } : {}),
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
      if (current) {
        setExams(recent)
        setBanks(recentBanks)
      }
    })()
    return () => { current = false }
  }, [route, workspaces, bankWorkspaces])
  if (route === '/about') return <AboutPage />
  if (route === '/privacy') return <PrivacyPage />
  if (route === '/') return <HomePage
    exams={exams}
    banks={banks}
    error={homeError}
    onNewExam={() => { void workspaces.create().then((exam) => window.location.assign(`/editor?exam=${exam.id}`)) }}
    onOpen={(id) => window.location.assign(`/editor?exam=${id}`)}
    onNewBank={() => { void bankWorkspaces.create().then((bank) => window.location.assign(`/editor?bank=${bank.id}`)) }}
    onOpenBank={(id) => window.location.assign(`/editor?bank=${id}`)}
  />
  if (initialEditorMode === 'bank') return <QuestionBankEditor
    initialResource={editorBankStore?.getState()}
    bankWorkspaces={bankWorkspaces}
    exams={exams}
    launchError={initialError}
    onNewExam={() => {
      void workspaces.create().then(async (exam) => {
        await bankWorkspaces.carryWorkspace(
          { mode: 'bank', resourceId: editorBankStore?.getState().id ?? '' },
          { mode: 'exam', resourceId: exam.id },
        )
        window.location.assign(`/editor?exam=${exam.id}`)
      })
    }}
    onOpenExam={(id) => {
      void bankWorkspaces.carryWorkspace(
        { mode: 'bank', resourceId: editorBankStore?.getState().id ?? '' },
        { mode: 'exam', resourceId: id },
      ).then(() => window.location.assign(`/editor?exam=${id}`))
    }}
    onHome={() => {
    void bankWorkspaces.activeId().then(async (id) => {
      if (id) await bankWorkspaces.removePristine(id)
      window.location.assign('/')
    })
  }} />
  return editorStore && editorId ? <ExamEditor store={editorStore} examId={editorId} bankWorkspaces={bankWorkspaces} launchError={initialError} onSaveAs={saveAs} onHome={() => {
    void workspaces.activeId().then(async (id) => {
      if (id) await workspaces.removePristine(id)
      window.location.assign('/')
    })
  }} /> : null
}
