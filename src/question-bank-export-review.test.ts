import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  canonicalizeJson,
  prepareQuestionBankExport,
} from './question-bank-export'

// Independent fixed vector: the expected digest is produced by Node's crypto
// implementation, while production uses WebCrypto.
test('record integrity is SHA-256 of canonical JSON with digest omitted', async () => {
  const bank = {
    id: 'private-bank-id',
    name: 'Known',
    createdAt: 'private-created-at',
    lastUpdatedAt: 'private-updated-at',
    questions: [
      {
        id: 'private-question-id',
        type: 'open' as const,
        columns: 4 as const,
        doc: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
          ],
        },
      },
    ],
  }
  const { record } = await prepareQuestionBankExport(bank)
  const digestless = structuredClone(record) as Record<string, unknown>
  delete (digestless.integrity as Record<string, unknown>).digest
  const expected = createHash('sha256')
    .update(canonicalizeJson(digestless))
    .digest('hex')

  expect(record.integrity.digest).toBe(expected)
  expect(expected).toBe(
    '7e838efa679093d81eef8488cdc9d33c33e75d0b04edafd27989bbe04d7f66e4',
  )
})
