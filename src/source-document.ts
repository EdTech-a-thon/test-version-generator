import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb } from 'pdf-lib'
import type { PdfFontLoader } from './pdf-export'

/**
 * A Source Document is the teacher's own PDF, the test an assistant converts.
 * This module is the one place that reads one for pictures: it finds every
 * image painted on its pages and numbers the picture-sized ones as Image Tags,
 * prints those tags on a labeled copy for the assistant, and gives back the
 * picture a tag names — or a crop of any page — as PNG bytes for Resolve
 * Images. It never reads Question Content out of the document: that comes only
 * from the record the assistant writes (ADR-0024).
 *
 * Tagging is a pure function of the PDF's bytes, so the same PDF dropped again
 * later gets the same tags, and an assistant's numbers still point at the
 * right pictures.
 */

/** A region of a page on a 0–1000 scale of its width and height, measured
 *  from the top-left corner the way a reader sees the page. */
export type PageBox = { left: number; top: number; right: number; bottom: number }

export type ImageTag = {
  /** The number printed on the labeled copy: “IMG 3” is tag 3. */
  tag: number
  /** 1-based, as a PDF viewer counts pages. */
  page: number
  box: PageBox
  /** The embedded image's intrinsic pixel size. */
  width: number
  height: number
}

export type SourceDocumentAnalysis = {
  pageCount: number
  tags: ImageTag[]
  /** Each page's text, in page order, for checking that a record came from
   *  this document. Empty strings when the document has no text layer. */
  pageText: string[]
}

export type RgbaImage = { width: number; height: number; data: Uint8ClampedArray }

type Context2D = {
  fillStyle: unknown
  fillRect(x: number, y: number, width: number, height: number): void
  getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray }
}

/**
 * What turning pixels into PNG bytes takes, injected so the module runs the
 * same in the browser, which has a canvas, and in tests, which bring their
 * own. `createCanvas` backs page rendering for crops.
 */
export type Raster = {
  encodePng(image: RgbaImage): Promise<Uint8Array>
  createCanvas(width: number, height: number): {
    getContext(kind: '2d'): Context2D | null
  }
}

export class SourceDocumentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SourceDocumentError'
  }
}

/** An image narrower than this share of the page, or shorter than its height
 *  share, is an equation, a bullet or a caption stored as a picture. */
const MIN_WIDTH = 60
const MIN_HEIGHT = 40
/** An image covering this share of the page or more is a scanned page. */
const FULL_PAGE = 0.7
/** Images whose tops are this close share a row of the page. */
const ROW_TOLERANCE = 40
/** Crops are rendered for print. */
const CROP_DPI = 300
const MAX_CROP_SIDE = 8000

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
type PdfPage = Awaited<ReturnType<Awaited<ReturnType<Pdfjs['getDocument']>['promise']>['getPage']>>
type Matrix = [number, number, number, number, number, number]

async function pdfjsLibrary(): Promise<Pdfjs> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  if (typeof document !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
      import.meta.url,
    ).href
  }
  return pdfjs
}

async function withDocument<T>(
  bytes: Uint8Array,
  read: (document: Awaited<ReturnType<Pdfjs['getDocument']>['promise']>, pdfjs: Pdfjs) => Promise<T>,
): Promise<T> {
  const pdfjs = await pdfjsLibrary()
  // Decoded pixels, never a browser bitmap: a picture has to come back as
  // bytes the same way in every environment.
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    verbosity: 0,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
  })
  let document: Awaited<typeof task.promise>
  try {
    document = await task.promise
  } catch {
    throw new SourceDocumentError('This file is not a PDF Test Parrot can read.')
  }
  try {
    return await read(document, pdfjs)
  } finally {
    await task.destroy()
  }
}

const multiply = (a: Matrix, b: readonly number[]): Matrix => [
  a[0] * b[0]! + a[2] * b[1]!,
  a[1] * b[0]! + a[3] * b[1]!,
  a[0] * b[2]! + a[2] * b[3]!,
  a[1] * b[2]! + a[3] * b[3]!,
  a[0] * b[4]! + a[2] * b[5]! + a[4],
  a[1] * b[4]! + a[3] * b[5]! + a[5],
]

type Placement = { box: PageBox; object: string | { width: number; height: number; kind?: number; data?: Uint8ClampedArray } }

