import { useEffect, useRef, useState } from 'react'
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

type QuestionType = 'open' | 'multiple-choice'
type Question = { id: string; type: QuestionType; doc: Record<string, unknown> }

const questionsKey = 'exam-questions-v1'
const titleKey = 'crepe-editor-title'
const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

function cleanDocument(value: Record<string, unknown>) {
  const cleanNode = (node: Record<string, unknown>): Record<string, unknown> => {
    const clean: Record<string, unknown> = { type: String(node.type ?? 'paragraph') }
    if (typeof node.text === 'string') clean.text = node.text
    if (Array.isArray(node.marks)) {
      clean.marks = node.marks.map((mark) => ({ type: String((mark as { type?: unknown }).type ?? '') }))
    }
    if (Array.isArray(node.content)) {
      clean.content = node.content.map((child) => cleanNode(child as Record<string, unknown>))
    }
    if (node.type === 'multipleChoice') {
      const attrs = (node.attrs ?? {}) as Record<string, unknown>
      // Old model stored the correct answer as an id on the parent; the new
      // model stores a boolean on each choice.
      const legacyCorrectId = typeof attrs.correct === 'string' ? attrs.correct : ''
      const originalChoices = Array.isArray(node.content)
        ? (node.content as Array<Record<string, unknown>>)
        : []
      let choices = Array.isArray(clean.content)
        ? (clean.content as Array<Record<string, unknown>>)
        : []

      if (choices.length < 2 && Array.isArray(attrs.choices)) {
        // Very old model kept the answers as HTML in a `choices` attr.
        choices = (attrs.choices as unknown[]).map((choice, index) => {
          const item = choice as Record<string, unknown>
          const holder = document.createElement('div')
          holder.innerHTML = String(item.html ?? `Answer ${index + 1}`)
          return {
            type: 'multipleChoiceChoice',
            attrs: {
              correct: item.id != null && item.id === legacyCorrectId,
              id: typeof item.id === 'string' ? item.id : '',
            },
            content: [
              {
                type: 'paragraph',
                content: holder.textContent
                  ? [{ type: 'text', text: holder.textContent }]
                  : undefined,
              },
            ],
          }
        })
      } else {
        choices.forEach((choiceClean, index) => {
          const orig = (originalChoices[index]?.attrs ?? {}) as Record<string, unknown>
          const byLegacyId = legacyCorrectId !== '' &&
            typeof orig.id === 'string' && orig.id === legacyCorrectId
          // Keep the id set by the choice branch below; only settle `correct`.
          choiceClean.attrs = {
            ...(choiceClean.attrs as Record<string, unknown> | undefined),
            correct: orig.correct === true || byLegacyId,
          }
        })
      }

      while (choices.length < 2) {
        choices.push({
          type: 'multipleChoiceChoice',
          attrs: { correct: false, id: '' },
          content: [{ type: 'paragraph' }],
        })
      }
      clean.content = choices
    } else if (node.type === 'multipleChoiceChoice') {
      const attrs = (node.attrs ?? {}) as Record<string, unknown>
      clean.attrs = {
        correct: attrs.correct === true,
        id: typeof attrs.id === 'string' ? attrs.id : '',
      }
    }
    return clean
  }
  return cleanNode(value)
}

function questionDoc(type: QuestionType) {
  return type === 'multiple-choice'
    ? { type: 'doc', content: [{ type: 'paragraph' }, newMultipleChoiceNode()] }
    : emptyDoc
}

function CrepeQuestion({
  value,
  readonly = false,
  onChange,
}: {
  value: Record<string, unknown>
  readonly?: boolean
  onChange?: (doc: Record<string, unknown>) => void
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
          onChange(cleanDocument(doc.toJSON() as Record<string, unknown>)),
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
  const [doc, setDoc] = useState<Record<string, unknown>>(
    question?.doc ?? questionDoc('multiple-choice'),
  )
  const latestDoc = useRef(doc)

  const changeType = (next: QuestionType) => {
    setType(next)
    const safeCurrent = cleanDocument(latestDoc.current)
    const content = (safeCurrent.content as Array<Record<string, unknown>> | undefined) ?? []
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
                id: question?.id ?? crypto.randomUUID(),
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

export default function App() {
  const [title, setTitle] = useState(() => localStorage.getItem(titleKey) ?? 'Untitled exam')
  const [questions, setQuestions] = useState<Question[]>(() => {
    try { return JSON.parse(localStorage.getItem(questionsKey) ?? '[]') }
    catch { return [] }
  })
  const [editing, setEditing] = useState<Question | 'new' | null>(null)

  useEffect(() => localStorage.setItem(questionsKey, JSON.stringify(questions)), [questions])

  return (
    <>
      <header className="document-bar">
        <input
          aria-label="Exam name"
          className="document-title"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
            localStorage.setItem(titleKey, event.target.value)
          }}
        />
        <div className="header-actions">
          <button type="button" className="secondary-button" onClick={() => setEditing('new')}>+ Add question</button>
          <button type="button" className="print-button" onClick={() => window.print()}>Print</button>
        </div>
      </header>

      <main className="exam-workspace">
        <article className="exam-page">
          <h1>{title}</h1>
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
                      setQuestions((items) => items.filter((item) => item.id !== question.id))
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
            setQuestions((items) => {
              const exists = items.some((item) => item.id === saved.id)
              return exists ? items.map((item) => item.id === saved.id ? saved : item) : [...items, saved]
            })
            setEditing(null)
          }}
        />
      )}
    </>
  )
}
