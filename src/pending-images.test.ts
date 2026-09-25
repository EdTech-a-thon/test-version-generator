import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { inspectImportRecord } from './package-import'
import { initialSelection } from './import-selection'
import { planImport } from './package-commit'
import {
  checkAgainstSourceDocument,
  pendingImagesOf,
  pendingImagesOfQuestions,
  pendingKeyOf,
  withPendingKeys,
  withStoredPictures,
} from './pending-images'
import { estimatedSize, resolutionOf } from './resolved-pictures'
import { ownDocumentMedia } from './local-images'
import { cleanDocument, pendingImageOf, type ProseMirrorJSON } from './question-doc'

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
    const resolved = withStoredPictures(stored, new Map([['question-1/doc/1', { src: `/local-images/${'c'.repeat(64)}`, ratio: 0.4 }]]))
    expect(pendingImagesOfQuestions([resolved]).map(({ pending }) => pending)).toEqual([{ image: 3 }])
    expect(JSON.stringify(resolved)).toMatch(new RegExp(`"src":"/local-images/${'c'.repeat(64)}"[^}]*"ratio":0.4}`))
  })
})

describe('previewing Pending Images', () => {
  test('each one carries its key into the editor documents, and only there', async () => {
    const found = await proposal()
    const bank = found.banks[0]!
    const keys = pendingImagesOf(found).map(({ key }) => key)
    const plan = planImport(
      { ...found, banks: [{ ...bank, record: withPendingKeys(bank.id, bank.record) }] },
      initialSelection(found),
      (() => { let next = 0; return () => `id-${next++}` })(),
    )
    const marked: string[] = []
    const visit = (node: ProseMirrorJSON) => {
      const key = pendingKeyOf(node)
      if (key) {
        marked.push(key)
        // What it names is still read exactly.
        expect(pendingImageOf(node)).toBeDefined()
      }
      for (const child of (node.content as ProseMirrorJSON[] | undefined) ?? []) visit(child)
    }
    for (const question of plan.banks[0]!.questions) visit(question.doc)
    expect(marked).toEqual(keys)
    expect(JSON.stringify(bank.record)).not.toContain('"key"')
  })
})

describe('sizing a picture from its page', () => {
  const asset = (width: number) => ({ id: `sha256:${'a'.repeat(64)}`, mimeType: 'image/png' as const, width, height: 100, bytes: '' })
  const crop = (width: number, pageShare: number) => ({ asset: asset(width), origin: { kind: 'crop', page: 1 } as const, pageShare })

  test('prints a picture about as wide as it was on its page', () => {
    // A third of a Letter page, cropped at 300 DPI: wider than the lane, so
    // its size is a share of the lane.
    expect(estimatedSize(crop(850, 1 / 3), { where: 'Question' })).toBe(0.4)
    // A small embedded image narrower than the lane is sized against itself.
    expect(estimatedSize(crop(400, 0.25), { where: 'Question' })).toBe(0.51)
  })

  test('leaves a picture that filled its page, an upload, and an answer at the size they fit', () => {
    expect(estimatedSize(crop(2400, 0.9), { where: 'Question' })).toBeUndefined()
    expect(estimatedSize({ asset: asset(900), origin: { kind: 'upload', name: 'a.png' } }, { where: 'Question' })).toBeUndefined()
    expect(estimatedSize(crop(850, 1 / 3), { where: 'Answer B' })).toBeUndefined()
  })

  test('an import writes the estimated size as the Authored Image Size', async () => {
    const found = await proposal()
    const occurrences = pendingImagesOf(found)
    const first = occurrences[0]!
    const resolution = resolutionOf(new Map([[first.key, crop(850, 1 / 3)]]), occurrences)
    const plan = planImport(found, initialSelection(found), (() => { let next = 0; return () => `id-${next++}` })(), resolution)
    expect(JSON.stringify(plan.banks[0]!.questions[0]!.doc)).toContain('"ratio":0.4}')
  })
})
