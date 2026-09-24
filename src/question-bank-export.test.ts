import { describe, expect, test } from 'bun:test'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { partsOf, type Question } from './exam'
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
  importedQuestionsFromRecord,
  inspectQuestionBankRecord,
} from './question-bank-import'
import {
  createQuestionBankPdf,
  type QuestionBankPdfFontLoader,
} from './question-bank-pdf'

const fontFiles = {
  regular: new URL('../public/fonts/FreeSerif.ttf', import.meta.url).pathname,
  bold: new URL('../public/fonts/FreeSerifBold.ttf', import.meta.url).pathname,
  italic: new URL('../public/fonts/FreeSerifItalic.ttf', import.meta.url).pathname,
  boldItalic: new URL('../public/fonts/FreeSerifBoldItalic.ttf', import.meta.url).pathname,
  mono: new URL('../public/fonts/FreeMono.ttf', import.meta.url).pathname,
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

const trueFalse: Question = {
  id: 'local-true-false-id',
  type: 'true-false',
  columns: 2,
  doc: {
    type: 'doc',
    content: [
      paragraph(text('Sound travels faster in water than in air.')),
      {
        type: 'multipleChoice',
        content: [
          choice('local-choice-true', false, 'True'),
          choice('local-choice-false', true, 'False'),
        ],
      },
    ],
  },
}

const matching: Question = {
  id: 'local-matching-id',
  type: 'matching',
  columns: 2,
  topics: ['Intertestamental period'],
  doc: {
    type: 'doc',
    content: [
      paragraph(text('Match each event to the correct time period.')),
      {
        type: 'matching',
        content: [
          {
            type: 'matchingPrompt',
            attrs: { id: 'local-prompt-1', answer: 'local-answer-c' },
            content: [paragraph(text('The Septuagint was completed.'))],
          },
          {
            type: 'matchingPrompt',
            attrs: { id: 'local-prompt-2', answer: 'gone' },
            content: [paragraph(text('Herod the Great rose to power.'))],
          },
          { type: 'matchingAnswer', attrs: { id: 'local-answer-a' }, content: [paragraph(text('Persian'))] },
          { type: 'matchingAnswer', attrs: { id: 'local-answer-b' }, content: [paragraph(text('Roman'))] },
          { type: 'matchingAnswer', attrs: { id: 'local-answer-c' }, content: [paragraph(text('Grecian'))] },
        ],
      },
    ],
  },
}

// A Stimulus with one Multiple Choice Part and one Short Answer Part. The
// Short Answer Part's Suggested Answer stays inside the document, and the
// Multiple Choice Part's answer columns are presentation the record omits.
const stimulus: Question = {
  id: 'local-stimulus-id',
  type: 'stimulus',
  columns: 2,
  difficulty: 'medium',
  topics: ['Ottoman Empire'],
  doc: {
    type: 'doc',
    content: [
      paragraph(text('The power of the [Ottoman] Empire was waning by 1683 …')),
      paragraph(text('Source: “Ottoman Empire (1301–1922),” BBC online, 2009 (adapted)')),
      {
        type: 'stimulusParts',
        content: [
          {
            type: 'stimulusPart',
            attrs: { id: 'local-part-a', columns: 4 },
            content: [
              {
                type: 'stimulusPartStem',
                content: [paragraph(text('Which region was controlled by the Ottoman Empire in 1683?'))],
              },
              {
                type: 'multipleChoice',
                content: [
                  choice('local-part-a-1', false, 'Central America'),
                  choice('local-part-a-2', false, 'South Asia'),
                  choice('local-part-a-3', false, 'East Asia'),
                  choice('local-part-a-4', true, 'Middle East'),
                ],
              },
            ],
          },
          {
            type: 'stimulusPart',
            attrs: { id: 'local-part-b', columns: 2 },
            content: [
              {
                type: 'stimulusPartStem',
                content: [paragraph(text('Identify an issue faced by the Ottoman Empire in the 1600s.'))],
              },
              {
                type: 'suggestedAnswer',
                content: [paragraph(text('Global trade routes shifted.'))],
              },
            ],
          },
        ],
      },
    ],
  },
}

const emptyStimulus: Question = {
  id: 'local-empty-stimulus-id',
  type: 'stimulus',
  columns: 2,
  doc: {
    type: 'doc',
    content: [
      paragraph(text('Study the map of the Silk Road.')),
      { type: 'stimulusParts', content: [] },
    ],
  },
}

describe('Question Bank exchange export seam', () => {
  test('builds the authoritative semantic record in canonical stored order', async () => {
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

  test('writes a True/False Question as its own type, carrying the fixed pair', async () => {
    const { record } = await prepareQuestionBankExport(bank([trueFalse]))

    expect(record.bank.questions[0]).toMatchObject({
      id: 'q1',
      type: 'true-false',
      choices: [
        { id: 'q1-c1', correct: false },
        { id: 'q1-c2', correct: true },
      ],
    })
    // The pair goes out as authored content so an importer needs no table of
    // what True/False means, and no Suggested Answer rides along with it.
    expect(record.bank.questions[0]!.choices![0]!.content).toEqual({
      type: 'document',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'True' }] }],
    })
    expect(record.bank.questions[0]!.suggestedAnswer).toBeUndefined()
  })

  test('refuses a True/False Question that does not ask with exactly two answers', async () => {
    const extra: Question = {
      ...trueFalse,
      doc: {
        type: 'doc',
        content: [
          paragraph(text('Sound travels faster in water than in air.')),
          {
            type: 'multipleChoice',
            content: [
              choice('tf-t', false, 'True'),
              choice('tf-f', true, 'False'),
              choice('tf-x', false, 'Sometimes'),
            ],
          },
        ],
      },
    }
    await expect(prepareQuestionBankExport(bank([extra]))).rejects.toThrow(
      /True\/False and must have exactly two choices/,
    )
  })

  test('writes a matching set as its items and Word Bank, each item naming its answer by package-local id', async () => {
    const { record } = await prepareQuestionBankExport(bank([matching]))

    expect(record.bank.questions[0]).toMatchObject({
      id: 'q1',
      type: 'matching',
      stem: {
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Match each event to the correct time period.' }],
          },
        ],
      },
      prompts: [
        { id: 'q1-p1', answer: 'q1-a3' },
        // An answer the Word Bank no longer holds is no answer.
        { id: 'q1-p2' },
      ],
      wordBank: [{ id: 'q1-a1' }, { id: 'q1-a2' }, { id: 'q1-a3' }],
    })
    expect(record.bank.questions[0]!.prompts![1]).not.toHaveProperty('answer')
    expect(record.bank.questions[0]!.choices).toBeUndefined()
    const encoded = JSON.stringify(record)
    expect(encoded).not.toContain('local-')
    expect(encoded).not.toContain('matchingPrompt')
    expect(encoded).not.toContain('matchingAnswer')
  })

  test('refuses a matching set with fewer than two Word Bank answers', async () => {
    const thin: Question = {
      ...matching,
      doc: {
        type: 'doc',
        content: [
          paragraph(text('Match.')),
          {
            type: 'matching',
            content: [
              { type: 'matchingPrompt', attrs: { id: 'p', answer: '' }, content: [paragraph(text('Item'))] },
              { type: 'matchingAnswer', attrs: { id: 'a' }, content: [paragraph(text('Only'))] },
            ],
          },
        ],
      },
    }
    await expect(prepareQuestionBankExport(bank([thin]))).rejects.toThrow(
      /at least two Word Bank answers/,
    )
  })

  test('writes a Stimulus as its material and lettered Parts, each under a package-local id', async () => {
    const { record } = await prepareQuestionBankExport(bank([stimulus, emptyStimulus]))

    expect(record.formatVersion).toBe('0.4.0')
    expect(record.bank.questions[0]).toEqual({
      id: 'q1',
      type: 'stimulus',
      stem: {
        type: 'document',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'The power of the [Ottoman] Empire was waning by 1683 …' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Source: “Ottoman Empire (1301–1922),” BBC online, 2009 (adapted)' }],
          },
        ],
      },
      difficulty: 'medium',
      topics: ['Ottoman Empire'],
      parts: [
        {
          id: 'q1-s1',
          type: 'multiple-choice',
          stem: expect.objectContaining({ type: 'document' }),
          choices: [
            { id: 'q1-s1-c1', content: expect.anything(), correct: false },
            { id: 'q1-s1-c2', content: expect.anything(), correct: false },
            { id: 'q1-s1-c3', content: expect.anything(), correct: false },
            { id: 'q1-s1-c4', content: expect.anything(), correct: true },
          ],
        },
        {
          id: 'q1-s2',
          type: 'short-answer',
          stem: expect.objectContaining({ type: 'document' }),
          suggestedAnswer: {
            type: 'document',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Global trade routes shifted.' }] },
            ],
          },
        },
      ],
    })
    // A Stimulus with no Parts yet is incomplete, not unexportable.
    expect(record.bank.questions[1]).toMatchObject({ id: 'q2', type: 'stimulus', parts: [] })
    const encoded = JSON.stringify(record)
    expect(encoded).not.toContain('local-')
    expect(encoded).not.toContain('stimulusPart')
    expect(encoded).not.toContain('columns')
  })

  test('a Stimulus round-trips through the record with its Parts, answers and Suggested Answer intact', async () => {
    const first = await prepareQuestionBankExport(bank([stimulus, emptyStimulus]))
    const inspected = await inspectQuestionBankRecord(first.recordBytes)
    const imported = importedQuestionsFromRecord(inspected.record)

    expect(imported.map((question) => question.type)).toEqual(['stimulus', 'stimulus'])
    const parts = partsOf(imported[0]!)
    expect(parts.map((part) => part.type)).toEqual(['multiple-choice', 'open'])
    expect(parts[0]!.choices.map((choice) => choice.correct)).toEqual([false, false, false, true])
    expect(parts[0]!.id).not.toBe('local-part-a')
    expect(partsOf(imported[1]!)).toEqual([])

    const second = await prepareQuestionBankExport(bank(imported))
    expect(second.record.bank).toEqual(first.record.bank)
  })

  test('collects images inside Part stems, choices and Suggested Answers into media', async () => {
    const withImages = structuredClone(stimulus)
    const [partA, partB] = (withImages.doc.content as Record<string, unknown>[]).at(-1)!
      .content as { content: Record<string, unknown>[] }[]
    const image = (name: string) => ({ type: 'image-block', attrs: { src: `/local-images/${name}` } })
    partA!.content[0]!.content = [image('stem')]
    ;(partA!.content[1]!.content as { content: unknown[] }[])[0]!.content = [paragraph(text('Map')), image('choice')]
    partB!.content[1]!.content = [image('answer')]
    const loaded: string[] = []
    const { record } = await prepareQuestionBankExport(bank([withImages]), async (source) => {
      loaded.push(source)
      return { data: new TextEncoder().encode(source), mimeType: 'image/png', width: 1, height: 1 }
    })

    expect(loaded).toEqual(['/local-images/stem', '/local-images/choice', '/local-images/answer'])
    expect(record.media).toHaveLength(3)
    const parts = record.bank.questions[0]!.parts!
    for (const document of [parts[0]!.stem, parts[0]!.choices![0]!.content, parts[1]!.suggestedAnswer!]) {
      expect(JSON.stringify(document)).toContain('sha256:')
    }
  })

  test('refuses a Multiple Choice Part with fewer than two choices', async () => {
    const thin = structuredClone(stimulus)
    const [partA] = (thin.doc.content as Record<string, unknown>[]).at(-1)!
      .content as { content: { content: unknown[] }[] }[]
    partA!.content[1]!.content.splice(1)
    await expect(prepareQuestionBankExport(bank([thin]))).rejects.toThrow(
      'Question 1, Part a must have at least two choices.',
    )
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

  test('previews a Stimulus as its material, then its lettered Parts with their answers', async () => {
    const prepared = await prepareQuestionBankExport(bank([stimulus, emptyStimulus]))
    const bytes = await createQuestionBankPdf(prepared, fonts)
    const reader = await getDocument({ data: bytes.slice(), disableWorker: true }).promise
    const preview = (
      await Promise.all(
        Array.from({ length: reader.numPages }, async (_, index) =>
          (await (await reader.getPage(index + 1)).getTextContent()).items
            .map((item) => ('str' in item ? item.str : ''))
            .join(' '),
        ),
      )
    ).join(' ')

    expect(preview).toMatch(/Question Type:\s+Stimulus/)
    const order = [
      'The power of the [Ottoman] Empire',
      'Source:',
      'a.',
      'Which region was controlled',
      'Middle East',
      'Correct answer',
      'b.',
      'Identify an issue',
      'Suggested Answer',
      'Global trade routes shifted.',
      'No Parts yet.',
    ].map((fragment) => preview.indexOf(fragment))
    expect(order.every((position) => position >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((left, right) => left - right))
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
