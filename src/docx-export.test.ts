// DOCX packaging and adapter specifics.
//
// Parity — the same content on the same page — is asserted in
// `export-parity.test.ts` through the shared fingerprint. What is left here is
// what only the DOCX adapter can be asked: that the package is a Word file a
// browser will download, that it is cut to the plan's sheet, that one planned
// page is one Word section, and that links and pictures survive as
// relationships and parts rather than as text about them.

import { describe, expect, test } from 'bun:test'
import JSZip from 'jszip'
import {
  createExamDocx,
  createExamDocxDocument,
  createPublicationDocx,
} from './docx-export'
import {
  EMPTY_EXPORT_HISTORY,
  docxFilename,
  plansOf,
  prepareExport,
} from './export-preparation'
import { docxFingerprint } from './docx-fingerprint'
import { parseXml } from './xml'
import { FIXTURES, PIXEL_PNG, paragraph, text } from './export-fixtures'
import { planExport, unmeasured, STUDENT_TEST } from './export-plan'
import type { Arrangement, Exam } from './exam'

const exam: Exam = {
  title: 'Chemistry: Unit 3 / Review',
  questions: [
    {
      id: 'q1',
      type: 'open',
      columns: 2,
      doc: {
        type: 'doc',
        content: [paragraph(text('Show  your work')), paragraph()],
      },
    },
  ],
}

const arrangement: Arrangement = { id: 'v1', letter: 'A', questionOrder: ['q1'], choiceOrder: {} }

function planOf(source: Exam = exam, ordering: Arrangement = arrangement) {
  return planExport({
    exam: source,
    arrangement: ordering,
    selection: STUDENT_TEST,
    measure: unmeasured,
  })
}

async function packageOf(blob: Blob): Promise<JSZip> {
  return JSZip.loadAsync(await blob.arrayBuffer())
}

async function part(zip: JSZip, name: string): Promise<string> {
  const file = zip.file(name)
  if (!file) throw new Error(`The package has no ${name}`)
  return file.async('string')
}

