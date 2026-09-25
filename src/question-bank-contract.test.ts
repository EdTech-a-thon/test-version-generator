import { describe, expect, test } from 'bun:test'
import Ajv2020 from 'ajv/dist/2020'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import publicSchema010 from '../public/formats/question-bank/0.1.0/schema.json'
import applicationSchema010 from './question-bank-record-0.1.0.schema.json'
import publicSchema020 from '../public/formats/question-bank/0.2.0/schema.json'
import applicationSchema020 from './question-bank-record-0.2.0.schema.json'
import publicSchema030 from '../public/formats/question-bank/0.3.0/schema.json'
import applicationSchema030 from './question-bank-record-0.3.0.schema.json'
import publicSchema from '../public/formats/question-bank/0.4.0/schema.json'
import applicationSchema from './question-bank-record-0.4.0.schema.json'
import {
  QUESTION_BANK_FORMAT_VERSION,
  SUPPORTED_SEMANTIC_MARK_TYPES,
  SUPPORTED_SEMANTIC_NODE_TYPES,
  prepareQuestionBankExport,
  serializeQuestionBankRecord,
  type QuestionBankRecord,
} from './question-bank-export'
import {
  QuestionBankImportError,
  inspectQuestionBankRecord,
} from './question-bank-import'
import type { QuestionBankResource } from './question-bank-workspaces'

function fixtureRootFor(version: string): string {
  return join(import.meta.dir, '..', 'public', 'formats', 'question-bank', version)
}

const fixtureRoot = fixtureRootFor(QUESTION_BANK_FORMAT_VERSION)
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

