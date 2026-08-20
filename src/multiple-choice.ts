import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx'
import { createSlice } from '@milkdown/kit/ctx'
import { $nodeSchema, $prose, $useKeymap, $view } from '@milkdown/kit/utils'
import type { Node as ProseNode, ResolvedPos } from '@milkdown/kit/prose/model'
import { Plugin, TextSelection } from '@milkdown/kit/prose/state'
import type { Command } from '@milkdown/kit/prose/state'
import { splitBlock } from '@milkdown/kit/prose/commands'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'

// Whether the radio buttons can change the correct answer. Off in read-only
// previews, on inside the question editor.
export const multipleChoiceEditableCtx = createSlice(
  false,
  'multipleChoiceEditable',
)

export const multipleChoiceMode = (editable: boolean): MilkdownPlugin => (
  ctx,
) => {
  ctx.inject(multipleChoiceEditableCtx, editable)
  return () => () => {
    ctx.remove(multipleChoiceEditableCtx)
  }
}

// Mark one choice as correct and clear the rest, so the radios stay mutually
// exclusive. `choicePosition` is the position directly before a choice node.
export function selectCorrectChoice(
  view: Pick<EditorView, 'state' | 'dispatch'>,
  choicePosition: number,
) {
  const $choice = view.state.doc.resolve(choicePosition)
  const parent = $choice.parent
  if (parent.type.name !== 'multipleChoice') return false
  const tr = view.state.tr
  let pos = $choice.start()
  parent.forEach((child) => {
    const correct = pos === choicePosition
    if (child.attrs.correct !== correct) {
      tr.setNodeMarkup(pos, undefined, { ...child.attrs, correct })
    }
    pos += child.nodeSize
  })
  if (tr.docChanged) view.dispatch(tr)
  return true
}

// A single answer. Behaves like a list item: it holds a paragraph (and any
// following blocks) and its correctness is a plain boolean.
export const multipleChoiceChoiceSchema = $nodeSchema(
  'multipleChoiceChoice',
  () => ({
    content: 'paragraph block*',
    defining: true,
    // `id` gives each choice a stable identity so ProseMirror matches node
    // views by choice rather than by markup. Without it every choice looks
    // identical bar `correct`, and PM reuses/reorders the radio DOM when the
    // correct flag moves, leaving stale radios checked. See uniqueChoiceIds.
    attrs: { correct: { default: false }, id: { default: '' } },
    parseDOM: [
      {
        tag: 'div[data-type="multiple-choice-choice"]',
        getAttrs: (element) => ({
          correct: (element as HTMLElement).getAttribute('data-correct') === 'true',
          id: (element as HTMLElement).getAttribute('data-id') ?? '',
        }),
      },
    ],
    toDOM: (node) => [
      'div',
      {
        'data-type': 'multiple-choice-choice',
        'data-correct': String(node.attrs.correct === true),
        'data-id': node.attrs.id,
      },
      0,
    ],
    parseMarkdown: { match: () => false, runner: () => undefined },
    toMarkdown: { match: () => false, runner: () => undefined },
  }),
)

// The list of answers. Like a bullet list: a block that contains choices.
export const multipleChoiceSchema = $nodeSchema('multipleChoice', () => ({
  group: 'block',
  content: 'multipleChoiceChoice+',
  parseDOM: [{ tag: 'div[data-type="multiple-choice"]' }],
  toDOM: () => ['div', { 'data-type': 'multiple-choice' }, 0],
  parseMarkdown: { match: () => false, runner: () => undefined },
  toMarkdown: { match: () => false, runner: () => undefined },
}))

// Depth of the multipleChoiceChoice enclosing a position, or 0 if none.
function choiceDepthOf($pos: ResolvedPos) {
  let depth = $pos.depth
  while (depth > 0 && $pos.node(depth).type.name !== 'multipleChoiceChoice') {
    depth -= 1
  }
  return depth
}

// Enter inside a choice adds a newline within the cell (a new paragraph), like
// typing in a table cell — it never leaves or splits the list. Elsewhere it
// returns false so normal editing is untouched.
const newlineInChoice: Command = (state, dispatch) => {
  if (choiceDepthOf(state.selection.$from) === 0) return false
  return splitBlock(state, dispatch)
}

