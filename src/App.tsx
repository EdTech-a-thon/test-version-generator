import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
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
import { cleanDocument } from './question-doc'
import type { ProseMirrorJSON } from './question-doc'
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  createQuestion,
  topicsOf,
  withTopicAdded,
  withTypeSwitched,
} from './exam'
import type { Difficulty, Question, QuestionType } from './exam'
import { bankQuestionById } from './question-bank'
import type { ExamStore } from './exam-store'
import { ExamPage, PrintDocument } from './exam-page'
import { QuestionBankPane } from './question-bank-pane'
import { NO_FILTER, type QuestionBankFilter } from './question-bank-view'
import { useSelection } from './use-selection'
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
import { saveImage } from './local-images'
import { configurePastedImages } from './pasted-images'
import { Plus, Redo2, Undo2, X } from 'lucide-react'

/**
 * The Topics of one question, as removable chips.
 *
 * Enter or a comma commits what has been typed, trimmed. Nothing else happens
 * to it: no autocomplete offers a Topic, no controlled vocabulary rejects one,
 * and two spellings of one subject stay two Topics, because only the teacher
 * knows whether they mean the same thing.
 */
function TopicChips({
  topics,
  draft,
  onDraftChange,
  onChange,
}: {
  topics: readonly string[]
  draft: string
  onDraftChange: (draft: string) => void
  onChange: (topics: string[]) => void
}) {
  const commit = () => {
    onChange(withTopicAdded(topics, draft))
    onDraftChange('')
  }
  return (
    <div className="topic-field">
      <span className="topic-field-label">Topics</span>
      {topics.length > 0 && (
        <ul className="topic-chips">
          {topics.map((topic) => (
            <li className="topic-chip" key={topic}>
              {topic}
              <button
                type="button"
                aria-label={`Clear Topic ${topic}`}
                onClick={() => onChange(topics.filter((item) => item !== topic))}
              >
                <X />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        className="topic-input"
        aria-label="Add a Topic"
        placeholder="Add a Topic, then press Enter"
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ',') return
          // Both keys mean the same thing, and neither is left to do what it
          // would otherwise do — type a comma, or reach the dialog behind.
          event.preventDefault()
          event.stopPropagation()
          commit()
        }}
      />
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
  onCancel,
  onSave,
}: {
  question: Question
  isNew: boolean
  onCancel: () => void
  onSave: (question: Question) => void
}) {
  const [type, setType] = useState<QuestionType>(question.type)
  const [doc, setDoc] = useState<ProseMirrorJSON>(question.doc)
  const [difficulty, setDifficulty] = useState<Difficulty | ''>(question.difficulty ?? '')
  const [topics, setTopics] = useState<readonly string[]>(topicsOf(question))
  // What is in the Topic box but not yet a chip. Saving commits it, so a Topic
  // typed and then saved is never quietly dropped.
  const [topicDraft, setTopicDraft] = useState('')
  const latestDoc = useRef(doc)
  const readEditorDocument = useRef<(() => ProseMirrorJSON) | null>(null)
  // The stash the dialog currently knows about, kept alongside the doc so a
  // save mid-edit carries a lift/restore that happened before the editor's
  // own onChange has fired again. Starts from the question's persisted stash,
  // so an existing stash survives opening the dialog without touching type.
  const stash = useRef(question.stashedChoices)

  const changeType = (next: QuestionType) => {
    const switched = withTypeSwitched(
      {
        ...question,
        type,
        doc: cleanDocument(latestDoc.current),
        stashedChoices: stash.current,
      },
      next,
    )
    stash.current = switched.stashedChoices
    latestDoc.current = switched.doc
    setType(switched.type)
    setDoc(switched.doc)
  }

  const saveQuestion = () => {
    const saved: Question = {
      ...question,
      type,
      doc: cleanDocument(readEditorDocument.current?.() ?? latestDoc.current),
    }
    if (stash.current) saved.stashedChoices = stash.current
    else delete saved.stashedChoices
    if (difficulty) saved.difficulty = difficulty
    else delete saved.difficulty
    const savedTopics = withTopicAdded(topics, topicDraft)
    if (savedTopics.length > 0) saved.topics = savedTopics
    else delete saved.topics
    onSave(saved)
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
          saveQuestion()
        }
      }}
    >
      <section
        className="question-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Question editor"
      >
        <header className="dialog-header">
          <h2>{isNew ? 'Add question' : 'Edit question'}</h2>
          {/* Type and Difficulty, side by side: one is structural and one is
              optional, but both are the question's classification rather than
              its content. */}
          <div className="dialog-header-fields">
            <label>
              Type
              <select
                value={type}
                onChange={(event) => changeType(event.target.value as QuestionType)}
              >
                <option value="open">Short answer</option>
                <option value="multiple-choice">Multiple choice</option>
              </select>
            </label>
            <label>
              Difficulty
              <select
                value={difficulty}
                onChange={(event) => setDifficulty(event.target.value as Difficulty | '')}
              >
                <option value="">Unspecified</option>
                {DIFFICULTIES.map((value) => (
                  <option key={value} value={value}>{DIFFICULTY_LABELS[value]}</option>
                ))}
              </select>
            </label>
          </div>
        </header>
        <div className="dialog-editor" key={type}>
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
        <TopicChips
          topics={topics}
          draft={topicDraft}
          onDraftChange={setTopicDraft}
          onChange={setTopics}
        />
        <footer className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="primary-button"
            onClick={saveQuestion}
          >
            Save question
          </button>
        </footer>
      </section>
    </div>
  )
}