/** Every image painted on a page, in paint order, where it lands. */
async function placementsOf(page: PdfPage, pdfjs: Pdfjs): Promise<Placement[]> {
  const viewport = page.getViewport({ scale: 1 })
  const operators = await page.getOperatorList()
  const OPS = pdfjs.OPS
  const placements: Placement[] = []
  let ctm: Matrix = [1, 0, 0, 1, 0, 0]
  const stack: Matrix[] = []
  const place = (matrix: Matrix, object: Placement['object']) => {
    const corners = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ].map(([u, v]) =>
      viewport.convertToViewportPoint(
        matrix[0] * u! + matrix[2] * v! + matrix[4],
        matrix[1] * u! + matrix[3] * v! + matrix[5],
      ),
    )
    const xs = corners.map((point) => point[0]! / viewport.width * 1000)
    const ys = corners.map((point) => point[1]! / viewport.height * 1000)
    placements.push({
      box: {
        left: Math.min(...xs),
        top: Math.min(...ys),
        right: Math.max(...xs),
        bottom: Math.max(...ys),
      },
      object,
    })
  }
  for (let index = 0; index < operators.fnArray.length; index += 1) {
    const operator = operators.fnArray[index]
    const args = operators.argsArray[index] as unknown[]
    if (operator === OPS.save) stack.push(ctm)
    else if (operator === OPS.restore) ctm = stack.pop() ?? ctm
    else if (operator === OPS.transform) ctm = multiply(ctm, args as number[])
    else if (operator === OPS.paintFormXObjectBegin) {
      stack.push(ctm)
      if (Array.isArray(args[0])) ctm = multiply(ctm, args[0] as number[])
    } else if (operator === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm
    else if (operator === OPS.paintImageXObject) place(ctm, args[0] as string)
    else if (operator === OPS.paintInlineImageXObject) place(ctm, args[0] as Placement['object'] & object)
    else if (operator === OPS.paintImageXObjectRepeat) {
      const [object, scaleX, scaleY, positions] = args as [string, number, number, number[]]
      for (let at = 0; at < positions.length; at += 2) {
        place(multiply(ctm, [scaleX, 0, 0, scaleY, positions[at]!, positions[at + 1]!]), object)
      }
    }
  }
  return placements
}

type DecodedImage = { width: number; height: number; kind?: number; data?: Uint8ClampedArray }

function resolveObject(page: PdfPage, object: Placement['object']): Promise<DecodedImage> {
  if (typeof object !== 'string') return Promise.resolve(object)
  const objects = object.startsWith('g_') ? page.commonObjs : page.objs
  return new Promise((resolve) => objects.get(object, (value: DecodedImage) => resolve(value)))
}

async function intrinsicSize(page: PdfPage, object: Placement['object']) {
  const image = await resolveObject(page, object)
  return { width: image?.width ?? 0, height: image?.height ?? 0 }
}

/** Whether a placement is a picture rather than an equation or a scan. */
function isPicture(box: PageBox): boolean {
  const width = box.right - box.left
  const height = box.bottom - box.top
  if (width < MIN_WIDTH || height < MIN_HEIGHT) return false
  return (width * height) / 1_000_000 < FULL_PAGE
}

/** Rows top to bottom, each read left to right: a row is every picture whose
 *  top is within the tolerance of the row's first. */
function readingOrder<T extends { box: PageBox }>(pictures: T[]): T[] {
  const byTop = [...pictures].sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left)
  const rows: T[][] = []
  for (const picture of byTop) {
    const row = rows.at(-1)
    if (row && picture.box.top - row[0]!.box.top <= ROW_TOLERANCE) row.push(picture)
    else rows.push([picture])
  }
  return rows.flatMap((row) => row.sort((a, b) => a.box.left - b.box.left))
}

const round = (value: number) => Math.round(value * 100) / 100

async function pagePictures(page: PdfPage, pdfjs: Pdfjs) {
  const pictures = (await placementsOf(page, pdfjs)).filter((placement) => isPicture(placement.box))
  return readingOrder(pictures)
}

export async function analyzeSourceDocument(bytes: Uint8Array): Promise<SourceDocumentAnalysis> {
  return withDocument(bytes, async (document, pdfjs) => {
    const tags: ImageTag[] = []
    const pageText: string[] = []
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number)
      for (const picture of await pagePictures(page, pdfjs)) {
        tags.push({
          tag: tags.length + 1,
          page: number,
          box: {
            left: round(picture.box.left),
            top: round(picture.box.top),
            right: round(picture.box.right),
            bottom: round(picture.box.bottom),
          },
          ...(await intrinsicSize(page, picture.object)),
        })
      }
      const text = await page.getTextContent()
      pageText.push(
        text.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      )
    }
    return { pageCount: document.numPages, tags, pageText }
  })
}

