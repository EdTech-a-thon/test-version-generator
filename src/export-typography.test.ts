// One type scale, three presentations.
//
// Parity compares what an export says, not how large it says it, so a DOCX that
// fell back to Word's own 10pt defaults passed every parity fixture while
// reading a size smaller than print. These tests hold print's stylesheet, the
// DOCX package and the PDF's drawn text to the single table in
// `export-typography.ts`.

import { describe, expect, test } from 'bun:test'
import JSZip from 'jszip'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createExamDocx } from './docx-export'
import { EMPTY_EXPORT_HISTORY, plansOf, prepareExport } from './export-preparation'
import { FIXTURES } from './export-fixtures'
import { PAGE_CONTENT_WIDTH } from './export-plan'
import { EXAM_FONT, EXAM_TYPE_PX, halfPointsOf, pointsOf } from './export-typography'
import { createPublicationPdf, type PdfFontLoader } from './pdf-export'

const fontFile = {
  regular: 'FreeSerif.ttf',
  bold: 'FreeSerifBold.ttf',
  italic: 'FreeSerifItalic.ttf',
  boldItalic: 'FreeSerifBoldItalic.ttf',
  mono: 'FreeMono.ttf',
} as const
const fonts: PdfFontLoader = async (style) =>
  Bun.file(new URL(`../public/fonts/${fontFile[style]}`, import.meta.url).pathname).arrayBuffer()

function plansOfFixture(name: string) {
  const fixture = FIXTURES.find((candidate) => candidate.name === name)!
  return plansOf(
    prepareExport({
      examId: 'fixture-exam',
      exam: fixture.exam,
      arrangement: fixture.arrangement,
      configuration: { selection: { test: true, answerKey: true } },
      history: EMPTY_EXPORT_HISTORY,
      measure: fixture.measure,
      createdAt: '2026-09-04T12:00:00.000Z',
    }),
  )
}

const FIXTURE = 'all four sections on one paper'

describe('print’s stylesheet is the table', () => {
  const css = Bun.file(new URL('./styles.css', import.meta.url).pathname).text()

  // The declaration block of a selector exactly as styles.css spells it.
  async function rule(selector: string): Promise<string> {
    const source = await css
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(source)
    if (!match) throw new Error(`styles.css has no rule for ${selector}`)
    return match[1]!
  }
  const sizeIn = (block: string) => Number(/font(?:-size)?:[^;]*?(\d+)px/.exec(block)?.[1])

  test.each([
    ['.exam-page', 'body'],
    ['.section-title', 'sectionTitle'],
    ['.answer-key-section', 'sectionTitle'],
    ['.answer-key-heading', 'answerKeyHeading'],
    ['.page-footer', 'small'],
    ['.doc-figure figcaption', 'small'],
  ] as const)('%s is set at the %s size', async (selector, role) => {
    expect(sizeIn(await rule(selector))).toBe(EXAM_TYPE_PX[role])
  })

  test('the title is set at the title size', async () => {
    expect(sizeIn(await rule('.page-header--first .exam-title,\n.page-header--answer-key .exam-title'))).toBe(
      EXAM_TYPE_PX.title,
    )
  })

  test('the sheet is set in the exam font', async () => {
    expect(await rule('.exam-page')).toContain(`font-family: ${EXAM_FONT}`)
  })
})

describe('DOCX sets print’s type rather than Word’s defaults', () => {
  async function packaged() {
    const blob = await createExamDocx(plansOfFixture(FIXTURE), async () => null)
    return JSZip.loadAsync(await blob.arrayBuffer())
  }
  const styleOf = (styles: string, id: string) =>
    new RegExp(`<w:style\\b[^>]*w:styleId="${id}".*?</w:style>`, 's').exec(styles)?.[0] ?? ''
  const sizeOf = (xml: string) => Number(/<w:sz w:val="(\d+)"/.exec(xml)?.[1])

  test('body text defaults to the exam font at the body size', async () => {
    const styles = await (await packaged()).file('word/styles.xml')!.async('string')
    const defaults = /<w:docDefaults>.*?<\/w:docDefaults>/s.exec(styles)![0]
    expect(defaults).toContain(`w:ascii="${EXAM_FONT}"`)
    expect(sizeOf(defaults)).toBe(halfPointsOf('body'))
  })

  test('the title and section headings are print’s sizes', async () => {
    const styles = await (await packaged()).file('word/styles.xml')!.async('string')
    expect(sizeOf(styleOf(styles, 'Title'))).toBe(halfPointsOf('title'))
    expect(sizeOf(styleOf(styles, 'Heading1'))).toBe(halfPointsOf('sectionTitle'))
    expect(sizeOf(styleOf(styles, 'Heading2'))).toBe(halfPointsOf('sectionTitle'))
  })

  test('each Word size is within a quarter point of print and never larger', () => {
    for (const role of Object.keys(EXAM_TYPE_PX) as (keyof typeof EXAM_TYPE_PX)[]) {
      const word = halfPointsOf(role) / 2
      expect(word).toBeLessThanOrEqual(pointsOf(role))
      expect(pointsOf(role) - word).toBeLessThanOrEqual(0.25)
    }
  })

  test('the identity line spans the content width, its output ID against the right margin', async () => {
    const zip = await packaged()
    const header = await zip.file('word/header1.xml')!.async('string')
    const stops = [...header.matchAll(/<w:tab w:val="(\w+)" w:pos="(\d+)"(?: w:leader="(\w+)")?\/>/g)]
    const last = stops.at(-1)!
    expect([last[1], Number(last[2])]).toEqual(['right', PAGE_CONTENT_WIDTH * 15])
    // Name, Class and Date each ruled to their own stop, as print's blanks are.
    expect(stops.filter((stop) => stop[3] === 'underscore')).toHaveLength(3)
    // Real tab elements, which Word advances to a stop; a literal tab
    // character inside the text is not one.
    expect(header).not.toMatch(/<w:t[^>]*>[^<]*\t/)
  })
})

describe('the PDF draws print’s type', () => {
  test('stems at the body size and the title at the title size', async () => {
    const bytes = await createPublicationPdf(plansOfFixture(FIXTURE), async () => null, fonts)
    const page = await (await getDocument({ data: bytes }).promise).getPage(1)
    const items = (await page.getTextContent()).items as { str: string; transform: number[] }[]
    const sizeOfText = (text: string) => items.find((item) => item.str.includes(text))?.transform[0]
    expect(sizeOfText('Which particle is neutral?')).toBeCloseTo(pointsOf('body'), 2)
    expect(sizeOfText('Mixed sections')).toBeCloseTo(pointsOf('title'), 2)
  })
})
