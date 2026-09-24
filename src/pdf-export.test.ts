import { describe, expect, test } from 'bun:test'
import { PDFDocument } from 'pdf-lib'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  createPublicationPdf,
  isPdfUnsupportedCharacterError,
  type PdfFontLoader,
} from './pdf-export'
import { FIXTURES, PIXEL_PNG } from './export-fixtures'
import { SECTION_INSTRUCTIONS, questionIndentOf } from './export-plan'
import {
  DEFAULT_EXPORT_CONFIGURATION,
  EMPTY_EXPORT_HISTORY,
  prepareExport,
} from './export-preparation'

const fontFiles = {
  regular: new URL('../public/fonts/FreeSerif.ttf', import.meta.url).pathname,
  bold: new URL('../public/fonts/FreeSerifBold.ttf', import.meta.url).pathname,
  italic: new URL('../public/fonts/FreeSerifItalic.ttf', import.meta.url).pathname,
  boldItalic: new URL('../public/fonts/FreeSerifBoldItalic.ttf', import.meta.url).pathname,
  mono: new URL('../public/fonts/FreeMono.ttf', import.meta.url).pathname,
} as const

const fonts: PdfFontLoader = async (style) => Bun.file(fontFiles[style]).arrayBuffer()
const noImages = async () => null
const pixel = async () => PIXEL_PNG

function plansOf(fixtureName: string) {
  const fixture = FIXTURES.find((candidate) => candidate.name === fixtureName)!
  return {
    fixture,
    plans: prepareExport({
      examId: 'fixture-exam',
      exam: fixture.exam,
      arrangement: fixture.arrangement,
      configuration: DEFAULT_EXPORT_CONFIGURATION,
      history: EMPTY_EXPORT_HISTORY,
      measure: fixture.measure,
      createdAt: '2026-09-04T12:00:00.000Z',
    }).documents,
  }
}

