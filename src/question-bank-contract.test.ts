import { describe, expect, test } from 'bun:test'
import Ajv2020 from 'ajv/dist/2020'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import publicSchema from '../public/formats/question-bank/0.1.0/schema.json'
import applicationSchema from './question-bank-record-0.1.0.schema.json'
import {
  SUPPORTED_SEMANTIC_MARK_TYPES,
  SUPPORTED_SEMANTIC_NODE_TYPES,
  canonicalizeJson,
  prepareQuestionBankExport,
  serializeQuestionBankRecord,
  type QuestionBankRecord,
} from './question-bank-export'
import {
  QuestionBankImportError,
  inspectQuestionBankRecord,
} from './question-bank-import'
import type { QuestionBankResource } from './question-bank-workspaces'

const fixtureRoot = join(
  import.meta.dir,
  '..',
  'public',
  'formats',
  'question-bank',
  '0.1.0',
)
const exampleRoot = join(fixtureRoot, 'examples')
const invalidRoot = join(fixtureRoot, 'invalid')
const decoder = new TextDecoder()

async function filesIn(directory: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((name) => name.endsWith('.json'))
    .sort()
}

async function fixture(directory: string, name: string): Promise<unknown> {
  return JSON.parse(await Bun.file(join(directory, name)).text())
}

function schemaEnum(definition: 'node' | 'mark', property: string): string[] {
  const schema = publicSchema as {
    $defs: Record<string, { properties: Record<string, { enum: string[] }> }>
  }
  return schema.$defs[definition]!.properties[property]!.enum
}

