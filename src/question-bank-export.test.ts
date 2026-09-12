import { describe, expect, test } from 'bun:test'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { Question } from './exam'
import { mark, paragraph, text } from './export-fixtures'
import type { QuestionBankResource } from './question-bank-workspaces'
import {
  QUESTION_BANK_FORMAT,
  QUESTION_BANK_FORMAT_VERSION,
  prepareQuestionBankExport,
  questionBankFilename,
  type QuestionBankRecord,
} from './question-bank-export'
import {
  createQuestionBankPdf,
  type QuestionBankPdfFontLoader,
} from './question-bank-pdf'

const fontFiles = {
  regular: '/usr/share/fonts/truetype/freefont/FreeSerif.ttf',
  bold: '/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf',
  italic: '/usr/share/fonts/truetype/freefont/FreeSerifItalic.ttf',
  boldItalic: '/usr/share/fonts/truetype/freefont/FreeSerifBoldItalic.ttf',
  mono: '/usr/share/fonts/truetype/freefont/FreeMono.ttf',
} as const
const fonts: QuestionBankPdfFontLoader = async (style) =>
  Bun.file(fontFiles[style]).arrayBuffer()

function choice(id: string, correct: boolean, value: string) {
  return {
    type: 'multipleChoiceChoice',
    attrs: { id, correct },
    content: [paragraph(text(value))],
  }
}

function bank(questions: Question[]): QuestionBankResource {
  return {
    id: 'local-bank-id',
    name: 'Chemistry / Review',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastUpdatedAt: '2026-02-01T00:00:00.000Z',
    questions,
  }
}

const shortAnswer: Question = {
  id: 'local-short-answer-id',
  type: 'open',
  columns: 4,
  difficulty: 'hard',
  topics: ['Matter', 'Lab'],
  doc: {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [text('Evidence')] },
      { type: 'blockquote', content: [paragraph(text('Observe carefully.'))] },
      {
        type: 'bullet_list',
        content: [
          { type: 'list_item', content: [paragraph(text('Record mass.'))] },
        ],
      },
      {
        type: 'ordered_list',
        attrs: { order: 3 },
        content: [
          { type: 'list_item', content: [paragraph(text('Explain change.'))] },
        ],
      },
      {
        type: 'code_block',
        attrs: { language: 'python' },
        content: [text('mass = before - after')],
      },
      { type: 'hr' },
      {
        type: 'table',
        content: [
          {
            type: 'table_header_row',
            content: [
              { type: 'table_header', content: [paragraph(text('Trial'))] },
            ],
          },
          {
            type: 'table_row',
            content: [
              { type: 'table_cell', content: [paragraph(text('One'))] },
            ],
          },
        ],
      },
      paragraph(
        text('Use ', mark('strong')),
        text('the notes', mark('link', { href: 'https://example.test/notes' })),
        text(' with emphasis', mark('emphasis')),
        text(' code', mark('inlineCode')),
        text(' strike', mark('strike_through')),
        text(' H'),
        text('2', mark('subscript')),
        text(' and x'),
        text('2', mark('superscript')),
        { type: 'hardbreak' },
        { type: 'math_inline', attrs: { value: 'E = mc^2' } },
      ),
      {
        type: 'code_block',
        attrs: { language: 'latex' },
        content: [text('x^2 + y^2')],
      },
    ],
  },
  suggestedAnswer: {
    type: 'doc',
    content: [paragraph(text('Mass is conserved.', mark('emphasis')))],
  },
}

const multipleChoice: Question = {
  id: 'local-multiple-choice-id',
  type: 'multiple-choice',
  columns: 1,
  difficulty: 'easy',
  topics: ['Atoms'],
  doc: {
    type: 'doc',
    content: [
      paragraph(text('Which particle has no charge?')),
      {
        type: 'multipleChoice',
        content: [
          choice('local-choice-a', false, 'Proton'),
          choice('local-choice-b', true, 'Neutron'),
          choice('local-choice-c', false, 'Electron'),
        ],
      },
    ],
  },
}

