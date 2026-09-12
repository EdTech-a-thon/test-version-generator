import { describe, expect, test } from 'bun:test'
import { PDFDocument } from 'pdf-lib'
import { PIXEL_PNG } from './export-fixtures'
import {
  QUESTION_BANK_ATTACHMENT_DESCRIPTION,
  QUESTION_BANK_ATTACHMENT_NAME,
  QUESTION_BANK_FORMAT,
  type QuestionBankRecord,
} from './question-bank-export'
import {
  DEFAULT_QUESTION_BANK_IMPORT_LIMITS,
  QuestionBankImportError,
  SUPPORTED_QUESTION_BANK_VERSIONS,
  importedQuestionsFromRecord,
  inspectQuestionBankFile,
  inspectQuestionBankRecord,
  type QuestionBankImportLimits,
} from './question-bank-import'

const encoder = new TextEncoder()

const paragraph = (value = 'Question') => ({
  type: 'document' as const,
  content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }],
})

function baseRecord(): QuestionBankRecord {
  return {
    format: QUESTION_BANK_FORMAT,
    formatVersion: '0.1.0',
    generator: { name: 'Independent Generator', version: '9.4.2' },
    requiredFeatures: [],
    bank: {
      name: 'Portable chemistry',
      questions: [
        {
          id: 'q1',
          type: 'multiple-choice',
          stem: paragraph('Which particle is neutral?'),
          difficulty: 'easy',
          topics: ['Atoms'],
          choices: [
            { id: 'q1-c1', content: paragraph('Proton'), correct: false },
            { id: 'q1-c2', content: paragraph('Neutron'), correct: true },
          ],
        },
      ],
    },
    media: [],
  }
}

function bytesOf(record: QuestionBankRecord & Record<string, unknown>) {
  return encoder.encode(JSON.stringify(record))
}

async function pdfWith(...attachments: { name: string; description: string; bytes: Uint8Array }[]) {
  const pdf = await PDFDocument.create()
  pdf.addPage()
  for (const attachment of attachments) {
    await pdf.attach(attachment.bytes, attachment.name, {
      description: attachment.description,
      mimeType: 'application/json',
    })
  }
  return pdf.save({ useObjectStreams: false })
}

function limits(overrides: Partial<QuestionBankImportLimits>): QuestionBankImportLimits {
  return { ...DEFAULT_QUESTION_BANK_IMPORT_LIMITS, ...overrides }
}

async function rejected(
  operation: Promise<unknown>,
  code: QuestionBankImportError['code'],
  text: string,
) {
  try {
    await operation
    throw new Error('Expected inspection to reject')
  } catch (error) {
    expect(error).toBeInstanceOf(QuestionBankImportError)
    expect((error as QuestionBankImportError).code).toBe(code)
    expect((error as Error).message).toContain(text)
  }
}

describe('Question Bank import mapping', () => {
  test('creates fresh local Question and choice identities while preserving content', async () => {
    const record = baseRecord()
    record.bank.questions[0]!.stem.content.push({
      type: 'block-image',
      asset: `sha256:${'a'.repeat(64)}`,
      alt: 'Atom model',
      authoredSize: 0.5,
    })
    const ids = ['local-question', 'local-choice-a', 'local-choice-b']
    const imported = importedQuestionsFromRecord(record, () => ids.shift()!)

    expect(imported).toHaveLength(1)
    expect(imported[0]).toMatchObject({
      id: 'local-question',
      type: 'multiple-choice',
      difficulty: 'easy',
      topics: ['Atoms'],
    })
    expect(JSON.stringify(imported)).not.toContain('q1')
    expect(JSON.stringify(imported)).toContain('Which particle is neutral?')
    expect(JSON.stringify(imported)).toContain('/local-images/')
    const choiceList = (imported[0]!.doc.content as Record<string, unknown>[]).find(
      (node) => node.type === 'multipleChoice',
    )!
    const choices = choiceList.content as Record<string, unknown>[]
    expect(choices.map((choice) => (choice.attrs as Record<string, unknown>).id)).toEqual([
      'local-choice-a',
      'local-choice-b',
    ])
  })
})