describe('PDF Export Adapter', () => {
  test('creates one PDF with planned pages, metadata, selectable text, and independent stream numbering', async () => {
    const { fixture, plans } = plansOf('both sections with the answer key')
    const bytes = await createPublicationPdf(plans, noImages, fonts)
    const document = await PDFDocument.load(bytes)

    expect(document.getPageCount()).toBe(plans.reduce((sum, plan) => sum + plan.pages.length, 0))
    expect(document.getTitle()).toBe(fixture.exam.title)
    expect(document.getCreator()).toBe('Test Parrot')
    expect(document.getPage(0).getSize()).toEqual({ width: 612, height: 792 })
    // pdf-lib writes real text operators. Whole-page rasterization would have
    // image XObjects but no text-showing operators in the content streams.
    const source = new TextDecoder('latin1').decode(bytes)
    expect(source).toMatch(/\/Type\s*\/Font/)
    expect(source).toMatch(/\/FontFile2\s+\d+\s+0\s+R/)
    expect(source).toMatch(/\/ToUnicode\s+\d+\s+0\s+R/)
    expect(document.getCreator()).toBe('Test Parrot')
  })

  test('prints Difficulty and Topic tags beside Answer Key entries', async () => {
    const { plans } = plansOf('both sections with the answer key')
    const bytes = await createPublicationPdf(plans, noImages, fonts)
    const document = await getDocument({ data: bytes, disableWorker: true }).promise
    const text = (await Promise.all(
      Array.from({ length: document.numPages }, async (_, index) =>
        (await (await document.getPage(index + 1)).getTextContent()).items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' '),
      ),
    )).join(' ')

    expect(text).toContain('Easy')
    expect(text).toContain('Acids')
    expect(text).toContain('Hard')
    expect(text).toContain('Titration')
  })

  test('writes authored hyperlinks as PDF link annotations', async () => {
    const { plans } = plansOf('a link and its destination')
    const bytes = await createPublicationPdf(plans, noImages, fonts)
    const source = new TextDecoder('latin1').decode(bytes)

    expect(source).toContain('/Subtype /Link')
    expect(source).toContain('https://example.test/notes')
  })

  test('embeds inline and block image bytes', async () => {
    const { plans } = plansOf('inline and block images')
    const bytes = await createPublicationPdf(plans, pixel, fonts)
    const source = new TextDecoder('latin1').decode(bytes)

    // The fixture references one inline image and one block image. Both are
    // embedded as image XObjects rather than replaced by alt text.
    expect(source.match(/\/Subtype\s*\/Image/g)?.length).toBeGreaterThanOrEqual(2)
    expect(source).not.toContain('[Image:')
  })

  // A picture on a line of its own was drawn at the page's left margin, under
  // the question's blank and number, instead of in the column its block is in.
  test('draws a picture in the column of the block that holds it', async () => {
    const { plans } = plansOf('pictures in a multiple-choice stem and choice')
    const bytes = await createPublicationPdf(plans, pixel, fonts)
    const page = await (await getDocument({ data: bytes, disableWorker: true }).promise).getPage(1)
    const operators = await page.getOperatorList()
    // pdf-lib draws an image as save, translate to its corner, scale, paint;
    // the translation is the last non-identity unit matrix before the paint.
    const lefts: number[] = []
    let translate = 0
    for (const [index, op] of operators.fnArray.entries()) {
      const args = operators.argsArray[index] as number[]
      const moves = args?.[0] === 1 && args[3] === 1 && (args[4] !== 0 || args[5] !== 0)
      if (op === OPS.transform && moves) translate = args[4]!
      if (op === OPS.paintImageXObject) lefts.push(translate)
    }
    const margin = 72 * 0.75
    const body = margin + questionIndentOf({ type: 'multiple-choice' }) * 0.75
    // The stem's block picture, its inline one, and the first choice's.
    expect(lefts).toHaveLength(3)
    for (const left of lefts) expect(left).toBeGreaterThanOrEqual(body - 0.5)
    // The choice's picture sits past its letter, not on it.
    expect(Math.max(...lefts)).toBeGreaterThanOrEqual(body + 17)
  })

  test('typesets common inline and display math rather than printing LaTeX commands', async () => {
    const { plans } = plansOf('inline and display mathematics')
    const bytes = await createPublicationPdf(plans, noImages, fonts)
    const document = await getDocument({ data: bytes, disableWorker: true }).promise
    const pages = await Promise.all(
      Array.from({ length: document.numPages }, async (_, index) =>
        (await (await document.getPage(index + 1)).getTextContent()).items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' '),
      ),
    )
    const text = pages.join(' ')

    expect(text).toContain('E = mc')
    expect(text).toContain('a⁄b = √c')
    expect(text).not.toContain('\\frac')
    expect(text).not.toContain('\\sqrt')
  })

  test('requires the font variants used by authored formatting', async () => {
    const { plans } = plansOf('every inline mark')
    const requested: string[] = []
    await createPublicationPdf(plans, noImages, async (style) => {
      requested.push(style)
      return fonts(style)
    })

    expect(new Set(requested)).toEqual(
      new Set(['regular', 'bold', 'italic', 'boldItalic', 'mono']),
    )
  })

  test('fails actionably when a character is absent from the bundled fonts', async () => {
    const { plans } = plansOf('a plain short-answer question')
    const changed = structuredClone(plans)
    const item = changed[0]!.pages[0]!.items.find((candidate) => candidate.kind === 'question')!
    if (item.kind !== 'question') throw new Error('fixture has no question')
    item.stem = [{ type: 'paragraph', content: [{ type: 'text', text: 'Unsupported \u0378' }] }]

    try {
      await createPublicationPdf(changed, noImages, fonts)
      throw new Error('expected unsupported character failure')
    } catch (error) {
      expect(isPdfUnsupportedCharacterError(error)).toBe(true)
      expect((error as Error).message).toContain('\u0378')
      expect((error as Error).message).toContain('Remove or replace')
    }
  })

  test('rules a lined work space and lets a filled one reach the foot of its page', async () => {
    const { plans } = plansOf('Short Answer work space, lined, blank and filling its page')
    const bytes = await createPublicationPdf(plans, noImages, fonts)
    const document = await PDFDocument.load(bytes)

    // The fill moves the last question on; nothing overflows the test's pages.
    expect(document.getPageCount()).toBe(plans.reduce((sum, plan) => sum + plan.pages.length, 0))
    const firstPage = (await getDocument({ data: bytes.slice() }).promise).getPage(1)
    const operators = await (await firstPage).getOperatorList()
    // Each rule is its own stroked path: five for the first question and the
    // filled question's many more, so well over five on the page.
    const rules = operators.fnArray.filter((fn: number) => fn === OPS.constructPath).length
    expect(rules).toBeGreaterThan(5)
  })

  test('fails instead of emitting content outside a planned page', async () => {
    const { plans } = plansOf('a plain short-answer question')
    const changed = structuredClone(plans)
    const item = changed[0]!.pages[0]!.items.find((candidate) => candidate.kind === 'question')!
    if (item.kind !== 'question') throw new Error('fixture has no question')
    item.stem = Array.from({ length: 100 }, () => ({
      type: 'paragraph',
      content: [{ type: 'text', text: 'This content was not in the measured Layout Plan.' }],
    }))

    await expect(createPublicationPdf(changed, noImages, fonts)).rejects.toThrow(
      'does not fit its planned page',
    )
  })

  // An Exam's own section wording reaches the PDF, and a part it cleared does
  // not — neither the words nor the default they replaced.
  test('draws reworded section headings and nothing for a cleared one', async () => {
    const { plans } = plansOf('reworded, cleared and large section headings')
    const bytes = await createPublicationPdf(plans, noImages, fonts)
    const document = await getDocument({ data: bytes, disableWorker: true }).promise
    let drawn = ''
    for (let index = 1; index <= document.numPages; index += 1) {
      drawn += ' ' + (await (await document.getPage(index)).getTextContent()).items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
    }
    drawn = drawn.replace(/\s+/g, ' ')
    expect(drawn).toContain('Choose One')
    expect(drawn).toContain('Write the letter of the matching definition.')
    expect(drawn).not.toContain(SECTION_INSTRUCTIONS['multiple-choice'])
    expect(drawn).not.toContain(SECTION_INSTRUCTIONS.open)
    // Cleared from the test, the Short Answer group is still named in the key.
    expect(drawn).toContain('Short Answer')
  })

  // A matching question once printed its stem and nothing else: no prompts, no
  // Word Bank. Every prompt's number and text, and every answer's letter and
  // text, must reach the page the plan put them on.
  test.each([
    'a matching set with a shuffled word bank and an unmatched item',
    'a matching set whose long word bank prints above its items',
    'a matching set too long for one page, its word bank on every piece',
  ])('draws every prompt and Word Bank answer of %s', async (name) => {
    const { plans } = plansOf(name)
    const bytes = await createPublicationPdf(plans, noImages, fonts)
    const document = await getDocument({ data: bytes, disableWorker: true }).promise
    const plainText = (node: { text?: string; content?: unknown[] }): string =>
      node.text ?? (node.content ?? []).map((child) => plainText(child as typeof node)).join('')
    const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()

    for (const [index, page] of plans.flatMap((plan) => plan.pages).entries()) {
      const drawn = normalize(
        (await (await document.getPage(index + 1)).getTextContent()).items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' '),
      )
      for (const item of page.items) {
        if (item.kind !== 'question' || !item.matching) continue
        for (const prompt of item.matching.prompts) {
          expect(drawn).toContain(normalize(`${prompt.number}. ${plainText(prompt.node)}`))
        }
        for (const answer of item.matching.bank) {
          expect(drawn).toContain(normalize(`${answer.letter}. ${plainText(answer.node)}`))
        }
        // The set's numbers print on its prompts; its directions print unnumbered.
        const [directions] = item.stem
        if (directions) expect(drawn).not.toContain(normalize(`1. ${plainText(directions)}`))
      }
    }
  })
})