export default function App({ store }: { store: ExamStore }) {
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
  // What Insert and Replace act against: the question selected on the Exam
  // Draft, when exactly one is. Two selected questions name no single position,
  // so composition waits until the teacher has said which one they mean — and
  // so does a selected question that is no longer on the exam, which is what a
  // selection outlives an undo as. Only a referenced question names a position.
  const selectedId =
    selection.selectedIds.size === 1 ? [...selection.selectedIds][0]! : null
  const examDraftSelection =
    selectedId && examDraftIds.has(selectedId)
      ? bankQuestionById(state.questionBank, selectedId) ?? null
      : null

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
      if (event.key !== 'Escape') return
      clearSelection()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [clearSelection, editing, exportDialog, store])

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
            type="button"
            className="secondary-button insert-question-button"
            onClick={() =>
              setEditing({
                question: createQuestion('multiple-choice'),
                destination: 'exam-draft',
                after: null,
              })
            }
          >
            <Plus />
            Insert question
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
          Exam Draft, opening at an even split so neither side is the lesser
          one. Resizing and collapsing it are still to come. */}
      <div className="authoring-workspace">
        <QuestionBankPane
          bank={state.questionBank}
          examDraftIds={examDraftIds}
          filter={bankFilter}
          onFilterChange={setBankFilter}
          selectedQuestionId={selectedBankId}
          examDraftSelection={examDraftSelection}
          onSelect={setSelectedBankId}
          onCreate={() =>
            setEditing({
              question: createQuestion('multiple-choice'),
              destination: 'question-bank',
              after: null,
            })
          }
          onEdit={(questionId) => {
            const question = bankQuestionById(state.questionBank, questionId)
            if (question) {
              setEditing({ question, destination: 'question-bank', after: null })
            }
          }}
          onAddToExamDraft={(questionId) => store.addToExamDraft(questionId)}
          // One store call each, the same ones a pointer gesture will make:
          // the composition path is a second way to reach the authoring
          // boundary, never a second implementation of it.
          onInsertAfterExamDraftSelection={(questionId) => {
            if (!examDraftSelection) return
            store.addToExamDraft(questionId, examDraftSelection.id)
            // The incoming question becomes the one being worked with, so a
            // second insertion follows the first rather than stacking backwards
            // behind the same target. Revealing and highlighting it after
            // repagination is the drag-and-drop slice's business.
            selectOnExamDraft(questionId)
          }}
          onReplaceExamDraftSelection={(questionId) => {
            if (!examDraftSelection) return
            store.replaceInExamDraft(examDraftSelection.id, questionId)
            // Necessary here rather than merely tidy: the outgoing question is
            // off the exam now, and a selection pointing at it names no
            // position on the Exam Draft at all.
            selectOnExamDraft(questionId)
          }}
        />

        <div className="editor-output">
          <ExamPage
            exam={exam}
            version={version}
            selection={selection}
            onEdit={(questionId) => {
              const question = bankQuestionById(state.questionBank, questionId)
              if (question) {
                setEditing({ question, destination: 'exam-draft', after: null })
              }
            }}
            onDuplicate={(questionId) => store.duplicateInExamDraft(questionId)}
            onRemove={(questionIds) => {
              store.removeFromExamDraft(questionIds)
              selection.clear()
            }}
            onAdd={(section, afterQuestionId) =>
              setEditing({
                question: createQuestion(section),
                destination: 'exam-draft',
                after: afterQuestionId ?? null,
              })
            }
            onSetColumns={(questionIds, columns) =>
              store.setQuestionColumns(questionIds, columns)
            }
            onMoveQuestions={(questionIds, targetId, placement) =>
              store.moveInExamDraft(questionIds, targetId, placement)
            }
            unsavedDraft={!store.hasSavedExam()}
          />
        </div>
      </div>

      {handoff?.format === 'print' && <PrintDocument plans={handoff.plans} />}

      {editing && (
        <QuestionDialog
          question={editing.question}
          isNew={!bankQuestionById(state.questionBank, editing.question.id)}
          onCancel={() => setEditing(null)}
          onSave={(saved) => {
            // One authoring action, whichever way the popup was opened, so a
            // saved question is one undo step and cancelling is none at all.
            if (bankQuestionById(state.questionBank, saved.id)) {
              store.updateInQuestionBank(saved)
            } else if (editing.destination === 'question-bank') {
              store.createInQuestionBank(saved)
            } else {
              store.createInExamDraft(saved, editing.after)
            }
            setEditing(null)
          }}
        />
      )}
    </>
  )
}
