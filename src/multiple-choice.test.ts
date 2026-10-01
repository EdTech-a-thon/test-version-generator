import { describe, expect, test } from 'bun:test'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'
import {
  TRUE_FALSE_LABELS,
  choiceNodeIsLocked,
  newTrueFalseNode,
  selectCorrectChoice,
  setChoiceLock,
} from './multiple-choice'
import { cleanDocument, type ProseMirrorJSON } from './question-doc'

const schema = new Schema({
  nodes: {
    doc: { content: 'multipleChoice' },
    text: { group: 'inline' },
    paragraph: { group: 'block', content: 'inline*' },
    multipleChoiceChoice: {
      content: 'paragraph block*',
      attrs: { correct: { default: false } },
    },
    multipleChoice: { content: 'multipleChoiceChoice+' },
  },
})

function build(correctIndex: number | null) {
  const choice = schema.nodes.multipleChoiceChoice!
  const paragraph = schema.nodes.paragraph!
  const list = schema.nodes.multipleChoice!
  const doc = schema.nodes.doc!.create(
    null,
    list.create(
      null,
      [0, 1, 2].map((index) =>
        choice.create({ correct: index === correctIndex }, paragraph.create()),
      ),
    ),
  )
  let state = EditorState.create({ schema, doc })
  const view = {
    get state() {
      return state
    },
    dispatch(transaction: Parameters<typeof state.apply>[0]) {
      state = state.apply(transaction)
    },
  }
  return { get state() { return state }, view }
}

// The position directly before choice `index` in the single list.
function choicePos(state: EditorState, index: number) {
  const list = state.doc.firstChild!
  let pos = 1
  for (let i = 0; i < index; i += 1) pos += list.child(i).nodeSize
  return pos
}

describe('multiple-choice', () => {
  test('selecting a choice marks it correct and clears the others', () => {
    const editor = build(null)
    expect(selectCorrectChoice(editor.view, choicePos(editor.state, 1))).toBe(true)
    const list = editor.state.doc.firstChild!
    expect([0, 1, 2].map((i) => list.child(i).attrs.correct)).toEqual([false, true, false])
  })

  test('selecting a different choice moves the correct flag', () => {
    const editor = build(1)
    selectCorrectChoice(editor.view, choicePos(editor.state, 2))
    const list = editor.state.doc.firstChild!
    expect([0, 1, 2].map((i) => list.child(i).attrs.correct)).toEqual([false, false, true])
  })
})

describe('the True/False pair', () => {
  test('is exactly two answers, written out, with neither marked correct', () => {
    const node = newTrueFalseNode()

    expect(TRUE_FALSE_LABELS).toEqual(['True', 'False'])
    expect(node.content).toHaveLength(2)
    expect(
      node.content.map((answer) => answer.content[0]!.content?.[0]?.text),
    ).toEqual(['True', 'False'])
    expect(node.content.every((answer) => answer.attrs.correct === false)).toBe(
      true,
    )
  })

  test('gives each answer its own stable id, as a multiple-choice answer has', () => {
    const ids = [...newTrueFalseNode().content, ...newTrueFalseNode().content]
      .map((answer) => answer.attrs.id)

    expect(new Set(ids).size).toBe(4)
    expect(ids.every((id) => id.length > 0)).toBe(true)
  })
})

describe('locking an answer in the question editor', () => {
  const lockSchema = new Schema({
    nodes: {
      doc: { content: 'multipleChoice' },
      text: { group: 'inline' },
      paragraph: { group: 'block', content: 'inline*' },
      multipleChoiceChoice: {
        content: 'paragraph block*',
        attrs: { correct: { default: false }, id: { default: '' }, locked: { default: null } },
      },
      multipleChoice: { content: 'multipleChoiceChoice+' },
    },
  })

  function editorWith(texts: string[]) {
    const paragraph = lockSchema.nodes.paragraph!
    const doc = lockSchema.nodes.doc!.create(
      null,
      lockSchema.nodes.multipleChoice!.create(
        null,
        texts.map((text, index) =>
          lockSchema.nodes.multipleChoiceChoice!.create(
            { id: `c${index}` },
            paragraph.create(null, text ? lockSchema.text(text) : null),
          ),
        ),
      ),
    )
    let state = EditorState.create({ schema: lockSchema, doc })
    const view = {
      get state() { return state },
      dispatch(transaction: Parameters<typeof state.apply>[0]) { state = state.apply(transaction) },
    }
    const choice = (index: number) => state.doc.firstChild!.child(index)
    const pos = (index: number) => choicePos(state, index)
    // Retype one answer's words, as a teacher editing it in place would.
    const retype = (index: number, text: string) => {
      const from = pos(index) + 2
      view.dispatch(state.tr.insertText(text, from, from + choice(index).textContent.length))
    }
    return { view, choice, pos, retype, get doc() { return state.doc } }
  }

  test('an answer is locked as soon as it reads "All of the above", with nothing stored', () => {
    const editor = editorWith(['Mercury', ''])
    expect(choiceNodeIsLocked(editor.choice(1))).toBe(false)
    editor.retype(1, 'All of the above')
    expect(choiceNodeIsLocked(editor.choice(1))).toBe(true)
    expect(editor.choice(1).attrs.locked).toBeNull()
    // Reworded into an ordinary answer, it moves again.
    editor.retype(1, 'Venus')
    expect(choiceNodeIsLocked(editor.choice(1))).toBe(false)
  })

  test('an answer the teacher unlocked stays unlocked however it is reworded', () => {
    const editor = editorWith(['Mercury', 'All of the above'])
    setChoiceLock(editor.view, editor.pos(1), false)
    expect(choiceNodeIsLocked(editor.choice(1))).toBe(false)
    editor.retype(1, 'None of the above')
    expect(choiceNodeIsLocked(editor.choice(1))).toBe(false)
    editor.retype(1, 'Both A and B')
    expect(editor.choice(1).attrs.locked).toBe(false)
    expect(choiceNodeIsLocked(editor.choice(1))).toBe(false)
  })

  test('an ordinary answer the teacher locked stays locked', () => {
    const editor = editorWith(['Mercury', 'Venus'])
    setChoiceLock(editor.view, editor.pos(0), true)
    editor.retype(0, 'Mars')
    expect(choiceNodeIsLocked(editor.choice(0))).toBe(true)
    expect(choiceNodeIsLocked(editor.choice(1))).toBe(false)
  })

  test("the teacher's decision survives storage, and an undecided answer stores none", () => {
    const editor = editorWith(['Mercury', 'All of the above', 'None of these'])
    setChoiceLock(editor.view, editor.pos(0), true)
    setChoiceLock(editor.view, editor.pos(2), false)
    const stored = cleanDocument({ type: 'doc', content: [editor.doc.toJSON().content[0]] })
    const attrs = ((stored.content as ProseMirrorJSON[])[0]!.content as ProseMirrorJSON[])
      .map((choice) => choice.attrs)
    expect(attrs).toEqual([
      { correct: false, id: 'c0', locked: true },
      { correct: false, id: 'c1' },
      { correct: false, id: 'c2', locked: false },
    ])
  })
})