describe('public Question Bank Record 0.4.0 contract', () => {
  test('canonical examples validate independently against the published schema', async () => {
    expect(publicSchema.$id).toBe(
      'https://testparrot.com/formats/question-bank/0.4.0/schema.json',
    )
    expect(
      await Bun.file(
        join(
          import.meta.dir,
          '..',
          'public',
          'question-bank-record-0.4.0.schema.json',
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
      'matching.json',
      'media-rich.json',
      'minimal-multiple-choice.json',
      'pending-images.json',
      'provenance-and-links.json',
      'short-answer.json',
      'true-false.json',
    ])
    for (const name of names) {
      expect(
        validate(await fixture(exampleRoot, name)),
        `${name}: ${JSON.stringify(validate.errors)}`,
      ).toBe(true)
    }
  })

  test('a True/False Question states its fixed pair and nothing else', async () => {
    const proposal = await inspectQuestionBankRecord(
      await Bun.file(join(exampleRoot, 'true-false.json')).bytes(),
    )

    expect(proposal.summary.questionCounts).toEqual({
      'multiple-choice': 0,
      'true-false': 2,
      matching: 0,
      'short-answer': 0,
    })
    expect(proposal.record.bank.questions[0]).toMatchObject({
      type: 'true-false',
      choices: [{ correct: true }, { correct: false }],
    })
    expect(proposal.record.bank.questions[0]!.suggestedAnswer).toBeUndefined()
  })

  test('a Matching Question names its answers from its own Word Bank, distractors and unmatched items included', async () => {
    const proposal = await inspectQuestionBankRecord(
      await Bun.file(join(exampleRoot, 'matching.json')).bytes(),
    )

    expect(proposal.summary.questionCounts).toEqual({
      'multiple-choice': 0,
      'true-false': 0,
      matching: 2,
      'short-answer': 0,
    })
    // The second set leaves an item unmatched; that is reported, not refused.
    expect(proposal.summary.questionsWithoutCorrectAnswer).toBe(1)
    const [events, terms] = proposal.record.bank.questions
    expect(events).toMatchObject({
      type: 'matching',
      prompts: [
        { id: 'q1-p1', answer: 'q1-a3' },
        { id: 'q1-p2', answer: 'q1-a1' },
        { id: 'q1-p3', answer: 'q1-a2' },
        { id: 'q1-p4', answer: 'q1-a4' },
      ],
    })
    expect(events!.wordBank!.map((answer) => answer.id)).toEqual([
      'q1-a1',
      'q1-a2',
      'q1-a3',
      'q1-a4',
    ])
    expect(events!.choices).toBeUndefined()
    expect(events!.suggestedAnswer).toBeUndefined()
    expect(terms!.prompts!.map((prompt) => prompt.answer)).toEqual(['q2-a2', undefined])
    expect(terms!.wordBank).toHaveLength(3)
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

  test('a Pending Image names a tag or a page, may be shared, and needs no Media Asset', async () => {
    const proposal = await inspectQuestionBankRecord(
      await Bun.file(join(exampleRoot, 'pending-images.json')).bytes(),
    )

    expect(proposal.summary).toMatchObject({ mediaAssets: 0, pendingImages: 6 })
    const [inStem, asChoices, shared, byPage] = proposal.record.bank.questions
    expect(inStem!.stem.content[1]).toEqual({
      type: 'block-image',
      pending: { image: 1 },
      alt: 'Map of European trading stations in Africa and Asia around 1750',
      caption: 'Major European Trading Stations c. 1750',
    })
    expect(asChoices!.choices!.map((choice) => choice.content.content[0]!.pending)).toEqual([
      { image: 2 },
      { image: 3 },
      { image: 4 },
    ])
    expect(shared!.stem.content[0]!.pending).toEqual({ image: 1 })
    expect(byPage!.stem.content[1]).toMatchObject({ pending: { page: 4 }, authoredSize: 0.6 })
  })

  test('a Pending Image in a record older than 0.4.0 is refused', async () => {
    const record = (await fixture(exampleRoot, 'pending-images.json')) as { formatVersion: string }
    record.formatVersion = '0.3.0'
    try {
      await inspectQuestionBankRecord(new TextEncoder().encode(JSON.stringify(record)))
      throw new Error('unexpectedly conformed')
    } catch (error) {
      expect((error as QuestionBankImportError).code).toBe('invalid-question')
    }
  })

  test('invalid counterexamples are rejected with their documented application errors', async () => {
    const manifest = (await fixture(invalidRoot, 'manifest.json')) as Record<
      string,
      string
    >
    expect(Object.keys(manifest).sort()).toEqual([
      'bad-reference.json',
      'invalid-media.json',
      'malformed-matching.json',
      'malformed-question.json',
      'malformed-true-false.json',
      'pending-empty.json',
      'pending-image-and-page.json',
      'pending-negative-page.json',
      'pending-unknown-member.json',
      'pending-with-asset.json',
      'pending-zero.json',
      'unsafe-url.json',
      'unsupported-required-feature.json',
      'unsupported-version.json',
    ])
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(publicSchema)
    for (const [name, code] of Object.entries(manifest)) {
      if (name.startsWith('pending-'))
        expect(validate(await fixture(invalidRoot, name)), name).toBe(false)
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
      'matchingPrompt',
      'matchingAnswer',
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

describe('retained Question Bank Record 0.3.0 contract', () => {
  const root030 = fixtureRootFor('0.3.0')

  test('the published 0.3.0 schema is unchanged and still checked in twice', async () => {
    expect(publicSchema030.$id).toBe(
      'https://testparrot.com/formats/question-bank/0.3.0/schema.json',
    )
    expect(publicSchema030.properties.formatVersion.const).toBe('0.3.0')
    expect(applicationSchema030).toEqual(publicSchema030)
    expect(
      await Bun.file(
        join(import.meta.dir, '..', 'public', 'question-bank-record-0.3.0.schema.json'),
      ).json(),
    ).toEqual(publicSchema030)
  })

  test('every 0.3.0 canonical example still imports, migrated to the current version', async () => {
    const names = await filesIn(join(root030, 'examples'))

    expect(names).toEqual([
      'complete-rich-text.json',
      'matching.json',
      'media-rich.json',
      'minimal-multiple-choice.json',
      'provenance-and-links.json',
      'short-answer.json',
      'true-false.json',
    ])
    for (const name of names) {
      const proposal = await inspectQuestionBankRecord(
        await Bun.file(join(root030, 'examples', name)).bytes(),
      )
      expect(proposal.record.formatVersion, name).toBe(QUESTION_BANK_FORMAT_VERSION)
      expect(proposal.summary.formatVersion, name).toBe('0.3.0')
    }
  })

  test('0.3.0 counterexamples are still rejected with their documented errors', async () => {
    const manifest = (await fixture(join(root030, 'invalid'), 'manifest.json')) as Record<
      string,
      string
    >

    for (const [name, code] of Object.entries(manifest)) {
      try {
        await inspectQuestionBankRecord(await Bun.file(join(root030, 'invalid', name)).bytes())
        throw new Error(`${name} unexpectedly conformed`)
      } catch (error) {
        expect(error, name).toBeInstanceOf(QuestionBankImportError)
        expect((error as QuestionBankImportError).code, name).toBe(code)
      }
    }
  })
})

// 0.1.0 and 0.2.0 are retired as producer versions and retained as consumer
// ones: every Question Bank File a teacher has already shared must still open.
// Their published contracts are therefore frozen — these are the assertions
// that keep them that way.
describe('retained Question Bank Record 0.2.0 contract', () => {
  const root020 = fixtureRootFor('0.2.0')

  test('the published 0.2.0 schema is unchanged and still checked in twice', async () => {
    expect(publicSchema020.$id).toBe(
      'https://testparrot.com/formats/question-bank/0.2.0/schema.json',
    )
    expect(publicSchema020.properties.formatVersion.const).toBe('0.2.0')
    expect(applicationSchema020).toEqual(publicSchema020)
    expect(
      await Bun.file(
        join(
          import.meta.dir,
          '..',
          'public',
          'question-bank-record-0.2.0.schema.json',
        ),
      ).json(),
    ).toEqual(publicSchema020)
  })

  test('every 0.2.0 canonical example still imports, migrated to the current version', async () => {
    const names = await filesIn(join(root020, 'examples'))

    expect(names).toEqual([
      'complete-rich-text.json',
      'media-rich.json',
      'minimal-multiple-choice.json',
      'provenance-and-links.json',
      'short-answer.json',
      'true-false.json',
    ])
    for (const name of names) {
      const proposal = await inspectQuestionBankRecord(
        await Bun.file(join(root020, 'examples', name)).bytes(),
      )
      expect(proposal.record.formatVersion, name).toBe(
        QUESTION_BANK_FORMAT_VERSION,
      )
      expect(proposal.summary.formatVersion, name).toBe('0.2.0')
    }
  })

  test('0.2.0 counterexamples are still rejected with their documented errors', async () => {
    const manifest = (await fixture(
      join(root020, 'invalid'),
      'manifest.json',
    )) as Record<string, string>

    for (const [name, code] of Object.entries(manifest)) {
      try {
        await inspectQuestionBankRecord(
          await Bun.file(join(root020, 'invalid', name)).bytes(),
        )
        throw new Error(`${name} unexpectedly conformed`)
      } catch (error) {
        expect(error, name).toBeInstanceOf(QuestionBankImportError)
        expect((error as QuestionBankImportError).code, name).toBe(code)
      }
    }
  })
})

describe('retained Question Bank Record 0.1.0 contract', () => {
  const root010 = fixtureRootFor('0.1.0')

  test('the published 0.1.0 schema is unchanged and still checked in twice', async () => {
    expect(publicSchema010.$id).toBe(
      'https://testparrot.com/formats/question-bank/0.1.0/schema.json',
    )
    expect(publicSchema010.properties.formatVersion.const).toBe('0.1.0')
    expect(applicationSchema010).toEqual(publicSchema010)
    expect(
      await Bun.file(
        join(
          import.meta.dir,
          '..',
          'public',
          'question-bank-record-0.1.0.schema.json',
        ),
      ).json(),
    ).toEqual(publicSchema010)
  })

  test('each retained version knows only the Question Types of its day', () => {
    const typeEnum = (
      schema:
        | typeof publicSchema010
        | typeof publicSchema020
        | typeof publicSchema030
        | typeof publicSchema,
    ) =>
      (schema as {
        $defs: { question: { properties: { type: { enum: string[] } } } }
      }).$defs.question.properties.type.enum

    expect(typeEnum(publicSchema010)).toEqual([
      'multiple-choice',
      'short-answer',
    ])
    expect(typeEnum(publicSchema020)).toEqual([
      'multiple-choice',
      'true-false',
      'short-answer',
    ])
    expect(typeEnum(publicSchema)).toEqual([
      'multiple-choice',
      'true-false',
      'matching',
      'short-answer',
    ])
  })

  test('every 0.1.0 canonical example still imports, migrated to the current version', async () => {
    const names = await filesIn(join(root010, 'examples'))

    expect(names).toEqual([
      'complete-rich-text.json',
      'media-rich.json',
      'minimal-multiple-choice.json',
      'provenance-and-links.json',
      'short-answer.json',
    ])
    for (const name of names) {
      const proposal = await inspectQuestionBankRecord(
        await Bun.file(join(root010, 'examples', name)).bytes(),
      )
      expect(proposal.record.formatVersion, name).toBe(
        QUESTION_BANK_FORMAT_VERSION,
      )
      // What the teacher opened, not what the app rewrote it to.
      expect(proposal.summary.formatVersion, name).toBe('0.1.0')
    }
  })

  test('0.1.0 counterexamples are still rejected with their documented errors', async () => {
    const manifest = (await fixture(
      join(root010, 'invalid'),
      'manifest.json',
    )) as Record<string, string>

    for (const [name, code] of Object.entries(manifest)) {
      try {
        await inspectQuestionBankRecord(
          await Bun.file(join(root010, 'invalid', name)).bytes(),
        )
        throw new Error(`${name} unexpectedly conformed`)
      } catch (error) {
        expect(error, name).toBeInstanceOf(QuestionBankImportError)
        expect((error as QuestionBankImportError).code, name).toBe(code)
      }
    }
  })
})
