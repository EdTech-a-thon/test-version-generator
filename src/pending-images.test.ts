import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { inspectImportRecord } from './package-import'
import { checkAgainstSourceDocument, pendingImagesOfQuestions, withStoredPictures } from './pending-images'
import { ownDocumentMedia } from './local-images'
import { cleanDocument } from './question-doc'

const example = join(import.meta.dir, '..', 'public', 'formats', 'question-bank', '0.4.0', 'examples', 'pending-images.json')
const proposal = async () => inspectImportRecord(await Bun.file(example).bytes())
const tags = (...numbers: number[]) => numbers.map((tag) => ({ tag }))

const PAGES = [
  'World History Unit 4. 1. Use the map to name the trading station farthest east!',
  '2. WHICH graph shows a function that is increasing everywhere? 3. Which European power held the most stations on the map?',
  '',
  '4) Describe   the circuit shown below.',
]

describe('checking a record against its Source Document', () => {
  test('matches when every tag exists and the stems are in the document’s text', async () => {
    expect(checkAgainstSourceDocument(await proposal(), { tags: tags(1, 2, 3, 4), pageText: PAGES })).toEqual({
      unknownTags: [],
      stemsChecked: 4,
      stemsFound: 4,
      matches: true,
    })
  })

  test('warns when the record names a tag the document does not have', async () => {
    const check = checkAgainstSourceDocument(await proposal(), { tags: tags(1, 2), pageText: PAGES })
    expect(check).toMatchObject({ unknownTags: [3, 4], matches: false })
  })

  test('warns when most stems are not in the document', async () => {
    const check = checkAgainstSourceDocument(await proposal(), {
      tags: tags(1, 2, 3, 4),
      pageText: ['Chemistry quiz. Balance each equation.', PAGES[3]!],
    })
    expect(check).toMatchObject({ stemsChecked: 4, stemsFound: 1, matches: false })
  })

  test('checks only the tags of a document with no text layer', async () => {
    expect(checkAgainstSourceDocument(await proposal(), { tags: tags(1, 2, 3, 4), pageText: ['', ''] })).toEqual({
      unknownTags: [],
      stemsChecked: 0,
      stemsFound: 0,
      matches: true,
    })
  })
})

const graph = { type: 'image-block', attrs: { src: '', caption: 'Graph of f', ratio: 1, pending: { image: 3 } } }
const stored = {
  id: 'question-1',
  doc: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Which graph?' }] },
      graph,
      {
        type: 'multipleChoice',
        content: [
          { type: 'multipleChoiceChoice', attrs: { id: 'a', correct: false }, content: [{ type: 'image-block', attrs: { src: '', caption: '', ratio: 1, pending: { page: 2 } } }] },
          { type: 'multipleChoiceChoice', attrs: { id: 'b', correct: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'None' }] }] },
        ],
      },
    ],
  },
}

describe('saving a Question with Pending Images', () => {
  test('keeps what each one names, and gives an ordinary image no pending at all', async () => {
    const editorJson = {
      type: 'doc',
      content: [
        graph,
        { type: 'image-block', attrs: { src: `/local-images/${'a'.repeat(64)}`, caption: '', ratio: 1, pending: null } },
        { type: 'image-block', attrs: { src: '', caption: '', ratio: 1, pending: { image: 0 } } },
      ],
    }
    const cleaned = cleanDocument(editorJson) as { content: { attrs: Record<string, unknown> }[] }
    expect(cleaned.content[0]!.attrs.pending).toEqual({ image: 3 })
    expect('pending' in cleaned.content[1]!.attrs).toBe(false)
    expect('pending' in cleaned.content[2]!.attrs).toBe(false)

    // Owning media on save leaves a Pending Image as it is, rather than
    // replacing it with an image that could not be captured.
    expect(await ownDocumentMedia({ type: 'doc', content: [graph] })).toEqual({ type: 'doc', content: [graph] })
  })

  test('lists a stored Question’s Pending Images and resolves them in place', () => {
    const occurrences = pendingImagesOfQuestions([stored])
    expect(occurrences.map(({ key, where, pending }) => [key, where, pending])).toEqual([
      ['question-1/doc/0', 'Question', { image: 3 }],
      ['question-1/doc/1', 'Answer A', { page: 2 }],
    ])
    const resolved = withStoredPictures(stored, new Map([['question-1/doc/1', `/local-images/${'c'.repeat(64)}`]]))
    expect(pendingImagesOfQuestions([resolved]).map(({ pending }) => pending)).toEqual([{ image: 3 }])
    expect(JSON.stringify(resolved)).toContain(`/local-images/${'c'.repeat(64)}`)
  })
})
