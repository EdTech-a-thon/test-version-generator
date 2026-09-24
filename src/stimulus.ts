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
// The editor does not letter Parts: their order is what letters them on the
// paper, and the editor shows that order directly.

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

// The blank answer component a Part of `kind` starts with.
function answerJSON(kind: PartKind) {
  return kind === 'multiple-choice'
    ? newMultipleChoiceNode()
    : { type: 'suggestedAnswer', content: [{ type: 'paragraph' }] }
}

function partJSON(kind: PartKind) {
  return {
    type: 'stimulusPart',
    attrs: { id: crypto.randomUUID(), columns: 2 },
    content: [
      { type: 'stimulusPartStem', content: [{ type: 'paragraph' }] },
      answerJSON(kind),
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

/** A Part's answers set aside while it is another kind, by Part id and kind.
 *  It lives only as long as one editing session: the document — what is saved
 *  — holds the answers of the kind the Part is, and nothing of the other. */
export type SetAsideAnswers = Map<string, Partial<Record<PartKind, ProseNode>>>

/** Make the Part at `partPosition` a Part of `kind`. Its stem, id and columns
 *  stay; its answers are set aside in `setAside`, if given, and the answers it
 *  had when it was last `kind` come back — otherwise a blank set does — so
 *  switching away and back loses nothing. */
export function setPartKind(
  view: Pick<EditorView, 'state' | 'dispatch'>,
  partPosition: number,
  kind: PartKind,
  setAside?: SetAsideAnswers,
) {
  const part = view.state.doc.nodeAt(partPosition)
  if (part?.type.name !== 'stimulusPart') return false
  const current = partKindOf(part)
  if (current === kind) return false
  const answer = part.lastChild!
  const id = String(part.attrs.id)
  const kept = setAside?.get(id) ?? {}
  setAside?.set(id, { ...kept, [current]: answer })
  const replacement = kept[kind] ?? view.state.schema.nodeFromJSON(answerJSON(kind))
  const answerEnd = partPosition + part.nodeSize - 1
  view.dispatch(view.state.tr.replaceWith(answerEnd - answer.nodeSize, answerEnd, replacement))
  return true
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

/** Move the Part at `partPosition` so it lands before the Part now at
 *  `targetIndex` among its siblings — or after the last, at their count.
 *  Nothing happens where it already is. */
export function movePartTo(
  view: Pick<EditorView, 'state' | 'dispatch'>,
  partPosition: number,
  targetIndex: number,
) {
  const $part = view.state.doc.resolve(partPosition)
  const box = $part.parent
  if (box.type.name !== 'stimulusParts') return false
  const index = $part.index()
  if (targetIndex === index || targetIndex === index + 1) return false
  if (targetIndex < 0 || targetIndex > box.childCount) return false
  const part = box.child(index)
  let target = $part.start()
  for (let i = 0; i < targetIndex; i += 1) target += box.child(i).nodeSize
  const tr = view.state.tr.delete(partPosition, partPosition + part.nodeSize)
  tr.insert(tr.mapping.map(target), part)
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

// Lucide's icons, as the rest of the app draws them, for chrome built outside
// React: the question types' own icons, and the ones a Part's controls use.
const ICON_PATHS = {
  'multiple-choice': ['M13 5h8', 'M13 12h8', 'M13 19h8', 'm3 17 2 2 4-4', 'm3 7 2 2 4-4'],
  open: ['M21 5H3', 'M15 12H3', 'M17 19H3'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  plus: ['M5 12h14', 'M12 5v14'],
  check: ['M20 6 9 17l-5-5'],
  up: ['m5 12 7-7 7 7', 'M12 19V5'],
  down: ['M12 5v14', 'm19 12-7 7-7-7'],
  // The front matter's Type label.
  type: [
    'M12 22h6a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v6',
    'M14 2v5a1 1 0 0 0 1 1h5', 'M3 16v-1.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 .5.5V16', 'M6 22h2', 'M7 14v8',
  ],
} as const

function icon(name: keyof typeof ICON_PATHS) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  for (const [key, value] of Object.entries({
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  })) svg.setAttribute(key, value)
  for (const d of ICON_PATHS[name]) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', d)
    svg.append(path)
  }
  return svg
}

/** A kind of Part drawn as the question type's badge: its icon and its name. */
function kindBadge(kind: PartKind) {
  const badge = document.createElement('span')
  badge.className = 'badge badge-type'
  badge.append(icon(kind), PART_KIND_LABELS[kind])
  return badge
}

/**
 * A button that opens a small menu, closed again by any press outside it —
 * the button never takes focus, so there is no blur to hear. `choose` gets
 * the kind picked.
 */
function kindMenu(
  button: HTMLButtonElement,
  className: string,
  choose: (kind: PartKind) => void,
) {
  const wrap = document.createElement('span')
  wrap.className = 'stimulus-menu-anchor'
  const menu = document.createElement('div')
  menu.className = `stimulus-menu ${className}`
  menu.setAttribute('role', 'menu')
  menu.hidden = true
  button.setAttribute('aria-haspopup', 'menu')
  button.setAttribute('aria-expanded', 'false')

  const onOutsidePress = (event: MouseEvent) => {
    if (!wrap.contains(event.target as Node)) setOpen(false)
  }
  // Escape closes the menu and goes no further: the dialog around the editor
  // hears the same key as Cancel.
  const onEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    setOpen(false)
  }
  const setOpen = (open: boolean) => {
    menu.hidden = !open
    button.setAttribute('aria-expanded', String(open))
    if (open) {
      document.addEventListener('mousedown', onOutsidePress, true)
      document.addEventListener('keydown', onEscape, true)
    } else {
      document.removeEventListener('mousedown', onOutsidePress, true)
      document.removeEventListener('keydown', onEscape, true)
    }
  }
  const items = (['multiple-choice', 'open'] as const).map((kind) => {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'stimulus-menu-item'
    item.setAttribute('role', 'menuitem')
    item.setAttribute('aria-label', PART_KIND_LABELS[kind])
    item.append(kindBadge(kind))
    item.addEventListener('mousedown', (event) => {
      event.preventDefault()
      setOpen(false)
      choose(kind)
    })
    menu.append(item)
    return { kind, item }
  })
  button.addEventListener('mousedown', (event) => {
    event.preventDefault()
    setOpen(menu.hidden)
  })
  wrap.append(button, menu)
  return {
    wrap,
    close: () => setOpen(false),
    /** Mark the kind the Part already is, with the tick a chosen value has. */
    mark(chosen: PartKind | null) {
      for (const { kind, item } of items) {
        item.querySelector('.stimulus-menu-check')?.remove()
        if (kind === chosen) {
          const check = icon('check')
          check.classList.add('stimulus-menu-check')
          item.append(check)
          item.setAttribute('aria-checked', 'true')
        } else item.removeAttribute('aria-checked')
      }
    },
  }
}

function addPartButton() {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'stimulus-add-part'
  const label = document.createElement('span')
  label.textContent = 'Add Part'
  button.append(icon('plus'), label)
  return button
}

// Node view for the Parts box: a "Parts" heading ruled full width, with
// "+ Add Part" at its right end; the Parts under it; and "+ Add Part" again
// after the last of them. Either one offers the two kinds a Part can be.
// Editor only: read-only views draw a Stimulus from the plan.
export const stimulusPartsView = $view(
  stimulusPartsSchema.node,
  (ctx: Ctx) => {
    return (initialNode, view, getPos): NodeView => {
      let node: ProseNode = initialNode
      const editable = () => ctx.get(multipleChoiceEditableCtx)
      const add = (kind: PartKind) => {
        if (!editable()) return
        const pos = getPos()
        if (pos == null) return
        addPart(view, pos, kind)
        view.focus()
      }

      const dom = document.createElement('div')
      dom.className = 'stimulus-parts'
      dom.dataset.type = 'stimulus-parts'

      const head = document.createElement('div')
      head.className = 'stimulus-parts-head'
      head.contentEditable = 'false'
      const title = document.createElement('span')
      title.textContent = 'Parts'
      const headAdd = kindMenu(addPartButton(), 'stimulus-menu--below stimulus-menu--end', add)
      head.append(title, headAdd.wrap)

      const contentDOM = document.createElement('div')
      contentDOM.className = 'stimulus-parts-list'

      const empty = document.createElement('p')
      empty.className = 'stimulus-parts-empty'
      empty.contentEditable = 'false'
      empty.textContent = 'No parts yet.'

      const actions = document.createElement('div')
      actions.className = 'stimulus-parts-actions'
      actions.contentEditable = 'false'
      const footAdd = kindMenu(addPartButton(), 'stimulus-menu--above', add)
      actions.append(footAdd.wrap)

      dom.append(head, contentDOM, empty, actions)

      const render = () => {
        empty.hidden = node.childCount > 0
        const shown = editable() ? '' : 'none'
        actions.style.display = shown
        headAdd.wrap.style.display = shown
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
        destroy: () => {
          headAdd.close()
          footAdd.close()
        },
      }
    }
  },
)

// Node view for one Part: one dashed box, drawn as a question of its kind.
// At the top, shaded, a header set as the question editor's front matter is —
// the Type label, then the Part's type as the question type's badge, which
// opens a menu to switch it — with the controls that move the Part up, move it
// down and delete it at the right; then, ruled off, its stem; then its answer
// component as the box's last cells.
export const stimulusPartView = $view(
  stimulusPartSchema.node,
  (ctx: Ctx) => {
    // One editor's answers set aside by switching a Part's kind, so switching
    // back brings them again. Never saved: see `SetAsideAnswers`.
    const setAside: SetAsideAnswers = new Map()
    return (initialNode, view, getPos): NodeView => {
      let node: ProseNode = initialNode
      const editable = () => ctx.get(multipleChoiceEditableCtx)

      const dom = document.createElement('div')
      dom.className = 'stimulus-part'
      dom.dataset.type = 'stimulus-part'

      const header = document.createElement('div')
      header.className = 'stimulus-part-header'
      header.contentEditable = 'false'

      const label = document.createElement('span')
      label.className = 'stimulus-part-label'
      label.append(icon('type'), 'Type')

      const kindButton = document.createElement('button')
      kindButton.type = 'button'
      kindButton.className = 'stimulus-part-kind'
      const kind = kindMenu(kindButton, 'stimulus-menu--below', (next) => {
        if (!editable()) return
        const pos = getPos()
        if (pos == null) return
        setPartKind(view, pos, next, setAside)
        view.focus()
      })

      const controls = document.createElement('span')
      controls.className = 'stimulus-part-controls'
      const control = (name: 'up' | 'down' | 'x', text: string, run: (pos: number) => void) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = `stimulus-part-control stimulus-part-${name}`
        button.setAttribute('aria-label', text)
        button.title = text
        button.append(icon(name))
        button.addEventListener('mousedown', (event) => {
          event.preventDefault()
          if (!editable()) return
          const pos = getPos()
          if (pos == null) return
          run(pos)
          view.focus()
        })
        controls.append(button)
      }
      const indexAt = (pos: number) => view.state.doc.resolve(pos).index()
      control('up', 'Move part up', (pos) => movePartTo(view, pos, indexAt(pos) - 1))
      control('down', 'Move part down', (pos) => movePartTo(view, pos, indexAt(pos) + 2))
      control('x', 'Delete part', (pos) => deletePart(view, pos))

      header.append(label, kind.wrap, controls)

      const contentDOM = document.createElement('div')
      contentDOM.className = 'stimulus-part-body'

      dom.append(header, contentDOM)

      const render = () => {
        const current = partKindOf(node)
        dom.dataset.kind = current
        kindButton.replaceChildren(kindBadge(current))
        kindButton.setAttribute('aria-label', `Part type: ${PART_KIND_LABELS[current]}`)
        kind.mark(current)
        const on = editable()
        kindButton.disabled = !on
        if (!on) kind.close()
        controls.style.display = on ? '' : 'none'
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
        ignoreMutation: (mutation) => header.contains(mutation.target),
        stopEvent: (event) => header.contains(event.target as Node),
        destroy: () => kind.close(),
      }
    }
  },
)

// Node view for a Part's stem: the middle of the Part's box, under its header
// and over its answers, with a placeholder the stylesheet words for the Part's
// kind.
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
