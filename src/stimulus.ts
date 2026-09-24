import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx'
import { createSlice } from '@milkdown/kit/ctx'
import { $nodeSchema, $prose, $view } from '@milkdown/kit/utils'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import { multipleChoiceEditableCtx, newMultipleChoiceNode } from './multiple-choice'

// A Stimulus: shared material — a passage, a quote, an image, a table — and
// the lettered Parts a student answers from it. The Stimulus is written at the
// top of the document, unnested, exactly where any other question's stem goes.
// Below it one `stimulusParts` box holds every Part; each Part carries its own
// stem and, nested inside it, the answer component a question of its kind
// already uses — a `multipleChoice` list or a `suggestedAnswer` block. Which
// of the two it holds is what kind of Part it is, so a Part's kind can never
// disagree with its answers.
//
// Parts are lettered by the stylesheet from their position, so deleting or
// moving one reletters the rest without a node view having to be told.

// Whether the question being edited is a Stimulus. On for one in the editor,
// off everywhere else: it is what lets the Parts box be regrown if the teacher
// deletes it, since there is no other way to put one back.
export const stimulusModeCtx = createSlice(false, 'stimulusMode')

export const stimulusMode = (enabled: boolean): MilkdownPlugin => (ctx) => {
  ctx.inject(stimulusModeCtx, enabled)
  return () => () => {
    ctx.remove(stimulusModeCtx)
  }
}

export type PartKind = 'multiple-choice' | 'open'

/** How each kind of Part is named on its tag and in the "Add Part" menu. */
export const PART_KIND_LABELS: Record<PartKind, string> = {
  'multiple-choice': 'Multiple Choice',
  open: 'Short Answer',
}

function partJSON(kind: PartKind) {
  return {
    type: 'stimulusPart',
    attrs: { id: crypto.randomUUID(), columns: 2 },
    content: [
      { type: 'stimulusPartStem', content: [{ type: 'paragraph' }] },
      kind === 'multiple-choice'
        ? newMultipleChoiceNode()
        : { type: 'suggestedAnswer', content: [{ type: 'paragraph' }] },
    ],
  }
}

/** The Parts box a new Stimulus opens with: one blank Multiple Choice Part. */
export function newStimulusPartsNode() {
  return { type: 'stimulusParts', content: [partJSON('multiple-choice')] }
}

// A Part's stem: the question this Part asks, as any blocks.
export const stimulusPartStemSchema = $nodeSchema('stimulusPartStem', () => ({
  content: 'block+',
  defining: true,
  isolating: true,
  parseDOM: [{ tag: 'div[data-type="stimulus-part-stem"]' }],
  toDOM: () => ['div', { 'data-type': 'stimulus-part-stem' }, 0],
  parseMarkdown: { match: () => false, runner: () => undefined },
  toMarkdown: { match: () => false, runner: () => undefined },
}))

// One Part: its stem, then the answer component that makes it the kind of Part
// it is. `id` is the Part's stable identity — its answer order and Work Space
// on an Exam are keyed by it — and `columns` is the answer layout a Multiple
// Choice Part starts with, as a question's own `columns` is.
export const stimulusPartSchema = $nodeSchema('stimulusPart', () => ({
  content: 'stimulusPartStem (multipleChoice | suggestedAnswer)',
  defining: true,
  isolating: true,
  attrs: { id: { default: '' }, columns: { default: 2 } },
  parseDOM: [
    {
      tag: 'div[data-type="stimulus-part"]',
      getAttrs: (element) => ({
        id: (element as HTMLElement).getAttribute('data-id') ?? '',
        columns: Number((element as HTMLElement).getAttribute('data-columns')) || 2,
      }),
    },
  ],
  toDOM: (node) => [
    'div',
    { 'data-type': 'stimulus-part', 'data-id': node.attrs.id, 'data-columns': node.attrs.columns },
    0,
  ],
  parseMarkdown: { match: () => false, runner: () => undefined },
  toMarkdown: { match: () => false, runner: () => undefined },
}))

// The box of Parts. It may be empty: a Stimulus with no Parts is incomplete
// rather than invalid, and the box stays to show where one goes.
export const stimulusPartsSchema = $nodeSchema('stimulusParts', () => ({
  group: 'block',
  content: 'stimulusPart*',
  defining: true,
  isolating: true,
  parseDOM: [{ tag: 'div[data-type="stimulus-parts"]' }],
  toDOM: () => ['div', { 'data-type': 'stimulus-parts' }, 0],
  parseMarkdown: { match: () => false, runner: () => undefined },
  toMarkdown: { match: () => false, runner: () => undefined },
}))

/** What kind of Part a node is, read from the answer component it holds. */
export function partKindOf(node: ProseNode): PartKind {
  return node.lastChild?.type.name === 'suggestedAnswer' ? 'open' : 'multiple-choice'
}

/** Append a blank Part of `kind` to the Parts box at `boxPosition` and put the
 *  cursor in its stem. */
