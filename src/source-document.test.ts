import { beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { PDFDocument, StandardFonts, type PDFPage } from 'pdf-lib'
import {
  analyzeSourceDocument,
  cropSourcePage,
  labelSourceDocument,
  labeledFilename,
  photoSourceDocument,
  pictureForTag,
  type PageBox,
  type Raster,
  type SourceDocumentAnalysis,
} from './source-document'

const raster: Raster = {
  createCanvas: (width, height) => createCanvas(width, height) as unknown as ReturnType<Raster['createCanvas']>,
  async encodePng({ width, height, data }) {
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d')
    const image = context.createImageData(width, height)
    image.data.set(data)
    context.putImageData(image, 0, 0)
    return new Uint8Array(canvas.toBuffer('image/png'))
  },
}

const fonts = async () =>
  Bun.file(join(import.meta.dir, '..', 'public', 'fonts', 'FreeSerifBold.ttf')).bytes()

/** A distinct, opaque picture: a gradient keyed by `seed`, so every pixel of
 *  a returned picture can be compared with what was embedded. */
function picture(width: number, height: number, seed: number) {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  const image = context.createImageData(width, height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4
      image.data[at] = (x * 7 + seed * 40) % 256
      image.data[at + 1] = (y * 5 + seed * 90) % 256
      image.data[at + 2] = (seed * 60) % 256
      image.data[at + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  return { png: new Uint8Array(canvas.toBuffer('image/png')), pixels: image.data, width, height }
}

const W = 612
const H = 792
/** Where pdf-lib draws, given a top-left box in points. */
const draw = (page: PDFPage, image: Parameters<PDFPage['drawImage']>[0], left: number, top: number, width: number, height: number) =>
  page.drawImage(image, { x: left, y: H - top - height, width, height })
const boxOf = (left: number, top: number, width: number, height: number): PageBox => ({
  left: (left / W) * 1000,
  top: (top / H) * 1000,
  right: ((left + width) / W) * 1000,
  bottom: ((top + height) / H) * 1000,
})

const QUESTION = 'Which graph shows a function that is increasing everywhere?'
const grid = picture(40, 30, 1)
let source: Uint8Array
let analysis: SourceDocumentAnalysis

beforeAll(async () => {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const images = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8, 9].map((seed) => pdf.embedPng(seed === 1 ? grid.png : picture(40, 30, seed).png)))

  // 1: a question with a 2×2 grid of graphs below it.
  const first = pdf.addPage([W, H])
  first.drawText(`1. ${QUESTION}`, { x: 72, y: H - 80, size: 12, font })
  draw(first, images[0]!, 72, 120, 200, 150)
  draw(first, images[1]!, 320, 120, 200, 150)
  draw(first, images[2]!, 72, 300, 200, 150)
  draw(first, images[3]!, 320, 300, 200, 150)
  first.drawText('2. Which graph is periodic?', { x: 72, y: H - 500, size: 12, font })

  // 2: two pictures side by side, the left one set slightly lower.
  const second = pdf.addPage([W, H])
  draw(second, images[4]!, 72, 112, 200, 150)
  draw(second, images[5]!, 320, 100, 200, 150)

  // 3: an equation stored as a picture, and a full-page scan.
  const third = pdf.addPage([W, H])
  draw(third, images[6]!, 72, 72, 30, 14)
  draw(third, images[7]!, 0, 0, W, H)

  // 4: one embedded image painted twice.
  const fourth = pdf.addPage([W, H])
  draw(fourth, images[8]!, 72, 100, 200, 150)
  draw(fourth, images[8]!, 72, 400, 200, 150)

  // 5: no pictures at all.
  pdf.addPage([W, H]).drawText('Answer every question.', { x: 72, y: H - 80, size: 12, font })

  source = await pdf.save()
  analysis = await analyzeSourceDocument(source)
})

describe('analyzing a Source Document', () => {
  test('tags every picture across the document, page by page, in reading order', () => {
    expect(analysis.pageCount).toBe(5)
    expect(analysis.tags.map(({ tag, page }) => [tag, page])).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
      [5, 2],
      [6, 2],
      [7, 4],
      [8, 4],
    ])
    const near = (actual: PageBox, expected: PageBox) => {
      for (const side of ['left', 'top', 'right', 'bottom'] as const)
        expect(actual[side]).toBeCloseTo(expected[side], 0)
    }
    near(analysis.tags[0]!.box, boxOf(72, 120, 200, 150))
    near(analysis.tags[1]!.box, boxOf(320, 120, 200, 150))
    near(analysis.tags[2]!.box, boxOf(72, 300, 200, 150))
    near(analysis.tags[3]!.box, boxOf(320, 300, 200, 150))
    // Tops 12pt apart share a row, so left reads before right.
    near(analysis.tags[4]!.box, boxOf(72, 112, 200, 150))
    near(analysis.tags[5]!.box, boxOf(320, 100, 200, 150))
    expect(analysis.tags[0]).toMatchObject({ width: 40, height: 30 })
  })

  test('gives no tag to an equation-sized image or a full-page scan', () => {
    expect(analysis.tags.some((tag) => tag.page === 3)).toBe(false)
  })

  test('analyzing the same PDF twice gives the same tags', async () => {
    expect(await analyzeSourceDocument(source)).toEqual(analysis)
  })

  test('reads each page’s text for checking a record against it', () => {
    expect(analysis.pageText[0]).toContain(QUESTION)
    expect(analysis.pageText[4]).toBe('Answer every question.')
  })

  test('refuses a file that is not a PDF', async () => {
    await expect(analyzeSourceDocument(new TextEncoder().encode('{"not":"a pdf"}'))).rejects.toThrow(
      'not a PDF',
    )
  })
})