const TAG_FILL = rgb(0.82, 0.08, 0.12)
const TAG_TEXT = rgb(1, 1, 1)
const TAG_SIZE = 10
const TAG_PAD = 2.5
const TAG_INSET = 2

/**
 * The labeled copy: the original PDF with each tag drawn as a filled red
 * “IMG n” label inside its picture's top-left corner. Nothing is drawn outside
 * a picture, so no tag can cover a question's words; the corner it covers is
 * harmless, because a picture is always taken from the original.
 */
export async function labelSourceDocument(
  bytes: Uint8Array,
  tags: readonly ImageTag[],
  fonts: PdfFontLoader,
): Promise<Uint8Array> {
  let pdf: PDFDocument
  try {
    pdf = await PDFDocument.load(bytes, { updateMetadata: false })
  } catch {
    throw new SourceDocumentError('This PDF could not be labeled. It may be protected or damaged.')
  }
  pdf.registerFontkit(fontkit)
  const font = await pdf.embedFont(await fonts('bold'), { subset: true })
  for (const tag of tags) {
    const page = pdf.getPage(tag.page - 1)
    const view = page.getCropBox()
    const x0 = view.x + (tag.box.left / 1000) * view.width
    const x1 = view.x + (tag.box.right / 1000) * view.width
    const yTop = view.y + view.height - (tag.box.top / 1000) * view.height
    const yBottom = view.y + view.height - (tag.box.bottom / 1000) * view.height
    const label = `IMG ${tag.tag}`
    // A small picture gets a smaller label rather than one that spills out.
    const room = Math.min(
      (x1 - x0 - TAG_INSET * 2) / (font.widthOfTextAtSize(label, TAG_SIZE) + TAG_PAD * 2),
      (yTop - yBottom - TAG_INSET * 2) / (TAG_SIZE + TAG_PAD * 2),
    )
    const scale = Math.min(1, room)
    if (scale <= 0) continue
    const size = TAG_SIZE * scale
    const pad = TAG_PAD * scale
    const width = font.widthOfTextAtSize(label, size) + pad * 2
    const height = size + pad * 2
    const y = yTop - TAG_INSET - height
    page.drawRectangle({ x: x0 + TAG_INSET, y, width, height, color: TAG_FILL })
    page.drawText(label, { x: x0 + TAG_INSET + pad, y: y + pad + size * 0.18, size, font, color: TAG_TEXT })
  }
  return pdf.save()
}

/** The longest side a photo's page is given, in points: a Letter page's. */
const PHOTO_PAGE = 792

/**
 * A photo of a test, as a one-page Source Document. Nothing in a photo can
 * be tagged — the whole photo is one picture — so an assistant names each
 * picture by page 1, and Resolve Images crops it from this page. Keeping the
 * photo as a PDF lets it be cropped exactly as a PDF's page is.
 */
export async function photoSourceDocument(
  bytes: Uint8Array,
  mimeType: 'image/png' | 'image/jpeg',
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  let image
  try {
    image = mimeType === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
  } catch {
    throw new SourceDocumentError('This picture could not be read.')
  }
  const scale = PHOTO_PAGE / Math.max(image.width, image.height)
  const width = image.width * scale
  const height = image.height * scale
  pdf.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height })
  return pdf.save()
}

/** The labeled copy's file name: the original's, saying it is labeled. */
export function labeledFilename(name: string): string {
  const stem = name.replace(/\.pdf$/i, '') || 'source'
  return `${stem} (labeled).pdf`
}

function toRgba(image: DecodedImage): RgbaImage {
  const { width, height, kind, data } = image
  if (!data) throw new SourceDocumentError('This picture could not be read from the PDF.')
  const pixels = width * height
  if (kind === 3 || data.length === pixels * 4) {
    return { width, height, data: new Uint8ClampedArray(data) }
  }
  const out = new Uint8ClampedArray(pixels * 4)
  if (kind === 2 || data.length === pixels * 3) {
    for (let i = 0; i < pixels; i += 1) {
      out[i * 4] = data[i * 3]!
      out[i * 4 + 1] = data[i * 3 + 1]!
      out[i * 4 + 2] = data[i * 3 + 2]!
      out[i * 4 + 3] = 255
    }
    return { width, height, data: out }
  }
  // One bit per pixel, each row padded to a whole byte; a set bit is white.
  const rowBytes = (width + 7) >> 3
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const on = (data[y * rowBytes + (x >> 3)]! >> (7 - (x & 7))) & 1
      const value = on ? 255 : 0
      const at = (y * width + x) * 4
      out[at] = out[at + 1] = out[at + 2] = value
      out[at + 3] = 255
    }
  }
  return { width, height, data: out }
}