describe('DOCX packaging', () => {
  test('builds a Word ZIP blob in the browser-compatible MIME type', async () => {
    const blob = await createExamDocx([planOf()], async () => null)
    const signature = new Uint8Array(await blob.slice(0, 2).arrayBuffer())

    expect(blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    expect([...signature]).toEqual([0x50, 0x4b])
  })

  test('names the file after the Exam', () => {
    expect(docxFilename(exam.title)).toBe('Chemistry- Unit 3 - Review.docx')
    expect(docxFilename('  ...  ')).toBe('Untitled Exam.docx')
  })

  test('names the document after the exam and the arrangement it exported', async () => {
    const fingerprint = await docxFingerprint(
      await (await createExamDocx([planOf()], async () => null)).arrayBuffer(),
    )
    expect(fingerprint.title).toBe('Chemistry: Unit 3 / Review')
    expect(fingerprint.arrangement).toBe('A')
  })
})

describe('the plan is the adapter’s only document input', () => {
  test('a document can be built from a plan alone, with no exam in reach', () => {
    const plan = planOf()
    // `createExamDocxDocument` takes prepared `LayoutPlan`s and resolved media.
    // There is no overload that accepts an `Exam`, which is what stops the DOCX
    // path rediscovering ordering, numbering or pagination for itself.
    expect(createExamDocxDocument([plan])).toBeDefined()
  })

  test('the planned title and output ID are what the document carries', async () => {
    const renamed = { ...exam, title: 'Physics Retake' }
    const fingerprint = await docxFingerprint(
      await (
        await createExamDocx(
          [planOf(renamed, { ...arrangement, letter: 'C' })],
          async () => null,
        )
      ).arrayBuffer(),
    )
    expect(fingerprint.title).toBe('Physics Retake')
    expect(fingerprint.arrangement).toBe('C')
  })
})

describe('the planned sheet', () => {
  test('is US Letter with the plan’s own margins', async () => {
    const plan = planOf()
    const fingerprint = await docxFingerprint(
      await (await createExamDocx([plan], async () => null)).arrayBuffer(),
    )
    for (const page of fingerprint.pages) {
      expect(page.width).toBe(plan.pageSize.width)
      expect(page.height).toBe(plan.pageSize.height)
      expect(page.margin).toBe(plan.pageSize.margin)
    }
  })

  test('gives every planned page one Word section of its own', async () => {
    const fixture = FIXTURES.find((item) => item.name.includes('split across pages'))!
    const plan = planExport({
      exam: fixture.exam,
      arrangement: fixture.arrangement,
      selection: STUDENT_TEST,
      measure: fixture.measure,
    })
    expect(plan.pages.length).toBeGreaterThan(1)
    const fingerprint = await docxFingerprint(
      await (await createExamDocx([plan], async () => null)).arrayBuffer(),
    )
    expect(fingerprint.pages.length).toBe(plan.pages.length)
  })

  test('carries the plan’s own footer numbers rather than a document-wide field', async () => {
    const fixture = FIXTURES.find((item) => item.name.includes('split across pages'))!
    const plan = planExport({
      exam: fixture.exam,
      arrangement: fixture.arrangement,
      selection: STUDENT_TEST,
      measure: fixture.measure,
    })
    const fingerprint = await docxFingerprint(
      await (await createExamDocx([plan], async () => null)).arrayBuffer(),
    )
    expect(fingerprint.pages.map((page) => page.footer)).toEqual(
      plan.pages.map((page) => [`para ${page.furniture.pageNumber}`]),
    )
  })
})

describe('links and pictures', () => {
  test('a link becomes a package relationship carrying its destination', async () => {
    const fixture = FIXTURES.find((item) => item.name.includes('a link and'))!
    const blob = await createExamDocx(
      [planExport({
        exam: fixture.exam,
        arrangement: fixture.arrangement,
        selection: STUDENT_TEST,
        measure: unmeasured,
      })],
      async () => null,
    )
    const relationships = await part(
      await packageOf(blob),
      'word/_rels/document.xml.rels',
    )
    expect(relationships).toContain('https://example.test/notes')
  })

  test('an image is packaged as real bytes, not as text about a picture', async () => {
    const fixture = FIXTURES.find((item) => item.name.includes('inline and block images'))!
    const zip = await packageOf(
      await createExamDocx(
        [planExport({
          exam: fixture.exam,
          arrangement: fixture.arrangement,
          selection: STUDENT_TEST,
          measure: unmeasured,
        })],
        async () => PIXEL_PNG,
      ),
    )
    const media = Object.entries(zip.files).filter(
      ([name, file]) => name.startsWith('word/media/') && !file.dir,
    )
    expect(media.length).toBeGreaterThan(0)
    const body = await part(zip, 'word/document.xml')
    expect(body).toContain('<w:drawing>')
    expect(body).not.toContain('[Image:')
  })

  test('an image whose bytes cannot be read degrades to its alt text', async () => {
    const fixture = FIXTURES.find((item) => item.name.includes('inline and block images'))!
    const body = await part(
      await packageOf(
        await createExamDocx(
          [planExport({
            exam: fixture.exam,
            arrangement: fixture.arrangement,
            selection: STUDENT_TEST,
            measure: unmeasured,
          })],
          async () => null,
        ),
      ),
      'word/document.xml',
    )
    // Loudly wrong beats silently missing: the reader can see what was lost.
    expect(body).toContain('[Image: burner]')
  })

  test('publication refuses unresolved required media and identifies the question', async () => {
    const fixture = FIXTURES.find((item) => item.name.includes('inline and block images'))!
    const plan = planExport({
      exam: fixture.exam,
      arrangement: fixture.arrangement,
      selection: STUDENT_TEST,
      measure: unmeasured,
    })

    expect(createPublicationDocx([plan], async () => null)).rejects.toThrow(
      'question 1',
    )
  })
})

describe('lists are numbering, not typed-in markers', () => {
  test('each authored list gets its own numbering instance', async () => {
    const fixture = FIXTURES.find((item) => item.name.includes('bullet, ordered'))!
    const zip = await packageOf(
      await createExamDocx(
        [planExport({
          exam: fixture.exam,
          arrangement: fixture.arrangement,
          selection: STUDENT_TEST,
          measure: unmeasured,
        })],
        async () => null,
      ),
    )
    const numbering = parseXml(await part(zip, 'word/numbering.xml'))
    const instances = JSON.stringify(numbering).match(/w:num"/g) ?? []
    expect(instances.length).toBeGreaterThan(0)
    // The ordered list is authored to start at three, and the package says so
    // rather than restating the numbers as literal text.
    expect(await part(zip, 'word/numbering.xml')).toContain('w:start w:val="3"')
  })
})

describe('one combined package for a Export Artifact', () => {
  const mixed: Exam = {
    title: 'Mixed',
    questions: [
      {
        id: 'm1',
        type: 'multiple-choice',
        columns: 1,
        doc: {
          type: 'doc',
          content: [
            paragraph(text('Which is a mammal?')),
            {
              type: 'multipleChoice',
              content: [
                {
                  type: 'multipleChoiceChoice',
                  attrs: { id: 'c1', correct: true },
                  content: [paragraph(text('Whale'))],
                },
                {
                  type: 'multipleChoiceChoice',
                  attrs: { id: 'c2', correct: false },
                  content: [paragraph(text('Shark'))],
                },
              ],
            },
          ],
        },
      },
    ],
  }
  const mixedArrangement: Arrangement = {
    id: 'v1',
    letter: 'A',
    questionOrder: ['m1'],
    choiceOrder: { m1: ['c1', 'c2'] },
  }

  function preparedPlans() {
    return plansOf(
      prepareExport({
        examId: 'fixture-exam',
        exam: mixed,
        arrangement: mixedArrangement,
        configuration: {
          selection: { test: true, answerKey: true },
        },
        history: EMPTY_EXPORT_HISTORY,
        measure: unmeasured,
        createdAt: '2026-09-04T12:00:00.000Z',
      }),
    )
  }

  test('gives every planned page of every document its own Word section', async () => {
    const plans = preparedPlans()
    const zip = await packageOf(await createExamDocx(plans, async () => null))
    const body = await part(zip, 'word/document.xml')
    const sections = body.match(/<w:sectPr/g) ?? []

    expect(plans.length).toBe(2)
    expect(sections.length).toBe(
      plans.reduce((count, plan) => count + plan.pages.length, 0),
    )
  })

  test('restarts page numbering and carries the output ID on both documents', async () => {
    const fingerprint = await docxFingerprint(
      await (await createExamDocx(preparedPlans(), async () => null)).arrayBuffer(),
    )

    // The test and key each begin on page one and carry one stable name.
    expect(fingerprint.pages.map((page) => page.footer)).toEqual([
      ['para 1'],
      ['para 1'],
    ])
    expect(fingerprint.pages.every((page) =>
      page.header.join(' ').includes('ID: A'),
    )).toBe(true)
    expect(fingerprint.arrangement).toBe('A')
  })

  test('writes an answer key as headings and bold letters, not as a refusal', async () => {
    const plans = preparedPlans()
    const fingerprint = await docxFingerprint(
      await (await createExamDocx(plans, async () => null)).arrayBuffer(),
    )
    const keys = fingerprint.pages.slice(1)

    expect(keys[0]!.content).toEqual([
      'heading:1 Answer Section',
      'heading:2 Multiple Choice',
      'para 1. «strong»A«/»',
    ])
  })
})
