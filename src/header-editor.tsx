// Editing an Exam's page header where it prints.
//
// A double-click on a test page's header opens it for editing, the way a word
// processor does: the header becomes a rich-text editor in its own place on the
// page, and a small bar above it says so and holds what only a header has — the
// paper's ID, a first page of its own, table borders, and removing the header
// altogether. The editor is the question editor, Crepe, cut down to what a
// header holds: text, tables and images.
//
// It reports a change only when the teacher has made one: opening a header to
// look at it, or starting from the default and leaving it as it was, does not
// give the Exam a header of its own.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { Crepe } from '@milkdown/crepe'
import type { Ctx } from '@milkdown/kit/ctx'
import { editorViewCtx } from '@milkdown/kit/core'
import { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, TextSelection } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'
import type { EditorView } from '@milkdown/kit/prose/view'
import { Fingerprint, Grid2x2, Trash2 } from 'lucide-react'
import { examIdSchema, examIdView, tableBordersSchema } from './header-nodes'
import { saveImage } from './local-images'
import { MAX_HEADER_HEIGHT } from './export-plan'
import { EXAM_ID_NODE, TABLE_BORDERS_ATTR } from './page-header'
import { cleanDocument, type ProseMirrorJSON } from './question-doc'

type HeaderEditorProps = {
  /** Which header this is, as the bar names it. */
  label: string
  value: ProseMirrorJSON[]
  onChange: (content: ProseMirrorJSON[]) => void
  differentFirstPage: boolean
  onDifferentFirstPageChange: (different: boolean) => void
  onRemove: () => void
  onDone: () => void
}

const serialize = (content: readonly ProseMirrorJSON[]) => JSON.stringify(content)

/** The table the selection is in, and where it starts, if any. */
function tableAtSelection(view: EditorView): { pos: number; node: ProseNode } | null {
  const { $from } = view.state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name === 'table') return { pos: $from.before(depth), node }
  }
  return null
}

function HeaderCrepe({
  value,
  onChange,
  onView,
  onSelectionChange,
  touched,
}: {
  value: ProseMirrorJSON[]
  onChange: { current: (content: ProseMirrorJSON[]) => void }
  onView: (view: EditorView) => void
  onSelectionChange: () => void
  /** Whether the teacher has done anything to the header yet. */
  touched: { current: boolean }
}) {
  useEditor((root) => {
    const loaded = cleanDocument({ type: 'doc', content: value.length > 0 ? value : [{ type: 'paragraph' }] })
    // What the header held before the teacher touched it. Crepe tidies a
    // document it has just loaded — its table plugin, for one — and until the
    // teacher types, pastes or uses the bar, that tidying is the baseline, not
    // a change: opening a header to look at it gives the Exam nothing new.
    let baseline: string | null = null
    // Reported as each transaction lands, not on Milkdown's debounced
    // listener: a teacher who types and presses Done at once must not lose
    // the last of what they typed when the editor closes.
    const report = $prose(() => new Plugin({
      view: () => ({
        update: (view, previous) => {
          if (baseline === null || view.state.doc.eq(previous.doc)) return
          const content = contentOf(view.state.doc)
          const next = serialize(content)
          if (next === baseline) return
          baseline = next
          if (touched.current) onChange.current(content)
        },
      }),
      props: {
        handleDOMEvents: {
          beforeinput: () => { touched.current = true; return false },
          keydown: (_view, event) => {
            if (event.key !== 'Escape') touched.current = true
            return false
          },
          paste: () => { touched.current = true; return false },
          drop: () => { touched.current = true; return false },
        },
      },
    }))
    const crepe = new Crepe({
      root,
      defaultValue: '',
      features: {
        [Crepe.Feature.CodeMirror]: false,
        [Crepe.Feature.Latex]: false,
      },
      featureConfigs: {
        [Crepe.Feature.BlockEdit]: {
          textGroup: { h4: null, h5: null, h6: null, quote: null, divider: null },
          listGroup: null,
          advancedGroup: { codeBlock: null, math: null },
        },
        [Crepe.Feature.Cursor]: { virtual: false },
        [Crepe.Feature.ImageBlock]: { onUpload: saveImage },
        [Crepe.Feature.Placeholder]: { text: 'Type the header…', mode: 'doc' },
      },
    })
    crepe.editor.use(examIdSchema).use(examIdView).use(tableBordersSchema).use(report)
    crepe.on((listener) => {
      listener.mounted((ctx: Ctx) => {
        const view = ctx.get(editorViewCtx)
        const document = ProseNode.fromJSON(view.state.schema, loaded)
        const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, document.content)
        tr.setSelection(TextSelection.atEnd(tr.doc))
        view.dispatch(tr)
        baseline = serialize(contentOf(view.state.doc))
        onView(view)
        view.focus()
      })
      listener.selectionUpdated(() => onSelectionChange())
    })
    return crepe
  }, [])
  return <Milkdown />
}