describe('a tag’s picture', () => {
  test('is the embedded image at its own size and pixels, as PNG', async () => {
    const png = await pictureForTag(source, analysis.tags[0]!, raster)
    const image = await loadImage(Buffer.from(png))
    expect([image.width, image.height]).toEqual([40, 30])
    const canvas = createCanvas(40, 30)
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    expect([...context.getImageData(0, 0, 40, 30).data]).toEqual([...grid.pixels])
  })

  test('is the same picture for both paints of one image, and differs from its neighbours', async () => {
    const [seventh, eighth, first] = await Promise.all([
      pictureForTag(source, analysis.tags[6]!, raster),
      pictureForTag(source, analysis.tags[7]!, raster),
      pictureForTag(source, analysis.tags[1]!, raster),
    ])
    expect(seventh).toEqual(eighth)
    expect(first).not.toEqual(seventh)
  })
})

describe('the labeled copy', () => {
  test('draws each tag inside its own picture and nothing over the text', async () => {
    const labeled = await labelSourceDocument(source, analysis.tags, fonts)
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = pdfjs.getDocument({ data: labeled.slice(), verbosity: 0 })
    const document = await task.promise
    const labels: { text: string; page: number; x: number; y: number }[] = []
    const words: { page: number; box: PageBox }[] = []
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number)
      for (const item of (await page.getTextContent()).items) {
        if (!('str' in item) || !item.str.trim()) continue
        const x = (item.transform[4] / W) * 1000
        const y = ((H - item.transform[5]) / H) * 1000
        if (item.str.startsWith('IMG ')) labels.push({ text: item.str, page: number, x, y })
        else
          words.push({
            page: number,
            box: { left: x, top: y - (item.height / H) * 1000, right: x + (item.width / W) * 1000, bottom: y },
          })
      }
    }
    await task.destroy()

    expect(labels.map((label) => label.text)).toEqual(analysis.tags.map((tag) => `IMG ${tag.tag}`))
    for (const [index, label] of labels.entries()) {
      const { page, box } = analysis.tags[index]!
      expect(label.page).toBe(page)
      expect(label.x).toBeGreaterThan(box.left)
      expect(label.x).toBeLessThan(box.left + (box.right - box.left) / 2)
      expect(label.y).toBeGreaterThan(box.top)
      expect(label.y).toBeLessThan(box.top + (box.bottom - box.top) / 2)
    }
    const overlaps = (a: PageBox, b: PageBox) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    expect(words.length).toBeGreaterThan(0)
    for (const word of words)
      for (const tag of analysis.tags.filter((tag) => tag.page === word.page))
        expect(overlaps(word.box, tag.box)).toBe(false)
    // The labels are drawn, not embedded: the copy tags the same pictures.
    expect((await analyzeSourceDocument(labeled)).tags).toEqual(analysis.tags)
  })

  test('says it is labeled in its file name', () => {
    expect(labeledFilename('Unit 3 Test.pdf')).toBe('Unit 3 Test (labeled).pdf')
  })
})

describe('cropping a page', () => {
  test('renders the requested region at print resolution', async () => {
    const png = await cropSourcePage(source, 1, { left: 0, top: 0, right: 500, bottom: 250 }, raster)
    const image = await loadImage(Buffer.from(png))
    expect([image.width, image.height]).toEqual([Math.round((W / 2) * (300 / 72)), Math.round((H / 4) * (300 / 72))])
  })
})

describe('a photo of a test', () => {
  test('becomes a one-page Source Document with nothing to tag, that crops like any page', async () => {
    const photo = picture(300, 400, 4)
    const document = await photoSourceDocument(photo.png, 'image/png')
    const analysis = await analyzeSourceDocument(document)
    expect(analysis).toMatchObject({ pageCount: 1, tags: [] })
    const png = await cropSourcePage(document, 1, { left: 0, top: 0, right: 1000, bottom: 500 }, raster)
    const image = await loadImage(Buffer.from(png))
    // Letter's longest side, at print resolution.
    expect([image.width, image.height]).toEqual([Math.round(594 * (300 / 72)), Math.round(396 * (300 / 72))])
  })
})
