import { describe, expect, test } from 'bun:test'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'
import {
  TRUE_FALSE_LABELS,
  newTrueFalseNode,
  selectCorrectChoice,
} from './multiple-choice'

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