// Tab / Shift-Tab move between cells, like a table. Tab past the last cell adds
// a new empty choice (its id is filled in by uniqueChoiceIds).
function moveBetweenChoices(direction: 1 | -1, createAtEnd: boolean): Command {
  return (state, dispatch) => {
    const { $from } = state.selection
    const depth = choiceDepthOf($from)
    if (depth === 0) return false
    const listDepth = depth - 1
    const list = $from.node(listDepth)
    const listStart = $from.start(listDepth)
    const target = $from.index(listDepth) + direction
    if (target < 0) return false

    if (target >= list.childCount) {
      if (!createAtEnd) return false
      if (dispatch) {
        const paragraph = state.schema.nodes.paragraph
        if (!paragraph) return false
        const choice = list.child(0).type.create({ correct: false, id: '' }, paragraph.create())
        const listEnd = $from.end(listDepth)
        const tr = state.tr.insert(listEnd, choice)
        tr.setSelection(TextSelection.near(tr.doc.resolve(listEnd + 2)))
        dispatch(tr.scrollIntoView())
      }
      return true
    }

    if (dispatch) {
      let pos = listStart
      for (let index = 0; index < target; index += 1) pos += list.child(index).nodeSize
      const selection = TextSelection.near(state.doc.resolve(pos + 2), direction)
      dispatch(state.tr.setSelection(selection).scrollIntoView())
    }
    return true
  }
}

// Arrow-Down at the last line of the last answer doesn't leave the list yet: it
// focuses the "Add answer" button (armed state), so typing there starts a new
// answer. A second Arrow-Down from the button leaves the component as usual.
const armAddAnswerOnDown: Command = (state, _dispatch, view) => {
  if (!view) return false
  const { selection } = state
  if (!(selection instanceof TextSelection) || !selection.empty) return false
  const { $from } = selection
  const depth = choiceDepthOf($from)
  if (depth === 0) return false
  const list = $from.node(depth - 1)
  if ($from.index(depth - 1) !== list.childCount - 1) return false // not the last answer
  const choice = $from.node(depth)
  if ($from.index(depth) !== choice.childCount - 1) return false // not the last line's block
  if (!view.endOfTextblock('down')) return false // not on the last visual line
  const dom = view.nodeDOM($from.before(depth - 1))
  const button = dom instanceof HTMLElement ? dom.querySelector('.mc-add-choice') : null
  if (!(button instanceof HTMLElement)) return false
  button.focus()
  return true
}

export const multipleChoiceKeymap = $useKeymap('multipleChoiceKeymap', {
  NewlineInChoice: {
    shortcuts: 'Enter',
    priority: 100,
    command: () => newlineInChoice,
  },
  ArmAddAnswer: {
    shortcuts: 'ArrowDown',
    priority: 100,
    command: () => armAddAnswerOnDown,
  },
  NextChoice: {
    shortcuts: 'Tab',
    priority: 100,
    command: () => moveBetweenChoices(1, true),
  },
  PrevChoice: {
    shortcuts: 'Shift-Tab',
    priority: 100,
    command: () => moveBetweenChoices(-1, false),
  },
})

// Guarantee every choice carries a unique id. New choices (Enter-split, paste,
// or legacy docs) arrive with an empty id; give those a fresh one. Duplicate
// ids (e.g. a copied choice) are reassigned too, keeping the first occurrence.
export const uniqueChoiceIds = $prose(
  () => new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null
      const seen = new Set<string>()
      const tr = newState.tr
      let changed = false
      newState.doc.descendants((node, pos) => {
        if (node.type.name !== 'multipleChoiceChoice') return
        const id = node.attrs.id
        if (!id || seen.has(id)) {
          const nextId = crypto.randomUUID()
          seen.add(nextId)
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: nextId })
          changed = true
        } else {
          seen.add(id)
        }
      })
      return changed ? tr : null
    },
  }),
)

function choiceJSON(correct = false) {
  return {
    type: 'multipleChoiceChoice',
    attrs: { correct, id: crypto.randomUUID() },
    content: [{ type: 'paragraph' }],
  }
}

export function newMultipleChoiceNode() {
  return {
    type: 'multipleChoice',
    content: Array.from({ length: 4 }, () => choiceJSON()),
  }
}

