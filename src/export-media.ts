import type { LayoutPlan } from './export-plan'
import type { ProseMirrorJSON } from './question-doc'

/** One decoded image, ready for an Export Adapter to embed. */
export type ExportImage = {
  data: Uint8Array
  /** The shared browser loader normalizes unsupported package formats to PNG. */
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

async function asPng(bitmap: ImageBitmap): Promise<Uint8Array | null> {
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  const png = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  )
  return png ? new Uint8Array(await png.arrayBuffer()) : null
}

export const browserMedia: MediaLoader = async (src) => {
  try {
    const response = await fetch(src)
    if (!response.ok) return null
    const blob = await response.blob()
    const bitmap = await createImageBitmap(blob)
    const type = IMAGE_TYPES[blob.type.toLowerCase()]
    const data = type
      ? new Uint8Array(await blob.arrayBuffer())
      : await asPng(bitmap)
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
      for (const item of page.items) {
        if (item.kind !== 'question') continue
        for (const block of item.stem) visit(block)
        for (const row of item.grid?.cells ?? []) {
          for (const cell of row) if (cell) visit(cell.node)
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
          )
        ) return item.question.number
      }
    }
  }
  return null
}