describe('Question Bank exchange export seam', () => {
  test('builds the authoritative 0.1.0 semantic record in canonical stored order', async () => {
    const prepared = await prepareQuestionBankExport(
      bank([shortAnswer, multipleChoice]),
    )
    const parsed = JSON.parse(
      new TextDecoder().decode(prepared.recordBytes),
    ) as QuestionBankRecord

    expect(parsed).toEqual(prepared.record)
    expect(parsed.format).toBe(QUESTION_BANK_FORMAT)
    expect(parsed.formatVersion).toBe(QUESTION_BANK_FORMAT_VERSION)
    expect(parsed.bank.questions.map((question) => question.id)).toEqual([
      'q1',
      'q2',
    ])
    expect(parsed.bank.questions.map((question) => question.type)).toEqual([
      'short-answer',
      'multiple-choice',
    ])
    expect(parsed.bank.questions[0]).toMatchObject({
      difficulty: 'hard',
      topics: ['Matter', 'Lab'],
      suggestedAnswer: {
        type: 'document',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Mass is conserved.' }],
          },
        ],
      },
    })
    expect(parsed.bank.questions[1]).toMatchObject({
      difficulty: 'easy',
      topics: ['Atoms'],
      choices: [
        { id: 'q2-c1', correct: false },
        { id: 'q2-c2', correct: true },
        { id: 'q2-c3', correct: false },
      ],
    })
    expect(JSON.stringify(parsed)).not.toContain('local-')
    expect(JSON.stringify(parsed)).not.toContain('columns')
    expect(JSON.stringify(parsed)).not.toContain('createdAt')
    expect(JSON.stringify(parsed)).not.toContain('multipleChoiceChoice')
    expect(parsed.media).toEqual([])
  })

  test('exports only explicitly stored provenance', async () => {
    const source = {
      ...bank([shortAnswer]),
      description: 'Semester review',
      author: 'Ada Teacher',
      license: { name: 'CC BY', url: 'https://example.test/license' },
    }
    const { record } = await prepareQuestionBankExport(source)
    expect(record.bank).toMatchObject({
      description: 'Semester review',
      author: 'Ada Teacher',
      license: { name: 'CC BY', url: 'https://example.test/license' },
    })
    expect(JSON.stringify(record)).not.toContain('createdAt')
  })

  test('preserves every supported media-free rich-text semantic without editor node names', async () => {
    const { record } = await prepareQuestionBankExport(bank([shortAnswer]))
    const encoded = JSON.stringify(record.bank.questions[0]!.stem)

    for (const semantic of [
      'heading',
      'blockquote',
      'bullet-list',
      'ordered-list',
      'list-item',
      'code-block',
      'rule',
      'table',
      'table-row',
      'table-cell',
      'inline-math',
      'display-math',
      'hard-break',
      'text',
      'strong',
      'emphasis',
      'inline-code',
      'strike',
      'subscript',
      'superscript',
      'link',
    ])
      expect(encoded).toContain(`"${semantic}"`)
    expect(encoded).toContain('https://example.test/notes')
  })

  test('rejects unsafe links, missing media, and invalid Multiple Choice correctness', async () => {
    const unsafe = structuredClone(shortAnswer)
    const unsafeParagraph = (
      unsafe.doc.content as Record<string, unknown>[]
    )[7]!
    const linked = (unsafeParagraph.content as Record<string, unknown>[])[1]!
    ;(
      (linked.marks as Record<string, unknown>[])[0]!.attrs as Record<
        string,
        unknown
      >
    ).href = 'javascript:alert(1)'
    await expect(prepareQuestionBankExport(bank([unsafe]))).rejects.toThrow(
      'HTTP or HTTPS',
    )

    const image = structuredClone(shortAnswer)
    ;(image.doc.content as Record<string, unknown>[]).push({
      type: 'image-block',
      attrs: { src: '/local-images/deadbeef' },
    })
    await expect(prepareQuestionBankExport(bank([image]))).rejects.toThrow(
      'Required media',
    )

    const twoCorrect = structuredClone(multipleChoice)
    const choices = (twoCorrect.doc.content as Record<string, unknown>[])[1]!
      .content as Record<string, unknown>[]
    ;(choices[0]!.attrs as Record<string, unknown>).correct = true
    await expect(prepareQuestionBankExport(bank([twoCorrect]))).rejects.toThrow(
      'zero or one correct choice',
    )

    const oneChoice = structuredClone(multipleChoice)
    ;((oneChoice.doc.content as Record<string, unknown>[])[1]!
      .content as unknown[]) = [choice('one', false, 'Only')]
    await expect(prepareQuestionBankExport(bank([oneChoice]))).rejects.toThrow(
      'at least two choices',
    )
  })

  test('embeds referenced media once and preserves image semantics', async () => {
    const digest = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'
    const image = structuredClone(shortAnswer)
    ;(image.doc.content as Record<string, unknown>[]).push({
      type: 'image-block',
      attrs: { src: '/local-images/shared', alt: 'Lab setup', caption: 'Figure 1', ratio: 0.5 },
    }, {
      type: 'image-block',
      attrs: { src: '/local-images/shared', alt: 'Repeated setup' },
    })
    const prepared = await prepareQuestionBankExport(bank([image]), async () => ({
      data: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      width: 10,
      height: 20,
    }))

    expect(prepared.record.media).toEqual([{
      id: `sha256:${digest}`,
      mimeType: 'image/png',
      width: 10,
      height: 20,
      bytes: 'AQID',
    }])
    expect(JSON.stringify(prepared.record.bank)).toContain(`sha256:${digest}`)
    expect(JSON.stringify(prepared.record.bank)).toContain('"authoredSize":0.5')
  })

  test('requires a non-empty bank and creates safe filenames', async () => {
    await expect(prepareQuestionBankExport(bank([]))).rejects.toThrow(
      'at least one Question',
    )
    expect(questionBankFilename('  Álgebra: Unit / 1?  ')).toBe(
      'algebra-unit-1.question-bank.pdf',
    )
    expect(questionBankFilename(' ::: ')).toBe(
      'untitled-question-bank.question-bank.pdf',
    )
  })

  test('packages exact source bytes as the sole canonical PDF attachment and renders a complete preview', async () => {
    const prepared = await prepareQuestionBankExport(
      bank([shortAnswer, multipleChoice]),
    )
    const bytes = await createQuestionBankPdf(prepared, fonts)
    const source = new TextDecoder('latin1').decode(bytes)
    const reader = await getDocument({
      data: bytes.slice(),
      disableWorker: true,
    }).promise
    const attachments = await reader.getAttachments()
    const attachment = attachments?.get('pdfcx.json')

    expect([...attachments!.keys()]).toEqual(['pdfcx.json'])
    expect(attachment?.filename).toBe('pdfcx.json')
    expect(attachment?.description).toBe('pdf-canonical-extraction')
    expect(await reader.getAttachmentContent('pdfcx.json')).toEqual(
      prepared.recordBytes,
    )
    expect(source).toContain('/Subtype /application#2Fjson')

    const textContent = await Promise.all(
      Array.from({ length: reader.numPages }, async (_, index) =>
        (await (await reader.getPage(index + 1)).getTextContent()).items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' '),
      ),
    )
    const preview = textContent.join(' ')
    expect(preview).toContain('Chemistry / Review')
    expect(preview).toContain('2 Questions')
    expect(preview).toContain('Teacher Question Bank containing answers')
    expect(preview).toContain('can be imported into Test Parrot')
    expect(preview).toContain('rewritten or printed')
    expect(preview).toContain('Short Answer')
    expect(preview).toContain('Multiple Choice')
    expect(preview).toMatch(/Difficulty:\s+Hard/)
    expect(preview).toMatch(/Topics:\s+Matter, Lab/)
    expect(preview).toContain('Suggested Answer')
    expect(preview).toContain('Mass is conserved.')
    expect(preview).toContain('Neutron')
    expect(preview).toContain('Correct answer')
    expect(preview).not.toContain('Student Name')
    expect(preview).not.toContain('Answer Section')
    expect(preview).not.toContain('Version A')
    expect(source).toContain('/AFRelationship /Source')
  })

  test('paginates long Question Content instead of overflowing', async () => {
    const long = structuredClone(shortAnswer)
    long.doc = {
      type: 'doc',
      content: Array.from({ length: 120 }, (_, index) =>
        paragraph(text(`Complete line ${index + 1}`)),
      ),
    }
    delete long.suggestedAnswer
    const prepared = await prepareQuestionBankExport(bank([long]))
    const bytes = await createQuestionBankPdf(prepared, fonts)
    const reader = await getDocument({ data: bytes, disableWorker: true })
      .promise
    expect(reader.numPages).toBeGreaterThan(1)
    const last = await (await reader.getPage(reader.numPages)).getTextContent()
    expect(
      last.items.map((item) => ('str' in item ? item.str : '')).join(' '),
    ).toContain('Complete line 120')
  })
})