export function addPart(
  view: Pick<EditorView, 'state' | 'dispatch'>,
  boxPosition: number,
  kind: PartKind,
) {
  const box = view.state.doc.nodeAt(boxPosition)
  if (box?.type.name !== 'stimulusParts') return false
  const part = view.state.schema.nodeFromJSON(partJSON(kind))
  const insertAt = boxPosition + box.nodeSize - 1
  const tr = view.state.tr.insert(insertAt, part)
  // Into the stem's first paragraph: past the Part, the stem and the paragraph.
  tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + 3)))
  view.dispatch(tr.scrollIntoView())
  return true
}

/** Move the Part at `partPosition` one place up or down among its siblings. */
export function movePart(
  view: Pick<EditorView, 'state' | 'dispatch'>,
  partPosition: number,
  direction: -1 | 1,
) {
  const $part = view.state.doc.resolve(partPosition)
  const box = $part.parent
  if (box.type.name !== 'stimulusParts') return false
  const index = $part.index()
  const target = index + direction
  if (target < 0 || target >= box.childCount) return false
  const part = box.child(index)
  const tr = view.state.tr
  if (direction < 0) {
    const previous = box.child(target)
    const previousPosition = partPosition - previous.nodeSize
    tr.delete(partPosition, partPosition + part.nodeSize)
    tr.insert(previousPosition, part)
  } else {
    const next = box.child(target)
    tr.delete(partPosition, partPosition + part.nodeSize)
    tr.insert(partPosition + next.nodeSize, part)
  }
  view.dispatch(tr.scrollIntoView())
  return true
}

/** Delete the Part at `partPosition`. The Parts box stays, however few Parts
 *  are left in it. */
export function deletePart(
  view: Pick<EditorView, 'state' | 'dispatch'>,
  partPosition: number,
) {
  const part = view.state.doc.nodeAt(partPosition)
  if (part?.type.name !== 'stimulusPart') return false
  view.dispatch(view.state.tr.delete(partPosition, partPosition + part.nodeSize))
  return true
}

/**
 * Keep the Parts box on the page. A Stimulus without it has nowhere to put a
 * Part, and the editor offers no other way to put one back, so a selection
 * that swallowed the box — a select-all delete, a paste over everything —
 * regrows an empty one at the end. Off for every other question type.
 */
export const keepStimulusParts = $prose((ctx: Ctx) =>
  new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      if (!ctx.get(stimulusModeCtx)) return null
      if (!transactions.some((tr) => tr.docChanged)) return null
      let present = false
      newState.doc.forEach((node) => {
        if (node.type.name === 'stimulusParts') present = true
      })
      if (present) return null
      const box = newState.schema.nodes.stimulusParts
      if (!box) return null
      return newState.tr.insert(newState.doc.content.size, box.create())
    },
  }),
)

function iconButton(label: string, text: string, className: string) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.setAttribute('aria-label', label)
  button.title = label
  button.textContent = text
  return button
}

// Node view for the Parts box: a dotted frame headed "Question Parts", the
// Parts inside it, and "+ Add Part" at its foot, which offers the two kinds a
// Part can be. Editor only: read-only views draw a Stimulus from the plan.
export const stimulusPartsView = $view(
  stimulusPartsSchema.node,
  (ctx: Ctx) => {
    return (initialNode, view, getPos): NodeView => {
      let node: ProseNode = initialNode
      const editable = () => ctx.get(multipleChoiceEditableCtx)

      const dom = document.createElement('div')
      dom.className = 'stimulus-parts'
      dom.dataset.type = 'stimulus-parts'

      const head = document.createElement('div')
      head.className = 'stimulus-parts-head'
      head.contentEditable = 'false'
      head.textContent = 'Question Parts'

      const contentDOM = document.createElement('div')
      contentDOM.className = 'stimulus-parts-list'

      const empty = document.createElement('p')
      empty.className = 'stimulus-parts-empty'
      empty.contentEditable = 'false'
      empty.textContent = 'No parts yet. Add one below.'

      const actions = document.createElement('div')
      actions.className = 'stimulus-parts-actions'
      actions.contentEditable = 'false'

      const addButton = document.createElement('button')
      addButton.type = 'button'
      addButton.className = 'stimulus-add-part'
      addButton.setAttribute('aria-haspopup', 'menu')
      addButton.setAttribute('aria-expanded', 'false')
      const plus = document.createElement('span')
      plus.className = 'mc-add-plus'
      plus.textContent = '+'
      const label = document.createElement('span')
      label.className = 'mc-add-label'
      label.textContent = 'Add Part'
      addButton.append(plus, label)

      const menu = document.createElement('div')
      menu.className = 'stimulus-add-menu'
      menu.setAttribute('role', 'menu')
      menu.hidden = true

      // Any press outside the menu closes it, as a menu elsewhere in the app
      // closes: the button never takes focus, so there is no blur to hear.
      const onOutsidePress = (event: MouseEvent) => {
        if (!actions.contains(event.target as Node)) setOpen(false)
      }
      const setOpen = (open: boolean) => {
        menu.hidden = !open
        addButton.setAttribute('aria-expanded', String(open))
        if (open) document.addEventListener('mousedown', onOutsidePress, true)
        else document.removeEventListener('mousedown', onOutsidePress, true)
      }

      for (const kind of ['multiple-choice', 'open'] as const) {
        const item = document.createElement('button')
        item.type = 'button'
        item.className = 'stimulus-add-menu-item'
        item.setAttribute('role', 'menuitem')
        item.textContent = PART_KIND_LABELS[kind]
        item.addEventListener('mousedown', (event) => {
          event.preventDefault()
          setOpen(false)
          if (!editable()) return
          const pos = getPos()
          if (pos == null) return
          addPart(view, pos, kind)
          view.focus()
        })
        menu.append(item)
      }

      addButton.addEventListener('mousedown', (event) => {
        event.preventDefault()
        setOpen(menu.hidden)
      })

      actions.append(addButton, menu)
      dom.append(head, contentDOM, empty, actions)

      const render = () => {
        empty.hidden = node.childCount > 0
        actions.style.display = editable() ? '' : 'none'
      }
      render()

      const chrome = (target: EventTarget | null) =>
        head.contains(target as Node)
        || empty.contains(target as Node)
        || actions.contains(target as Node)

      return {
        dom,
        contentDOM,
        update(next) {
          if (next.type !== node.type) return false
          node = next
          render()
          return true
        },
        ignoreMutation: (mutation) => chrome(mutation.target),
        stopEvent: (event) => chrome(event.target),
        destroy: () => setOpen(false),
      }
    }
  },
)

