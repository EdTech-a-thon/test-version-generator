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
import { cleanDocument } from './question-doc'
import type { ProseMirrorJSON } from './question-doc'
import { createQuestion, duplicateQuestion, questionById } from './exam'
import type { Question, QuestionType } from './exam'
import type { ExamStore } from './exam-store'
import { ExamPage } from './exam-page'

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
            onClick={() =>
              onSave({
                ...question,
                type,
                doc: cleanDocument(latestDoc.current),
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
  // A question being written. A new one is a full question that the store has
  // not been told about yet, so saving is the same call either way.
  const [editing, setEditing] = useState<Question | null>(null)

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
          <button type="button" className="print-button" onClick={() => window.print()}>Print</button>
        </div>
      </header>

      <ExamPage
        exam={draft.exam}
        version={version}
        onEdit={(questionId) => setEditing(questionById(draft.exam, questionId) ?? null)}
        onDuplicate={(questionId) => {
          const question = questionById(draft.exam, questionId)
          if (question) store.addQuestion(duplicateQuestion(question))
        }}
        onDelete={(questionId) => {
          if (window.confirm('Delete this question?')) {
            store.removeQuestion(questionId)
          }
        }}
        onAdd={(section) => setEditing(createQuestion(section))}
      />

      {editing && (
        <QuestionDialog
          question={editing}
          isNew={!questionById(draft.exam, editing.id)}
          onCancel={() => setEditing(null)}
          onSave={(saved) => {
            store.updateQuestion(saved)
            setEditing(null)
          }}
        />
      )}
    </>
  )
}