// Node view for a choice: a non-editable radio button on the left plus the
// editable answer content. Everything else (add/remove/navigate) is handled by
// ProseMirror's native list and block editing.
export const multipleChoiceChoiceView = $view(
  multipleChoiceChoiceSchema.node,
  (ctx: Ctx) => {
    return (initialNode, view, getPos): NodeView => {
      let node: ProseNode = initialNode
      const editable = () => ctx.get(multipleChoiceEditableCtx)

      const dom = document.createElement('div')
      dom.className = 'mc-choice'
      dom.dataset.type = 'multiple-choice-choice'

      const control = document.createElement('label')
      control.className = 'mc-choice-control'
      control.contentEditable = 'false'

      const radio = document.createElement('input')
      radio.type = 'radio'
      radio.className = 'mc-choice-radio'
      radio.setAttribute('aria-label', 'Mark this answer correct')
      control.append(radio)

      const contentDOM = document.createElement('div')
      contentDOM.className = 'mc-choice-body'

      dom.append(control, contentDOM)

      const render = () => {
        radio.checked = node.attrs.correct === true
        radio.disabled = !editable()
        dom.dataset.correct = String(node.attrs.correct === true)
      }

      const activate = () => {
        if (!editable()) return
        const pos = getPos()
        if (pos == null) return
        // Stable choice ids let ProseMirror repaint the right radios in place,
        // so simply writing the doc is enough — no manual DOM juggling.
        selectCorrectChoice(view, pos)
      }

      // Act on mousedown (the event ProseMirror uses for selection) and prevent
      // its default so the text cursor stays where it is.
      radio.addEventListener('mousedown', (event) => {
        event.preventDefault()
        activate()
      })
      radio.addEventListener('click', (event) => event.preventDefault())

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
        ignoreMutation: (mutation) => control.contains(mutation.target),
        stopEvent: (event) => control.contains(event.target as Node),
      }
    }
  },
)

// Node view for the whole list: the choices plus an "Add answer" button beneath
// them (editor only). The button appends an empty choice and drops the cursor
// into it; its id is filled in by uniqueChoiceIds.
export const multipleChoiceView = $view(
  multipleChoiceSchema.node,
  (ctx: Ctx) => {
    return (initialNode, view, getPos): NodeView => {
      let node: ProseNode = initialNode
      const editable = () => ctx.get(multipleChoiceEditableCtx)

      const dom = document.createElement('div')
      dom.dataset.type = 'multiple-choice'

      const contentDOM = document.createElement('div')
      contentDOM.className = 'mc-choices'

      const addButton = document.createElement('button')
      addButton.type = 'button'
      addButton.className = 'mc-add-choice'
      addButton.contentEditable = 'false'
      const plus = document.createElement('span')
      plus.className = 'mc-add-plus'
      plus.textContent = '+'
      const caret = document.createElement('span')
      caret.className = 'mc-add-caret'
      const label = document.createElement('span')
      label.className = 'mc-add-label'
      label.textContent = 'Add answer'
      addButton.append(plus, caret, label)

      // Append a new answer (optionally seeded with a typed character) and put
      // the cursor in it. Its id is filled in by uniqueChoiceIds.
      const addAnswer = (text?: string) => {
        if (!editable()) return
        const pos = getPos()
        if (pos == null) return
        const paragraph = view.state.schema.nodes.paragraph
        const choiceType = view.state.schema.nodes.multipleChoiceChoice
        if (!paragraph || !choiceType) return
        const body = text
          ? paragraph.create(null, view.state.schema.text(text))
          : paragraph.create()
        const choice = choiceType.create({ correct: false, id: '' }, body)
        const insertAt = pos + node.nodeSize - 1
        const tr = view.state.tr.insert(insertAt, choice)
        const caretPos = insertAt + 2 + (text ? text.length : 0)
        tr.setSelection(TextSelection.near(tr.doc.resolve(caretPos)))
        view.dispatch(tr.scrollIntoView())
        view.focus()
      }

      // Move the editor selection to the given position and refocus the editor.
      const selectAt = (position: number, bias: 1 | -1) => {
        view.dispatch(
          view.state.tr
            .setSelection(TextSelection.near(view.state.doc.resolve(position), bias))
            .scrollIntoView(),
        )
        view.focus()
      }

      addButton.addEventListener('mousedown', (event) => {
        event.preventDefault()
        addAnswer()
      })
      // Armed = the button holds focus (see armAddAnswerOnDown).
      addButton.addEventListener('focus', () =>
        addButton.classList.add('mc-add-choice--armed'),
      )
      addButton.addEventListener('blur', () =>
        addButton.classList.remove('mc-add-choice--armed'),
      )
      addButton.addEventListener('keydown', (event) => {
        if (!editable()) return
        const pos = getPos()
        if (pos == null) return
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          selectAt(pos + node.nodeSize - 2, -1) // back to the end of the last answer
        } else if (event.key === 'ArrowDown') {
          event.preventDefault()
          selectAt(pos + node.nodeSize, 1) // leave the component (or stay if nothing follows)
        } else if (event.key === 'Enter') {
          event.preventDefault()
          addAnswer()
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
          event.preventDefault()
          addAnswer(event.key)
        }
      })

      const render = () => {
        addButton.style.display = editable() ? '' : 'none'
      }

      dom.append(contentDOM, addButton)
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
        ignoreMutation: (mutation) => addButton.contains(mutation.target),
        stopEvent: (event) => addButton.contains(event.target as Node),
      }
    }
  },
)