describe('hostile Question Bank File inspection', () => {
  test('publishes exact compatibility and production resource limits', () => {
    expect(Object.keys(SUPPORTED_QUESTION_BANK_VERSIONS)).toEqual(['0.1.0'])
    expect(DEFAULT_QUESTION_BANK_IMPORT_LIMITS).toEqual({
      pdfBytes: 100 * 1024 * 1024,
      recordBytes: 75 * 1024 * 1024,
      questions: 10_000,
      mediaAssets: 2_000,
      mediaAssetBytes: 25 * 1024 * 1024,
      totalMediaBytes: 75 * 1024 * 1024,
      questionNodes: 25_000,
      richTextDepth: 50,
      imageWidth: 20_000,
      imageHeight: 20_000,
    })
  })

  test('accepts an exact supported version from another generator and discards unknown optional fields', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    source.futureEnvelopeNote = 'ignore me'
    ;(source.bank as Record<string, unknown>).futureBankNote = { opaque: true }
    ;(source.bank.questions[0] as unknown as Record<string, unknown>).futureQuestionNote = 42
    const proposal = await inspectQuestionBankRecord(bytesOf(source))

    expect(proposal.summary).toMatchObject({
      bankName: 'Portable chemistry',
      questionCounts: { 'multiple-choice': 1, 'short-answer': 0 },
      formatVersion: '0.1.0',
    })
    expect(proposal.record.generator.name).toBe('Independent Generator')
    expect(JSON.stringify(proposal.record)).not.toContain('future')
  })

  test('reports the file version and exact supported versions before semantic validation', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    source.formatVersion = '0.2.0'
    source.requiredFeatures = ['also-unknown']
    await rejected(
      inspectQuestionBankRecord(bytesOf(source)),
      'unsupported-version',
      '0.2.0',
    )
    await rejected(
      inspectQuestionBankRecord(bytesOf(source)),
      'unsupported-version',
      '0.1.0',
    )
  })

  test('structural schema validation precedes semantic validation', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    delete (source.bank.questions[0] as unknown as { stem?: unknown }).stem
    source.requiredFeatures = ['unknown-feature']
    await rejected(
      inspectQuestionBankRecord(bytesOf(source)),
      'invalid-structure',
      'schema',
    )
  })

  test.each([
    ['required feature', (record: QuestionBankRecord) => { record.requiredFeatures = ['future-meaning'] }, 'unsupported-feature'],
    ['Question Type', (record: QuestionBankRecord) => { (record.bank.questions[0] as { type: string }).type = 'essay' }, 'invalid-structure'],
    ['rich-text node', (record: QuestionBankRecord) => { record.bank.questions[0]!.stem.content[0]!.type = 'video' }, 'invalid-structure'],
    ['mark', (record: QuestionBankRecord) => { record.bank.questions[0]!.stem.content[0] = { type: 'text', text: 'x', marks: [{ type: 'blink' } as never] } }, 'invalid-structure'],
    ['semantic enum', (record: QuestionBankRecord) => { (record.bank.questions[0] as { difficulty?: string }).difficulty = 'impossible' }, 'invalid-structure'],
  ] as const)('rejects an unknown %s for the whole record', async (_label, mutate, code) => {
    const source = baseRecord()
    mutate(source)
    await rejected(
      inspectQuestionBankRecord(bytesOf(source as QuestionBankRecord & Record<string, unknown>)),
      code,
      code === 'unsupported-feature' ? 'future-meaning' : 'schema',
    )
  })

  test('validates package IDs, references, cardinality, and links', async () => {
    const duplicate = baseRecord()
    duplicate.bank.questions.push(structuredClone(duplicate.bank.questions[0]!))
    await rejected(inspectQuestionBankRecord(bytesOf(duplicate as QuestionBankRecord & Record<string, unknown>)), 'duplicate-id', 'q1')

    const cardinality = baseRecord()
    cardinality.bank.questions[0]!.choices![0]!.correct = true
    await rejected(inspectQuestionBankRecord(bytesOf(cardinality as QuestionBankRecord & Record<string, unknown>)), 'invalid-question', 'one correct')

    const wrongContent = baseRecord()
    wrongContent.bank.questions[0]!.suggestedAnswer = paragraph('Not allowed')
    await rejected(inspectQuestionBankRecord(bytesOf(wrongContent as QuestionBankRecord & Record<string, unknown>)), 'invalid-question', 'Suggested Answer')

    const unsafe = baseRecord()
    unsafe.bank.questions[0]!.stem.content[0] = {
      type: 'text', text: 'click', marks: [{ type: 'link', href: 'javascript:alert(1)' }],
    }
    await rejected(inspectQuestionBankRecord(bytesOf(unsafe as QuestionBankRecord & Record<string, unknown>)), 'unsafe-url', 'HTTP or HTTPS')
  })

  test('checks PDF and decoded record byte boundaries before parsing', async () => {
    const recordBytes = bytesOf(baseRecord() as QuestionBankRecord & Record<string, unknown>)
    const pdf = await pdfWith({ name: QUESTION_BANK_ATTACHMENT_NAME, description: QUESTION_BANK_ATTACHMENT_DESCRIPTION, bytes: recordBytes })

    await expect(inspectQuestionBankFile(pdf, { limits: limits({ pdfBytes: pdf.byteLength, recordBytes: recordBytes.byteLength }) })).resolves.toBeDefined()
    await rejected(inspectQuestionBankFile(pdf, { limits: limits({ pdfBytes: pdf.byteLength - 1 }) }), 'pdf-size-limit', `${pdf.byteLength - 1}`)
    await rejected(inspectQuestionBankFile(pdf, { limits: limits({ recordBytes: recordBytes.byteLength - 1 }) }), 'record-size-limit', `${recordBytes.byteLength - 1}`)
  })

  test('rejects malformed PDFs, missing records, ambiguous records, and malformed JSON distinctly', async () => {
    await rejected(inspectQuestionBankFile(encoder.encode('not a PDF')), 'invalid-pdf', 'valid PDF')
    await rejected(inspectQuestionBankFile(await pdfWith()), 'missing-attachment', 'preview-only')
    const good = bytesOf(baseRecord() as QuestionBankRecord & Record<string, unknown>)
    await rejected(inspectQuestionBankFile(await pdfWith(
      { name: 'one.json', description: QUESTION_BANK_ATTACHMENT_DESCRIPTION, bytes: good },
      { name: 'two.json', description: QUESTION_BANK_ATTACHMENT_DESCRIPTION, bytes: good },
    )), 'ambiguous-attachments', 'several')
    await rejected(inspectQuestionBankFile(await pdfWith(
      { name: QUESTION_BANK_ATTACHMENT_NAME, description: QUESTION_BANK_ATTACHMENT_DESCRIPTION, bytes: encoder.encode('{') },
    )), 'invalid-json', 'JSON')
  })

  test('checks media count at and immediately over the configured limit before decoding', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    source.media = []
    await expect(
      inspectQuestionBankRecord(bytesOf(source), { limits: limits({ mediaAssets: 0 }) }),
    ).resolves.toBeDefined()
    source.media = [{ id: `sha256:${'0'.repeat(64)}`, mimeType: 'image/png', width: 1, height: 1, bytes: '' }]
    await rejected(
      inspectQuestionBankRecord(bytesOf(source), { limits: limits({ mediaAssets: 0 }) }),
      'media-count-limit',
      '0',
    )
  })

  test('checks declared image dimensions before base64 allocation', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    source.media = [{ id: `sha256:${'0'.repeat(64)}`, mimeType: 'image/png', width: 20_001, height: 1, bytes: '' }]
    await rejected(
      inspectQuestionBankRecord(bytesOf(source), { limits: limits({ imageWidth: 20_000 }) }),
      'image-dimension-limit',
      '20000 by 20000',
    )
    source.media = [{ id: `sha256:${'0'.repeat(64)}`, mimeType: 'image/png', width: 1, height: 20_001, bytes: '' }]
    await rejected(
      inspectQuestionBankRecord(bytesOf(source), { limits: limits({ imageHeight: 20_000 }) }),
      'image-dimension-limit',
      '20000 by 20000',
    )
  })

  test('checks declared and total decoded media sizes from base64 length before allocation', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    source.media = [{ id: `sha256:${'0'.repeat(64)}`, mimeType: 'image/png', width: 1, height: 1, bytes: 'AAAA' }]
    await rejected(
      inspectQuestionBankRecord(bytesOf(source), { limits: limits({ mediaAssetBytes: 2 }) }),
      'media-asset-size-limit',
      '2',
    )
    await rejected(
      inspectQuestionBankRecord(bytesOf(source), { limits: limits({ totalMediaBytes: 2 }) }),
      'total-media-size-limit',
      '2',
    )
  })

  test('accepts decoded media exactly at byte and dimension limits', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', PIXEL_PNG.data)),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('')
    const id = `sha256:${digest}`
    source.media = [{
      id,
      mimeType: 'image/png',
      width: 1,
      height: 1,
      bytes: Buffer.from(PIXEL_PNG.data).toString('base64'),
    }]
    ;(source.bank.questions[0]!.stem.content as unknown[]) = [{ type: 'block-image', asset: id }]
    await expect(inspectQuestionBankRecord(bytesOf(source), {
      limits: limits({
        mediaAssetBytes: PIXEL_PNG.data.byteLength,
        totalMediaBytes: PIXEL_PNG.data.byteLength,
        imageWidth: 1,
        imageHeight: 1,
      }),
    })).resolves.toMatchObject({ summary: { mediaAssets: 1, decodedMediaBytes: PIXEL_PNG.data.byteLength } })
  })

  test('rejects malformed base64 without decoding it', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    source.media = [{ id: `sha256:${'0'.repeat(64)}`, mimeType: 'image/png', width: 1, height: 1, bytes: '!!!!' }]
    await rejected(inspectQuestionBankRecord(bytesOf(source)), 'invalid-media', 'malformed base64')
  })

  test('checks Question count, semantic node count, and nesting exactly at and immediately over each configured limit', async () => {
    const source = baseRecord()
    source.bank.questions.push({ id: 'q2', type: 'short-answer', stem: paragraph('Second') })
    await expect(inspectQuestionBankRecord(bytesOf(source as QuestionBankRecord & Record<string, unknown>), { limits: limits({ questions: 2 }) })).resolves.toBeDefined()
    await rejected(inspectQuestionBankRecord(bytesOf(source as QuestionBankRecord & Record<string, unknown>), { limits: limits({ questions: 1 }) }), 'question-count-limit', '1')

    const nodes = baseRecord()
    nodes.bank.questions[0]!.stem = { type: 'document', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] }] }
    await expect(inspectQuestionBankRecord(bytesOf(nodes as QuestionBankRecord & Record<string, unknown>), { limits: limits({ questionNodes: 7 }) })).resolves.toBeDefined()
    await rejected(inspectQuestionBankRecord(bytesOf(nodes as QuestionBankRecord & Record<string, unknown>), { limits: limits({ questionNodes: 6 }) }), 'question-node-limit', '6')

    const nested = baseRecord()
    nested.bank.questions[0]!.stem = { type: 'document', content: [{ type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'deep' }] }] }] }
    await expect(inspectQuestionBankRecord(bytesOf(nested as QuestionBankRecord & Record<string, unknown>), { limits: limits({ richTextDepth: 3 }) })).resolves.toBeDefined()
    await rejected(inspectQuestionBankRecord(bytesOf(nested as QuestionBankRecord & Record<string, unknown>), { limits: limits({ richTextDepth: 2 }) }), 'rich-text-depth-limit', '2')
  })
})