// Node view for one Part: a tag naming it — its letter, drawn by the
// stylesheet, and its kind — with the controls that move it up, move it down
// and delete it; then its stem and its answer component, both editable.
export const stimulusPartView = $view(
  stimulusPartSchema.node,
  (ctx: Ctx) => {
    return (initialNode, view, getPos): NodeView => {
      let node: ProseNode = initialNode
      const editable = () => ctx.get(multipleChoiceEditableCtx)

      const dom = document.createElement('div')
      dom.className = 'stimulus-part'
      dom.dataset.type = 'stimulus-part'

      const tag = document.createElement('div')
      tag.className = 'stimulus-part-tag'
      tag.contentEditable = 'false'

      const name = document.createElement('span')
      name.className = 'stimulus-part-name'
      const letter = document.createElement('span')
      letter.className = 'stimulus-part-letter'
      const kindLabel = document.createElement('span')
      kindLabel.className = 'stimulus-part-kind'
      name.append(letter, kindLabel)

      const controls = document.createElement('span')
      controls.className = 'stimulus-part-controls'
      const up = iconButton('Move part up', '↑', 'stimulus-part-control')
      const down = iconButton('Move part down', '↓', 'stimulus-part-control')
      const remove = iconButton('Delete part', '×', 'stimulus-part-control stimulus-part-delete')
      controls.append(up, down, remove)
      tag.append(name, controls)

      const contentDOM = document.createElement('div')
      contentDOM.className = 'stimulus-part-body'

      dom.append(tag, contentDOM)

      const act = (run: (pos: number) => void) => (event: MouseEvent) => {
        event.preventDefault()
        if (!editable()) return
        const pos = getPos()
        if (pos == null) return
        run(pos)
        view.focus()
      }
      up.addEventListener('mousedown', act((pos) => movePart(view, pos, -1)))
      down.addEventListener('mousedown', act((pos) => movePart(view, pos, 1)))
      remove.addEventListener('mousedown', act((pos) => deletePart(view, pos)))

      const render = () => {
        const kind = partKindOf(node)
        dom.dataset.kind = kind
        kindLabel.textContent = PART_KIND_LABELS[kind]
        controls.style.display = editable() ? '' : 'none'
      }
      render()

      return {
        dom,
        contentDOM,
        update(next) {
          if (next.type !== node.type) return false
          node = next
          render()
          return true
        },
        ignoreMutation: (mutation) => tag.contains(mutation.target),
        stopEvent: (event) => tag.contains(event.target as Node),
      }
    }
  },
)

// Node view for a Part's stem: a box of its own at the top of the Part, whose
// placeholder the stylesheet words for the Part's kind.
export const stimulusPartStemView = $view(
  stimulusPartStemSchema.node,
  () => (initialNode: ProseNode): NodeView => {
    let node: ProseNode = initialNode
    const dom = document.createElement('div')
    dom.className = 'stimulus-part-stem'
    dom.dataset.type = 'stimulus-part-stem'
    return {
      dom,
      contentDOM: dom,
      update(next) {
        if (next.type !== node.type) return false
        node = next
        return true
      },
    }
  },
)