describe('public Question Bank Record 0.1.0 contract', () => {
  test('canonical examples validate independently against the published schema', async () => {
    expect(publicSchema.$id).toBe(
      'https://testparrot.com/formats/question-bank/0.1.0/schema.json',
    )
    expect(
      await Bun.file(
        join(
          import.meta.dir,
          '..',
          'public',
          'question-bank-record-0.1.0.schema.json',
        ),
      ).json(),
    ).toEqual(publicSchema)
    expect(applicationSchema).toEqual(publicSchema)
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
      publicSchema,
    )
    const names = await filesIn(exampleRoot)

    expect(names).toEqual([
      'complete-rich-text.json',
      'media-rich.json',
      'minimal-multiple-choice.json',
      'provenance-and-links.json',
      'short-answer.json',
    ])
    for (const name of names) {
      expect(
        validate(await fixture(exampleRoot, name)),
        `${name}: ${JSON.stringify(validate.errors)}`,
      ).toBe(true)
    }
  })

  test('canonical examples pass Test Parrot inspection and retain documented semantics', async () => {
    const proposals = await Promise.all(
      (await filesIn(exampleRoot)).map(
        async (name) =>
          [
            name,
            await inspectQuestionBankRecord(
              await Bun.file(join(exampleRoot, name)).bytes(),
            ),
          ] as const,
      ),
    )
    const byName = Object.fromEntries(
      proposals.map(([name, proposal]) => [
        name.replace(/\.json$/, ''),
        proposal,
      ]),
    )

    expect(
      byName['minimal-multiple-choice'].record.bank.questions[0],
    ).toMatchObject({
      type: 'multiple-choice',
      choices: [{ correct: false }, { correct: true }],
    })
    expect(byName['short-answer'].record.bank.questions[0]).toMatchObject({
      type: 'short-answer',
      suggestedAnswer: { type: 'document' },
    })
    expect(JSON.stringify(byName['complete-rich-text'].record)).toContain(
      'display-math',
    )
    expect(byName['provenance-and-links'].record.bank).toMatchObject({
      description: 'A bank published to demonstrate declared provenance.',
      author: 'Ada Teacher',
      license: {
        name: 'CC BY 4.0',
        url: 'https://creativecommons.org/licenses/by/4.0/',
      },
    })
    expect(byName['provenance-and-links'].summary.externalLinks).toBe(true)
    expect(byName['media-rich'].summary).toMatchObject({
      mediaAssets: 1,
      decodedMediaBytes: 70,
    })
    expect(
      byName['media-rich'].record.bank.questions[0]!.stem.content,
    ).toContainEqual(
      expect.objectContaining({ type: 'block-image', authoredSize: 0.5 }),
    )
  })

  test('invalid counterexamples are rejected with their documented application errors', async () => {
    const manifest = (await fixture(invalidRoot, 'manifest.json')) as Record<
      string,
      string
    >
    expect(Object.keys(manifest).sort()).toEqual([
      'bad-integrity.json',
      'bad-reference.json',
      'invalid-media.json',
      'malformed-question.json',
      'unsafe-url.json',
      'unsupported-required-feature.json',
      'unsupported-version.json',
    ])
    for (const [name, code] of Object.entries(manifest)) {
      try {
        await inspectQuestionBankRecord(
          await Bun.file(join(invalidRoot, name)).bytes(),
        )
        throw new Error(`${name} unexpectedly conformed`)
      } catch (error) {
        expect(error, name).toBeInstanceOf(QuestionBankImportError)
        expect((error as QuestionBankImportError).code, name).toBe(code)
      }
    }
  })

  test('public records round-trip semantically while unknown fields and source bytes may change', async () => {
    const sourceBytes = await Bun.file(
      join(exampleRoot, 'provenance-and-links.json'),
    ).bytes()
    const imported = await inspectQuestionBankRecord(sourceBytes)
    const reexported = await serializeQuestionBankRecord({
      requiredFeatures: imported.record.requiredFeatures,
      bank: imported.record.bank,
      media: imported.record.media,
    })
    const inspectedAgain = await inspectQuestionBankRecord(reexported.bytes)

    expect(inspectedAgain.record.bank).toEqual(imported.record.bank)
    expect(inspectedAgain.record.media).toEqual(imported.record.media)
    expect(JSON.stringify(inspectedAgain.record)).not.toContain('publisherNote')
    expect(reexported.record.generator.name).toBe('Test Parrot')
    expect(reexported.bytes).not.toEqual(sourceBytes)
  })

  test('schema vocabulary, application adapters, and complete example stay aligned', async () => {
    expect([...SUPPORTED_SEMANTIC_NODE_TYPES].sort()).toEqual(
      schemaEnum('node', 'type').sort(),
    )
    expect([...SUPPORTED_SEMANTIC_MARK_TYPES].sort()).toEqual(
      schemaEnum('mark', 'type').sort(),
    )

    const complete = (await fixture(
      exampleRoot,
      'complete-rich-text.json',
    )) as QuestionBankRecord
    const encoded = JSON.stringify(complete)
    for (const type of SUPPORTED_SEMANTIC_NODE_TYPES)
      expect(encoded).toContain(`"type":"${type}"`)
    for (const type of SUPPORTED_SEMANTIC_MARK_TYPES)
      expect(encoded).toContain(`"type":"${type}"`)

    const schemaText = JSON.stringify(publicSchema)
    for (const privateTerm of [
      'IndexedDB',
      '/local-images/',
      'ProseMirror',
      'multipleChoiceChoice',
      'Exam Layout Plan',
      'Working Copy',
    ])
      expect(schemaText).not.toContain(privateTerm)
  })

  test('Test Parrot generated records validate against the public schema', async () => {
    const validate = new Ajv2020({ strict: true }).compile(publicSchema)
    const bank: QuestionBankResource = {
      id: 'local-bank',
      name: 'Generated example',
      createdAt: 'not-public',
      lastUpdatedAt: 'not-public',
      questions: [
        {
          id: 'local-question',
          type: 'open',
          columns: 4,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Explain.' }],
              },
            ],
          },
        },
      ],
    }
    const prepared = await prepareQuestionBankExport(bank)

    expect(
      validate(JSON.parse(decoder.decode(prepared.recordBytes))),
      JSON.stringify(validate.errors),
    ).toBe(true)
  })
})

describe('external RFC 8785 and SHA-256 conformance vectors', () => {
  test('matches the upstream JCS values vector byte for byte', async () => {
    const input = await fixture(
      join(fixtureRoot, 'conformance'),
      'rfc8785-values-input.json',
    )
    const expected = await Bun.file(
      join(fixtureRoot, 'conformance', 'rfc8785-values-canonical.json'),
    ).text()
    expect(canonicalizeJson(input)).toBe(expected)
  })

  test('matches the fixed SHA-256 digest of the upstream canonical bytes', async () => {
    const bytes = await Bun.file(
      join(fixtureRoot, 'conformance', 'rfc8785-values-canonical.json'),
    ).bytes()
    const digest = Buffer.from(
      await crypto.subtle.digest('SHA-256', bytes),
    ).toString('hex')
    expect(digest).toBe(
      '2d5e01a318d0f0879ab568c4be289c8b1f64ef8921a53c6277d5e069978baacb',
    )
  })
})