/** The header's blocks, as the Exam stores them. */
function contentOf(doc: ProseNode): ProseMirrorJSON[] {
  const clean = cleanDocument(doc.toJSON() as ProseMirrorJSON)
  const blocks = (clean.content ?? []) as ProseMirrorJSON[]
  // A header left as one empty line says nothing, and is stored as nothing.
  return blocks.length === 1 && blocks[0]!.type === 'paragraph' && !blocks[0]!.content
    ? []
    : blocks
}

export function HeaderEditor({
  label,
  value,
  onChange,
  differentFirstPage,
  onDifferentFirstPageChange,
  onRemove,
  onDone,
}: HeaderEditorProps) {
  const root = useRef<HTMLDivElement | null>(null)
  const view = useRef<EditorView | null>(null)
  const touched = useRef(false)
  const latestChange = useRef(onChange)
  useEffect(() => {
    latestChange.current = onChange
  })
  const [table, setTable] = useState<{ borders: boolean } | null>(null)
  const [tooTall, setTooTall] = useState(false)

  const readTable = useCallback(() => {
    const current = view.current ? tableAtSelection(view.current) : null
    setTable(current ? { borders: current.node.attrs[TABLE_BORDERS_ATTR] === true } : null)
  }, [])

  // The editor grows with what is typed; past the cap, the page clips the
  // header, so the bar says so rather than letting it happen unseen.
  useEffect(() => {
    const element = root.current?.querySelector('.ProseMirror')
    if (!element) return
    const observer = new ResizeObserver(() => {
      setTooTall((element as HTMLElement).offsetHeight > MAX_HEADER_HEIGHT)
    })
    observer.observe(element)
    return () => observer.disconnect()
  })

  // Escape, or a press anywhere outside the header and its bar, finishes.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDone()
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target || root.current?.contains(target)) return
      // Crepe's own menus and pickers float outside the editor.
      if ((target as Element).closest?.('.milkdown, [class*="milkdown"], .crepe-image-upload')) return
      onDone()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer, true)
    }
  }, [onDone])

  const insertId = () => {
    const editor = view.current
    const node = editor?.state.schema.nodes[EXAM_ID_NODE]
    if (!editor || !node) return
    touched.current = true
    editor.dispatch(editor.state.tr.replaceSelectionWith(node.create()).scrollIntoView())
    editor.focus()
  }

  const toggleBorders = () => {
    const editor = view.current
    const current = editor ? tableAtSelection(editor) : null
    if (!editor || !current) return
    touched.current = true
    editor.dispatch(editor.state.tr.setNodeAttribute(
      current.pos,
      TABLE_BORDERS_ATTR,
      current.node.attrs[TABLE_BORDERS_ATTR] !== true,
    ))
    readTable()
    editor.focus()
  }

  return (
    <div className="header-editor" ref={root}>
      <div
        className="header-editor-bar"
        role="toolbar"
        aria-label={`${label} tools`}
        // A button here acts on the header's selection, so pressing it must
        // not take the focus — or the selection — away from the header.
        onMouseDown={(event) => {
          if ((event.target as HTMLElement).closest('button')) event.preventDefault()
        }}
      >
        <span className="header-editor-label">{label}</span>
        <button type="button" className="header-editor-button" onClick={insertId}>
          <Fingerprint aria-hidden="true" /> Insert ID
        </button>
        {table && (
          <button
            type="button"
            className="header-editor-button"
            aria-pressed={table.borders}
            onClick={toggleBorders}
          >
            <Grid2x2 aria-hidden="true" /> Show borders
          </button>
        )}
        <label className="header-editor-toggle">
          <input
            type="checkbox"
            checked={differentFirstPage}
            onChange={(event) => onDifferentFirstPageChange(event.target.checked)}
          />
          Different first page
        </label>
        <button type="button" className="header-editor-button" onClick={onRemove}>
          <Trash2 aria-hidden="true" /> Remove header
        </button>
        <button type="button" className="header-editor-button header-editor-done" onClick={onDone}>
          Done
        </button>
        {tooTall && (
          <span className="header-editor-warning" role="status">
            Header is too tall — trim it
          </span>
        )}
      </div>
      <div className="header-editor-body">
        <MilkdownProvider>
          <HeaderCrepe
            value={value}
            onChange={latestChange}
            touched={touched}
            onView={(editorView) => {
              view.current = editorView
              readTable()
            }}
            onSelectionChange={readTable}
          />
        </MilkdownProvider>
      </div>
    </div>
  )
}
