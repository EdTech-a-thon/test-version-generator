import type { LayoutPlan } from './export-plan'
import type { ProseMirrorJSON } from './question-doc'

/** One decoded image, ready for an Export Adapter to embed. */
export type ExportImage = {
  data: Uint8Array
  /** The shared browser loader normalizes unsupported package formats to PNG,
   *  and a camera JPEG stored turned to upright pixels. */
  type: 'png' | 'jpg'
  width: number
  height: number
}

/** Resolves a Media Asset reference into printable image bytes. */
export type MediaLoader = (src: string) => Promise<ExportImage | null>

export class RequiredMediaError extends Error {
  constructor(questionNumber: number | null) {
    super(
      `Required media for question ${questionNumber ?? 'unknown'} could not be resolved. `
      + 'Re-add the image and try again.',
    )
    this.name = 'RequiredMediaError'
  }
}

export function isRequiredMediaError(error: unknown): error is RequiredMediaError {
  return error instanceof RequiredMediaError
}

const IMAGE_TYPES: Record<string, ExportImage['type']> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
}

async function encoded(bitmap: ImageBitmap, mime: 'image/png' | 'image/jpeg'): Promise<Uint8Array | null> {
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mime, 0.92),
  )
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null
}

// A camera JPEG's EXIF Orientation: 1 (as stored) through 8, per the EXIF
// standard's TIFF tag 0x0112. A phone held upright usually stores its pixels
// sideways and says 6, "turn a quarter clockwise to view". A browser honours
// that, both when it draws the picture and when `createImageBitmap` measures
// it, but PDF and Word embed the stored pixels as they are.
export function jpegOrientation(data: Uint8Array): number {
  if (data[0] !== 0xff || data[1] !== 0xd8) return 1
  let offset = 2
  while (offset + 4 <= data.length && data[offset] === 0xff) {
    const marker = data[offset + 1]!
    // Metadata segments all come before the scan.
    if (marker === 0xda || marker === 0xd9) return 1
    const length = (data[offset + 2]! << 8) | data[offset + 3]!
    const body = data.subarray(offset + 4, offset + 2 + length)
    const isExif = marker === 0xe1 && body.length >= 14
      && String.fromCharCode(body[0]!, body[1]!, body[2]!, body[3]!, body[4]!, body[5]!) === 'Exif\0\0'
    if (isExif) return tiffOrientation(body.subarray(6))
    offset += 2 + length
  }
  return 1
}

function tiffOrientation(tiff: Uint8Array): number {
  const order = String.fromCharCode(tiff[0]!, tiff[1]!)
  if (order !== 'II' && order !== 'MM') return 1
  const little = order === 'II'
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength)
  const ifd = view.getUint32(4, little)
  if (ifd + 2 > tiff.length) return 1
  const entries = view.getUint16(ifd, little)
  for (let index = 0; index < entries; index += 1) {
    const entry = ifd + 2 + index * 12
    if (entry + 12 > tiff.length) return 1
    if (view.getUint16(entry, little) !== 0x0112) continue
    const value = view.getUint16(entry + 8, little)
    return value >= 1 && value <= 8 ? value : 1
  }
  return 1
}

export const browserMedia: MediaLoader = async (src) => {
  try {
    const response = await fetch(src)
    if (!response.ok) return null
    const blob = await response.blob()
    const bitmap = await createImageBitmap(blob)
    const type = IMAGE_TYPES[blob.type.toLowerCase()]
    const bytes = new Uint8Array(await blob.arrayBuffer())
    // The bitmap is already turned upright and measured that way; a JPEG that
    // is stored turned is re-encoded from it, so the pixels an adapter embeds
    // are the ones these dimensions describe.
    const turned = type === 'jpg' && jpegOrientation(bytes) !== 1
    const data = !type
      ? await encoded(bitmap, 'image/png')
      : turned
        ? await encoded(bitmap, 'image/jpeg')
        : bytes
    const image = data
      ? {
          data,
          type: type ?? ('png' as const),
          width: bitmap.width,
          height: bitmap.height,
        }
      : null
    bitmap.close()
    return image
  } catch {
    return null
  }
}

