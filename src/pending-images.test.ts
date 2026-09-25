import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { inspectImportRecord } from './package-import'
import { checkAgainstSourceDocument } from './pending-images'

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