const distance = (a: PageBox, b: PageBox) =>
  Math.abs(a.left - b.left) + Math.abs(a.top - b.top) + Math.abs(a.right - b.right) + Math.abs(a.bottom - b.bottom)

/** The picture a tag names, at its embedded image's full resolution, as PNG. */
export async function pictureForTag(
  bytes: Uint8Array,
  tag: ImageTag,
  raster: Pick<Raster, 'encodePng'>,
): Promise<Uint8Array> {
  const image = await withDocument(bytes, async (document, pdfjs) => {
    if (tag.page < 1 || tag.page > document.numPages) {
      throw new SourceDocumentError(`This PDF has no page ${tag.page}.`)
    }
    const page = await document.getPage(tag.page)
    const pictures = await pagePictures(page, pdfjs)
    const nearest = pictures
      .map((picture) => ({ picture, off: distance(picture.box, tag.box) }))
      .sort((a, b) => a.off - b.off)[0]
    if (!nearest || nearest.off > 4) {
      throw new SourceDocumentError(`IMG ${tag.tag} is not in this PDF.`)
    }
    return toRgba(await resolveObject(page, nearest.picture.object))
  })
  return raster.encodePng(image)
}

type PageScale = (base: { width: number; height: number }) => number

async function renderRegion(
  bytes: Uint8Array,
  pageNumber: number,
  box: PageBox,
  raster: Raster,
  scaleFor: PageScale,
): Promise<Uint8Array> {
  const image = await withDocument(bytes, async (document) => {
    if (pageNumber < 1 || pageNumber > document.numPages) {
      throw new SourceDocumentError(`This PDF has no page ${pageNumber}.`)
    }
    const page = await document.getPage(pageNumber)
    const viewport = page.getViewport({ scale: scaleFor(page.getViewport({ scale: 1 })) })
    const left = Math.max(0, Math.min(box.left, box.right))
    const right = Math.min(1000, Math.max(box.left, box.right))
    const top = Math.max(0, Math.min(box.top, box.bottom))
    const bottom = Math.min(1000, Math.max(box.top, box.bottom))
    const x = Math.round((left / 1000) * viewport.width)
    const y = Math.round((top / 1000) * viewport.height)
    const width = Math.max(1, Math.round(((right - left) / 1000) * viewport.width))
    const height = Math.max(1, Math.round(((bottom - top) / 1000) * viewport.height))
    const canvas = raster.createCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) throw new SourceDocumentError('This browser cannot render PDF pages.')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
      transform: [1, 0, 0, 1, -x, -y],
    }).promise
    return { width, height, data: new Uint8ClampedArray(context.getImageData(0, 0, width, height).data) }
  })
  return raster.encodePng(image)
}

/** A region of a page rendered at print resolution, as PNG — for a picture
 *  drawn with lines, on a scan, or anywhere a tag does not cover. */
export function cropSourcePage(
  bytes: Uint8Array,
  pageNumber: number,
  box: PageBox,
  raster: Raster,
): Promise<Uint8Array> {
  return renderRegion(bytes, pageNumber, box, raster, (base) =>
    (CROP_DPI / 72) * Math.min(1, MAX_CROP_SIDE / (Math.max(base.width, base.height) * (CROP_DPI / 72))),
  )
}

/** A whole page at screen size, for choosing where to crop. */
export function renderSourcePage(
  bytes: Uint8Array,
  pageNumber: number,
  raster: Raster,
  width = 900,
): Promise<Uint8Array> {
  return renderRegion(bytes, pageNumber, { left: 0, top: 0, right: 1000, bottom: 1000 }, raster, (base) => width / base.width)
}

/** The browser's raster: a canvas encodes, and renders pages. */
export const browserRaster: Raster = {
  createCanvas(width, height) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas as unknown as ReturnType<Raster['createCanvas']>
  },
  async encodePng(image) {
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) throw new SourceDocumentError('This browser cannot encode pictures.')
    context.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new SourceDocumentError('This browser cannot encode pictures.')
    return new Uint8Array(await blob.arrayBuffer())
  },
}