// How big a teacher made a picture.
//
// Crepe's image block records a drag of its resize handle as `ratio`: the size
// the picture was left at, over the size it fits its column at (its natural
// size, or the column's width when it is wider than that). Both dimensions
// scale by it, so `0.5` is "half the size it fit at", `1` is untouched, and a
// picture can be dragged larger than it fit as well as smaller.
//
// Every surface that draws the picture has to agree on what that means, or the
// exam page paginates one size and prints another: `doc-view.tsx` says it in
// CSS, and the PDF and Word adapters say it through `authoredImageWidth`.
export function authoredImageRatio(attrs: Record<string, unknown>): number {
  const ratio = Number(attrs.ratio)
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1
}

/** The width a picture prints at inside a column: the size it fits the column
 *  at, scaled by its ratio — but never wider than the column, however far it
 *  was dragged. Height follows from the picture's own proportions. */
export function authoredImageWidth(
  naturalWidth: number,
  columnWidth: number,
  ratio: number,
): number {
  return Math.min(naturalWidth * ratio, columnWidth * Math.min(1, ratio))
}

function attrsOf(node: ProseMirrorJSON): Record<string, unknown> {
  return typeof node.attrs === 'object' && node.attrs !== null
    ? (node.attrs as Record<string, unknown>)
    : {}
}

function childrenOf(node: ProseMirrorJSON): ProseMirrorJSON[] {
  return Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []
}

/** Every image source the plans refer to, in first-appearance order. */
export function imageSourcesOf(plans: readonly LayoutPlan[]): string[] {
  const sources: string[] = []
  const seen = new Set<string>()
  const visit = (node: ProseMirrorJSON) => {
    if (node.type === 'image' || node.type === 'image-block') {
      const src = String(attrsOf(node).src ?? '')
      if (src && !seen.has(src)) {
        seen.add(src)
        sources.push(src)
      }
    }
    for (const child of childrenOf(node)) visit(child)
  }
  for (const plan of plans) {
    for (const page of plan.pages) {
      // An Exam's own header may carry images too — a school's logo.
      for (const block of page.furniture.customHeader?.content ?? []) visit(block)
      for (const item of page.items) {
        if (item.kind !== 'question') continue
        for (const block of item.stem) visit(block)
        for (const row of item.grid?.cells ?? []) {
          for (const cell of row) if (cell) visit(cell.node)
        }
        for (const part of item.parts ?? []) {
          for (const block of part.stem) visit(block)
          for (const row of part.grid?.cells ?? []) {
            for (const cell of row) if (cell) visit(cell.node)
          }
        }
      }
    }
  }
  return sources
}

export async function loadExportImages(
  plans: readonly LayoutPlan[],
  media: MediaLoader,
): Promise<Map<string, ExportImage>> {
  const sources = imageSourcesOf(plans)
  const loaded = await Promise.all(sources.map((src) => media(src)))
  return new Map(
    sources.flatMap((src, index) => {
      const image = loaded[index]
      return image ? [[src, image] as const] : []
    }),
  )
}

function nodeContainsSource(node: ProseMirrorJSON, source: string): boolean {
  const attrs = attrsOf(node)
  if (
    (node.type === 'image' || node.type === 'image-block')
    && String(attrs.src ?? '') === source
  ) return true
  return childrenOf(node).some((child) => nodeContainsSource(child, source))
}

export function questionNumberForMedia(
  plans: readonly LayoutPlan[],
  source: string,
): number | null {
  for (const plan of plans) {
    for (const page of plan.pages) {
      for (const item of page.items) {
        if (
          item.kind === 'question'
          && (
            item.stem.some((node) => nodeContainsSource(node, source))
            || (item.grid?.cells.flat().some(
              (cell) => cell && nodeContainsSource(cell.node, source),
            ) ?? false)
            || (item.parts ?? []).some((part) =>
              part.stem.some((node) => nodeContainsSource(node, source))
              || (part.grid?.cells.flat().some(
                (cell) => cell && nodeContainsSource(cell.node, source),
              ) ?? false))
          )
        ) return item.question.number
      }
    }
  }
  return null
}
