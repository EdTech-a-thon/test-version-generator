import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Milkdown, useEditor } from '@milkdown/react'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import { blockConfig } from '@milkdown/kit/plugin/block'
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
import { subscriptSchema, superscriptSchema } from './script-marks'
import { cleanDocument } from './question-doc'
import type { ProseMirrorJSON } from './question-doc'
import {
  createQuestion,
  duplicateQuestion,
  moveQuestions,
  questionById,
  shuffleAnswers,
  shuffleSelectedQuestions,
  withTypeSwitched,
} from './exam'
import type { Question, QuestionType } from './exam'
import type { ExamStore } from './exam-store'
import { ExamPage } from './exam-page'
import { useSelection } from './use-selection'
import {
  STUDENT_TEST,
  planExport,
  type ExportContentSelection,
} from './export-plan'
import { domMeasure } from './dom-measure'
import { ContextMenu, type MenuPoint } from './context-menu'
import { ChevronDown, Download, Plus, Printer, Redo2, Undo2 } from 'lucide-react'

function CrepeQuestion({
  value,
  onChange,
}: {
  value: ProseMirrorJSON
  onChange: (doc: ProseMirrorJSON) => void
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
        [Crepe.Feature.Placeholder]: { text: 'Write the question…' },
      },
    })
    crepe.editor
      .use(multipleChoiceMode(true))
      .use(subscriptSchema)
      .use(superscriptSchema)
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
  const latestDoc = useRef(doc)
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
      doc: cleanDocument(latestDoc.current),
    }
    if (stash.current) saved.stashedChoices = stash.current
    else delete saved.stashedChoices
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
          <label>
            Type
            <select value={type} onChange={(event) => changeType(event.target.value as QuestionType)}>
              <option value="open">Open ended</option>
              <option value="multiple-choice">Multiple choice</option>
            </select>
          </label>
        </header>
        <div className="dialog-editor" key={type}>
          <CrepeQuestion
            value={doc}
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
  const draft = useSyncExternalStore(store.subscribe, store.getState)
  // There is exactly one version and it is the one on the page. The store can
  // still hold several — the model is unchanged — but nothing here creates,
  // names, switches or deletes one: shuffling mutates this version in place,
  // and Save writes it.
  const version = store.currentVersion()
  // A question being written. A new one is a full question that the store has
  // not been told about yet, so saving is the same call either way.
  //
  // `after` is the question a plus was clicked beside. The store only ever
  // appends, so where a new question belongs is remembered here and applied as
  // a move once it exists and has an id to move.
  const [editing, setEditing] = useState<{
    question: Question
    after: string | null
  } | null>(null)
  const [printPanelOpen, setPrintPanelOpen] = useState(false)
  const [exportMenuPoint, setExportMenuPoint] = useState<MenuPoint | null>(null)
  const [exportingDocx, setExportingDocx] = useState(false)
  const exportButton = useRef<HTMLButtonElement>(null)
  const [contentSelection, setContentSelection] = useState<ExportContentSelection>({
    test: true,
    answerKey: false,
  })
  const [printRequest, setPrintRequest] = useState<ExportContentSelection | null>(null)
  // Selection lives here, alongside the store, so page interactions and
  // selection-wide context-menu actions share one source of truth.
  const selection = useSelection()
  const clearSelection = selection.clear

  useEffect(() => {
    if (editing) return
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
      if (printPanelOpen) {
        setPrintPanelOpen(false)
        exportButton.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [clearSelection, editing, printPanelOpen, store])

  const closeExportMenu = () => {
    setExportMenuPoint(null)
    exportButton.current?.focus()
  }

  const toggleExportMenu = () => {
    if (exportMenuPoint) {
      closeExportMenu()
      return
    }
    const rect = exportButton.current?.getBoundingClientRect()
    if (rect) setExportMenuPoint({ x: rect.right, y: rect.bottom + 4 })
  }

  const downloadDocx = async () => {
    setExportingDocx(true)
    void store.save().catch((error: unknown) => {
      console.error('Could not save the exam while exporting DOCX', error)
    })
    try {
      // Download orchestration plans, then hands the plan over: the adapter
      // never sees the exam, so DOCX cannot drift from what print would show.
      const plan = planExport({
        exam: draft.exam,
        version,
        selection: STUDENT_TEST,
        measure: domMeasure,
      })
      const { downloadExamDocx } = await import('./docx-export')
      await downloadExamDocx(plan)
    } catch (error) {
      console.error('Could not export the exam as DOCX', error)
      window.alert('Could not create the DOCX file. Please try again.')
    } finally {
      setExportingDocx(false)
    }
  }

  // Printing and DOCX download are commits: there is no Save button, so the
  // moment the teacher exports, what is on the page becomes the saved exam.
  // The print write is fired rather than awaited — it goes to IndexedDB and
  // has nothing to say about what the printer receives, so a slow or failed
  // write must never be what stops the paper coming out.
  //
  // The print document stays mounted until `afterprint` says the browser is
  // done with it. Unmounting in the frame that follows `window.print()` assumes
  // the dialog has already read the DOM, and a preview that re-reads it — or a
  // headless capture that never opens a dialog at all — would find nothing
  // there. Off screen the extra markup costs nothing: `.print-output` is
  // `display: none` until print media applies.
  useEffect(() => {
    if (!printRequest) return
    void store.save().catch((error: unknown) => {
      console.error('Could not save the exam while printing', error)
    })
    const done = () => setPrintRequest(null)
    window.addEventListener('afterprint', done)
    const frame = window.requestAnimationFrame(() => window.print())
    return () => {
      window.removeEventListener('afterprint', done)
      window.cancelAnimationFrame(frame)
    }
  }, [printRequest, store])

  return (
    <>
      <header className="document-bar">
        {/* The mark sits at the far left of the bar with the exam's name beside
            it, the way a document editor puts its logo next to the file name. */}
        <div className="document-identity">
          <img className="app-logo" src="/logo.png" alt="Crepe" width={36} height={36} />
          <input
            aria-label="Exam name"
            className="document-title"
            value={draft.exam.title}
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
            onClick={() => setEditing({ question: createQuestion('multiple-choice'), after: null })}
          >
            <Plus />
            Insert question
          </button>
          <button
            ref={exportButton}
            type="button"
            className="export-button"
            aria-haspopup="menu"
            aria-expanded={exportMenuPoint !== null}
            disabled={exportingDocx}
            onClick={toggleExportMenu}
          >
            {exportingDocx ? 'Exporting…' : 'Export'}
            <ChevronDown />
          </button>
        </div>
      </header>

      {exportMenuPoint && (
        <ContextMenu
          point={exportMenuPoint}
          side="left"
          ariaLabel="Export options"
          items={[
            {
              kind: 'action',
              label: 'Print…',
              icon: <Printer />,
              onSelect: () => setPrintPanelOpen(true),
            },
            {
              kind: 'action',
              label: 'Download DOCX',
              icon: <Download />,
              onSelect: () => void downloadDocx(),
            },
          ]}
          onClose={closeExportMenu}
        />
      )}

      {printPanelOpen && (
        <section className="print-panel" aria-label="Print options">
          <fieldset>
            <legend>Content</legend>
            <label>
              <input
                type="checkbox"
                checked={contentSelection.test}
                onChange={(event) => setContentSelection({
                  ...contentSelection,
                  test: event.target.checked,
                })}
              />
              Test
            </label>
            <label>
              <input
                type="checkbox"
                checked={contentSelection.answerKey}
                onChange={(event) => setContentSelection({
                  ...contentSelection,
                  answerKey: event.target.checked,
                })}
              />
              Answer key
            </label>
          </fieldset>
          <button
            type="button"
            className="primary-button"
            disabled={!contentSelection.test && !contentSelection.answerKey}
            onClick={() => setPrintRequest({ ...contentSelection })}
          >Print selected</button>
        </section>
      )}

      <div className="editor-output">
        <ExamPage
          exam={draft.exam}
          version={version}
          selection={selection}
          onEdit={(questionId) => {
            const question = questionById(draft.exam, questionId)
            if (question) setEditing({ question, after: null })
          }}
          onDuplicate={(questionId) => {
            const question = questionById(draft.exam, questionId)
            if (question) store.addQuestion(duplicateQuestion(question))
          }}
          onDelete={(questionId) => {
            if (window.confirm('Delete this question?')) {
              store.removeQuestion(questionId)
              selection.clear()
            }
          }}
          onAdd={(section, afterQuestionId) =>
            setEditing({
              question: createQuestion(section),
              after: afterQuestionId ?? null,
            })
          }
          onSetColumns={(questionIds, columns) =>
            store.setQuestionColumns(questionIds, columns)
          }
          onShuffleAnswers={(questionIds) =>
            store.updateCurrentVersion((current) =>
              shuffleAnswers(draft.exam, current, questionIds, Math.random),
            )
          }
          onShuffleSelectedQuestions={(questionIds) =>
            store.updateCurrentVersion((current) =>
              shuffleSelectedQuestions(draft.exam, current, questionIds, Math.random),
            )
          }
          onMoveQuestions={(questionIds, targetId, placement) =>
            store.updateCurrentVersion((current) =>
              moveQuestions(draft.exam, current, questionIds, targetId, placement),
            )
          }
          unsavedDraft={!store.hasSavedVersions()}
        />
      </div>

      {printRequest && (
        <div className="print-output">
          <ExamPage
            exam={draft.exam}
            version={version}
            selection={selection}
            onEdit={() => {}}
            onDuplicate={() => {}}
            onDelete={() => {}}
            onAdd={() => {}}
            onSetColumns={() => {}}
            onShuffleAnswers={() => {}}
            onShuffleSelectedQuestions={() => {}}
            onMoveQuestions={() => {}}
            contentSelection={printRequest}
          />
        </div>
      )}

      {editing && (
        <QuestionDialog
          question={editing.question}
          isNew={!questionById(draft.exam, editing.question.id)}
          onCancel={() => setEditing(null)}
          onSave={(saved) => {
            store.updateQuestion(saved)
            // Read the exam back rather than closing over `draft`: the move
            // needs the version that already contains the question it is
            // moving, and the store has just produced it.
            if (editing.after) {
              const after = editing.after
              store.updateCurrentVersion((version) =>
                moveQuestions(store.getState().exam, version, [saved.id], after, 'after'),
              )
            }
            setEditing(null)
          }}
        />
      )}
    </>
  )
}
