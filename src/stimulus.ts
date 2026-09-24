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
// dragging one reletters the rest without a node view having to be told.

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
  chevron: ['m6 9 6 6 6-6'],
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

// Crepe's own drag handle, so a Part is picked up by the handle every other
// block in the editor is.
const DRAG_HANDLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 9.83366C3.35833 9.83366 3.23961 9.78571 3.14383 9.68983C3.04794 9.59394 3 9.47516 3 9.33349C3 9.19171 3.04794 9.07299 3.14383 8.97733C3.23961 8.88155 3.35833 8.83366 3.5 8.83366H12.5C12.6417 8.83366 12.7604 8.8816 12.8562 8.97749C12.9521 9.07338 13 9.19216 13 9.33383C13 9.4756 12.9521 9.59433 12.8562 9.68999C12.7604 9.78577 12.6417 9.83366 12.5 9.83366H3.5ZM3.5 7.16699C3.35833 7.16699 3.23961 7.11905 3.14383 7.02316C3.04794 6.92727 3 6.80849 3 6.66683C3 6.52505 3.04794 6.40633 3.14383 6.31066C3.23961 6.21488 3.35833 6.16699 3.5 6.16699H12.5C12.6417 6.16699 12.7604 6.21494 12.8562 6.31083C12.9521 6.40671 13 6.52549 13 6.66716C13 6.80894 12.9521 6.92766 12.8562 7.02333C12.7604 7.1191 12.6417 7.16699 12.5 7.16699H3.5Z"/></svg>`

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

// Node view for one Part: a title line — the drag handle in the margin, its
// letter, drawn by the stylesheet, its kind as the question type's badge,
// which opens a menu to switch it, and × to delete it at the far right — ruled
// dotted full width; then its stem and its answer component, both editable
// and drawn as a question of that kind draws them.
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

      const title = document.createElement('div')
      title.className = 'stimulus-part-title'
      title.contentEditable = 'false'

      const handle = document.createElement('span')
      handle.className = 'stimulus-part-handle'
      handle.setAttribute('aria-label', 'Drag to reorder')
      handle.title = 'Drag to reorder'
      handle.innerHTML = DRAG_HANDLE_SVG

      const letter = document.createElement('span')
      letter.className = 'stimulus-part-letter'

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

      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'stimulus-part-delete'
      remove.setAttribute('aria-label', 'Delete part')
      remove.title = 'Delete part'
      remove.append(icon('x'))
      remove.addEventListener('mousedown', (event) => {
        event.preventDefault()
        if (!editable()) return
        const pos = getPos()
        if (pos == null) return
        deletePart(view, pos)
        view.focus()
      })

      title.append(handle, letter, kind.wrap, remove)

      // Picked up by its handle, the Part follows the pointer among its
      // siblings — and only there, so it can never land outside the Parts —
      // with a line showing where it will go, and moves there on release.
      // Pointer events rather than the browser's own drag and drop, which a
      // browser will not start from inside the editable document.
      const indicator = document.createElement('div')
      indicator.className = 'stimulus-part-drop-line'
      let dropIndex: number | null = null
      const siblings = () =>
        Array.from(dom.parentElement?.children ?? [])
          .filter((element) => element.classList.contains('stimulus-part'))
      const track = (event: PointerEvent) => {
        const parts = siblings()
        if (parts.length === 0) return
        let index = parts.findIndex((element) => {
          const box = element.getBoundingClientRect()
          return event.clientY < box.top + box.height / 2
        })
        if (index < 0) index = parts.length
        dropIndex = index
        const edge = index < parts.length
          ? parts[index]!.getBoundingClientRect().top - 12
          : parts.at(-1)!.getBoundingClientRect().bottom + 12
        const list = dom.parentElement!.getBoundingClientRect()
        Object.assign(indicator.style, {
          top: `${edge - 1}px`, left: `${list.left}px`, width: `${list.width}px`,
        })
      }
      const finish = (event: PointerEvent) => {
        handle.releasePointerCapture?.(event.pointerId)
        handle.removeEventListener('pointermove', track)
        indicator.remove()
        document.body.classList.remove('stimulus-part-dragging')
        const pos = getPos()
        const target = dropIndex
        dropIndex = null
        if (event.type !== 'pointerup' || pos == null || target == null) return
        movePartTo(view, pos, target)
        view.focus()
      }
      handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || !editable()) return
        event.preventDefault()
        handle.setPointerCapture?.(event.pointerId)
        document.body.classList.add('stimulus-part-dragging')
        document.body.append(indicator)
        track(event)
        handle.addEventListener('pointermove', track)
        handle.addEventListener('pointerup', finish, { once: true })
        handle.addEventListener('pointercancel', finish, { once: true })
      })

      const contentDOM = document.createElement('div')
      contentDOM.className = 'stimulus-part-body'

      dom.append(title, contentDOM)

      const render = () => {
        const current = partKindOf(node)
        dom.dataset.kind = current
        kindButton.replaceChildren(kindBadge(current))
        kindButton.setAttribute('aria-label', `Part type: ${PART_KIND_LABELS[current]}`)
        kind.mark(current)
        const on = editable()
        kindButton.disabled = !on
        if (!on) kind.close()
        handle.style.display = on ? '' : 'none'
        remove.style.display = on ? '' : 'none'
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
        ignoreMutation: (mutation) => title.contains(mutation.target),
        stopEvent: (event) => title.contains(event.target as Node),
        destroy: () => {
          kind.close()
          indicator.remove()
        },
      }
    }
  },
)

// Node view for a Part's stem: written under the Part's title as a question's
// stem is written, unboxed, with a placeholder the stylesheet words for the
// Part's kind.
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
