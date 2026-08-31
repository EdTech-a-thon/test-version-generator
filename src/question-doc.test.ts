import { describe, expect, test } from 'bun:test'
import {
  choiceIdOf,
  cleanDocument,
  choiceNodesOf,
  multipleChoiceNodeOf,
  withFreshChoiceIds,
  withMultipleChoice,
  withoutMultipleChoice,
} from './question-doc'
import type { ProseMirrorJSON } from './question-doc'

function doc(...content: ProseMirrorJSON[]): ProseMirrorJSON {
  return { type: 'doc', content }
}

function choiceList(...ids: string[]): ProseMirrorJSON {
  return {
    type: 'multipleChoice',
    content: ids.map((id) => ({
      type: 'multipleChoiceChoice',
      attrs: { correct: id === ids[0], id },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }],
    })),
  }
}

describe('cleanDocument', () => {
  test('keeps a heading its level', () => {
    const cleaned = cleanDocument(
      doc({
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: 'Titration' }],
      }),
    )
    expect(cleaned).toEqual(
      doc({
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: 'Titration' }],
      }),
    )
  })

  test('keeps an image its source', () => {
    const image = {
      type: 'image-block',
      attrs: { src: '/local-images/abc', caption: 'Setup', ratio: 1 },
    }
    expect(cleanDocument(doc(image))).toEqual(doc(image))
  })

  test('keeps a latex node its value', () => {
    const math = {
      type: 'paragraph',
      content: [{ type: 'math_inline', attrs: { value: 'H_2O' } }],
    }
    expect(cleanDocument(doc(math))).toEqual(doc(math))
  })

  test('keeps a link its href', () => {
    const paragraph = {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'source',
          marks: [{ type: 'link', attrs: { href: 'https://example.org', title: '' } }],
        },
      ],
    }
    expect(cleanDocument(doc(paragraph))).toEqual(doc(paragraph))
  })

  test('drops anything that is not part of a node', () => {
    const cleaned = cleanDocument(
      doc({
        type: 'paragraph',
        selected: true,
        content: [{ type: 'text', text: 'x', nodeSize: 3 }],
      }),
    )
    expect(cleaned).toEqual(
      doc({ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }),
    )
  })

  test('normalises a choice to its correctness and its id', () => {
    const cleaned = cleanDocument(
      doc({
        type: 'multipleChoice',
        content: [
          {
            type: 'multipleChoiceChoice',
            attrs: { correct: 'yes', id: 7, stray: 1 },
            content: [{ type: 'paragraph' }],
          },
          {
            type: 'multipleChoiceChoice',
            attrs: { correct: true, id: 'c2' },
            content: [{ type: 'paragraph' }],
          },
        ],
      }),
    )
    const choices = choiceNodesOf(cleaned)
    expect(choices.map((choice) => choice.attrs)).toEqual([
      { correct: false, id: '' },
      { correct: true, id: 'c2' },
    ])
  })

  test('never leaves a choice list with fewer than two answers', () => {
    const cleaned = cleanDocument(doc(choiceList('c1')))
    expect(choiceNodesOf(cleaned)).toHaveLength(2)
  })
})

describe('withoutMultipleChoice and withMultipleChoice', () => {
  test('withoutMultipleChoice removes the choice list, keeping the rest of the document', () => {
    const stem = { type: 'paragraph', content: [{ type: 'text', text: 'stem' }] }
    const original = doc(stem, choiceList('c1', 'c2'))
    const lifted = withoutMultipleChoice(original)
    expect(lifted.content).toEqual([stem])
    expect(multipleChoiceNodeOf(lifted)).toBeUndefined()
    // The original document is untouched.
    expect(multipleChoiceNodeOf(original)).toBeDefined()
  })

  test('withMultipleChoice appends the given node to a document with none', () => {
    const stem = { type: 'paragraph' }
    const choices = choiceList('c1', 'c2')
    const withChoices = withMultipleChoice(doc(stem), choices)
    expect(withChoices.content).toEqual([stem, choices])
  })

  test('withMultipleChoice replaces an existing choice list rather than duplicating it', () => {
    const stem = { type: 'paragraph' }
    const original = doc(stem, choiceList('c1', 'c2'))
    const replacement = choiceList('c3', 'c4')
    const replaced = withMultipleChoice(original, replacement)
    expect(replaced.content).toEqual([stem, replacement])
  })
})

describe('withFreshChoiceIds', () => {
  test('gives every choice a new id so a duplicate shares none with its original', () => {
    const original = doc({ type: 'paragraph' }, choiceList('c1', 'c2'))
    const copy = withFreshChoiceIds(original)
    const ids = choiceNodesOf(copy).map(choiceIdOf)
    expect(new Set(ids).size).toBe(2)
    expect(ids).not.toContain('c1')
    expect(ids).not.toContain('c2')
  })

  test('keeps everything else, correctness included, and leaves the original alone', () => {
    const original = doc({ type: 'paragraph' }, choiceList('c1', 'c2'))
    const copy = withFreshChoiceIds(original)
    expect(
      choiceNodesOf(copy).map((choice) => (choice.attrs as { correct: boolean }).correct),
    ).toEqual([true, false])
    expect(choiceNodesOf(copy).map((choice) => choice.content)).toEqual(
      choiceNodesOf(original).map((choice) => choice.content),
    )
    expect(choiceNodesOf(original).map(choiceIdOf)).toEqual(['c1', 'c2'])
  })
})
