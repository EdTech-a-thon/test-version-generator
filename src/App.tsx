import { useRef, useState, useSyncExternalStore } from 'react'
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
  newMultipleChoiceNode,
  uniqueChoiceIds,
} from './multiple-choice'
import { subscriptSchema, superscriptSchema } from './script-marks'
import { cleanDocument, emptyDoc } from './question-doc'
import type { ProseMirrorJSON } from './question-doc'
import { orderedQuestions } from './exam'
import type { Question, QuestionType } from './exam'
import type { ExamStore } from './exam-store'

function questionDoc(type: QuestionType): ProseMirrorJSON {
  return type === 'multiple-choice'
    ? { type: 'doc', content: [{ type: 'paragraph' }, newMultipleChoiceNode()] }
    : structuredClone(emptyDoc)
}

function CrepeQuestion({
  value,
  readonly = false,
  onChange,
}: {
  value: ProseMirrorJSON
  readonly?: boolean
  onChange?: (doc: ProseMirrorJSON) => void
}) {
  useEditor((root) => {
    const safeValue = cleanDocument(value)
    const crepe = new Crepe({
      root,
      defaultValue: '',
      features: {
        [Crepe.Feature.CodeMirror]: true,
        [Crepe.Feature.Latex]: true,
        [Crepe.Feature.BlockEdit]: !readonly,
        [Crepe.Feature.Toolbar]: !readonly,
      },
      featureConfigs: {
        [Crepe.Feature.BlockEdit]: { advancedGroup: { codeBlock: null } },
        [Crepe.Feature.Placeholder]: { text: 'Write the question…' },
      },
    }).setReadonly(readonly)
    crepe.editor
      .use(multipleChoiceMode(!readonly))
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
        // Start the editable dialog with the cursor on the first line (the
        // question) so typing goes there straight away. Previews are read-only
        // and must not grab focus.
        if (!readonly) {
          tr.setSelection(TextSelection.atStart(tr.doc))
        }
        view.dispatch(tr)
        if (!readonly) view.focus()
      })
      if (onChange) {
        listener.updated((_ctx, doc) =>
          onChange(cleanDocument(doc.toJSON() as ProseMirrorJSON)),
        )
      }
    })
    return crepe
  }, [])
  return <Milkdown />
}

function QuestionDialog({
  question,
  onCancel,
  onSave,
}: {
  question?: Question
  onCancel: () => void
  onSave: (question: Question) => void
}) {
  const [type, setType] = useState<QuestionType>(
    question?.type ?? 'multiple-choice',
  )
  const [doc, setDoc] = useState<ProseMirrorJSON>(
    question?.doc ?? questionDoc('multiple-choice'),
  )
  const latestDoc = useRef(doc)

  const changeType = (next: QuestionType) => {
    setType(next)
    const safeCurrent = cleanDocument(latestDoc.current)
    const content = (safeCurrent.content as ProseMirrorJSON[] | undefined) ?? []
    const withoutGrid = content.filter((node) => node.type !== 'multipleChoice')
    const nextDoc = {
      type: 'doc',
      content: next === 'multiple-choice' ? [...withoutGrid, newMultipleChoiceNode()] : withoutGrid,
    }
    latestDoc.current = nextDoc
    setDoc(nextDoc)
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
    >
      <section
        className="question-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Question editor"
      >
        <header className="dialog-header">
          <h2>{question ? 'Edit question' : 'Add question'}</h2>
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
            onClick={() =>
              onSave({
                ...question,
                id: question?.id ?? crypto.randomUUID(),
                type,
                doc: cleanDocument(latestDoc.current),
                columns: question?.columns ?? 'auto',
              })
            }
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
  const version = store.currentVersion()
  const questions = orderedQuestions(draft.exam, version)
  const [editing, setEditing] = useState<Question | 'new' | null>(null)

  return (
    <>
      <header className="document-bar">
        <input
          aria-label="Exam name"
          className="document-title"
          value={draft.exam.title}
          onChange={(event) => store.setTitle(event.target.value)}
        />
        <div className="header-actions">
          <button type="button" className="secondary-button" onClick={() => setEditing('new')}>+ Add question</button>
          <button type="button" className="print-button" onClick={() => window.print()}>Print</button>
        </div>
      </header>

      <main className="exam-workspace">
        <article className="exam-page">
          <h1>{draft.exam.title}</h1>
          {questions.length === 0 && (
            <button className="empty-exam" type="button" onClick={() => setEditing('new')}>
              Add your first question
            </button>
          )}
          {questions.map((question, index) => (
            <section className="exam-question" key={question.id}>
              <aside className="question-actions">
                <strong>Question {index + 1}</strong>
                <button type="button" onClick={() => setEditing(question)}>Edit</button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Delete question ${index + 1}?`)) {
                      store.removeQuestion(question.id)
                    }
                  }}
                >Delete</button>
              </aside>
              <div className="question-number">{index + 1}.</div>
              <div className="question-preview">
                <CrepeQuestion value={question.doc} readonly />
              </div>
            </section>
          ))}
        </article>
      </main>

      {editing && (
        <QuestionDialog
          question={editing === 'new' ? undefined : editing}
          onCancel={() => setEditing(null)}
          onSave={(saved) => {
            if (editing === 'new') store.addQuestion(saved)
            else store.updateQuestion(saved)
            setEditing(null)
          }}
        />
      )}
    </>
  )
}
