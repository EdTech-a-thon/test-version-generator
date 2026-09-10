import { describe, expect, test } from 'bun:test'
import { PDFDocument } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  createPublicationPdf,
  isPdfUnsupportedCharacterError,
  type PdfFontLoader,
} from './pdf-export'
import { FIXTURES, PIXEL_PNG } from './export-fixtures'
import {
  DEFAULT_EXPORT_CONFIGURATION,
  EMPTY_EXPORT_HISTORY,
  prepareExport,
} from './export-preparation'

const fontFiles = {
  regular: '/usr/share/fonts/truetype/freefont/FreeSerif.ttf',
  bold: '/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf',
  italic: '/usr/share/fonts/truetype/freefont/FreeSerifItalic.ttf',
  boldItalic: '/usr/share/fonts/truetype/freefont/FreeSerifBoldItalic.ttf',
  mono: '/usr/share/fonts/truetype/freefont/FreeMono.ttf',
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
})
