import { PAGE_CONTENT_WIDTH, PAGE_WIDTH } from './export-plan'
import type { MediaAssetDeclaration, PendingImageOccurrence, PendingImageResolution } from './pending-images'
import type { ImageTag, PageBox } from './source-document'

/**
 * What Resolve Images decides, as data: a picture for each Pending Image it
 * has one for, and where the picture came from. Taking a picture out of a
 * Source Document lives here too, so an import can fill tagged pictures before
 * anything is drawn.
 */

export type PictureOrigin =
  | { kind: 'tag'; tag: number }
  | { kind: 'crop'; page: number }
  | { kind: 'upload'; name: string }

export type ResolvedPicture = {
  asset: MediaAssetDeclaration
  origin: PictureOrigin
  /** How much of its page's width the picture took up, 0–1, when it came
   *  from a page — what its size on the test is estimated from. */
  pageShare?: number
}

export type Resolutions = ReadonlyMap<string, ResolvedPicture>

/** The Source Document, when the teacher has it here. */
export type ResolvingSource = {
  /** A Word document, or a PDF (a photo is kept as one). Absent means PDF. */
  kind?: 'pdf' | 'photo' | 'word'
  fileName: string
  bytes: Uint8Array
  pageCount: number
  tags: readonly ImageTag[]
}

/** Whether a Source Document has pages to crop: a Word document has no fixed
 *  pages, so a picture it does not store as an image is uploaded instead. */
export const hasPages = (source: ResolvingSource) => source.kind !== 'word'

const shareOf = (box: PageBox) => Math.max(0, Math.min(1, (box.right - box.left) / 1000))

/**
 * The Authored Image Size that prints a picture about as wide as it was on
 * its own page, or nothing when that is as wide as it fits anyway.
 *
 * A Source Document page is taken to be as wide as the exam's Letter sheet, so
 * a picture a third of the way across its page prints a third of the way
 * across the sheet. The size is a share of what the picture fits its lane at
 * — its own width, or the lane's when it is wider — so that is what it is
 * measured against. Only a picture in a Question's own lane — its stem, a
 * Part's stem, a Suggested Answer — is sized: an answer's cell is narrower by
 * however many columns the Exam gives it, and a picture fitting its cell is
 * already the size the cell allows.
 */
export function estimatedSize(
  picture: ResolvedPicture,
  occurrence: Pick<PendingImageOccurrence, 'where' | 'inPanel'>,
): number | undefined {
  if (picture.pageShare === undefined) return undefined
  if (/Answer [A-Z]|^Item |^Word Bank /.test(occurrence.where)) return undefined
  // A Side-by-Side's pictures share their line, each filling its Panel as they
  // filled their share of the page they came from.
  if (occurrence.inPanel) return undefined
  const printed = picture.pageShare * PAGE_WIDTH
  const fitted = Math.min(picture.asset.width, PAGE_CONTENT_WIDTH)
  const size = Math.round((printed / fitted) * 100) / 100
  return size >= 0.95 ? undefined : Math.max(0.05, size)
}

/** The pictures an import writes, by occurrence key, at their estimated size. */
export function resolutionOf(
  resolutions: Resolutions,
  occurrences: readonly PendingImageOccurrence[],
): PendingImageResolution {
  const resolution = new Map<string, { asset: MediaAssetDeclaration; authoredSize?: number }>()
  for (const occurrence of occurrences) {
    const picture = resolutions.get(occurrence.key)
    if (!picture) continue
    const authoredSize = estimatedSize(picture, occurrence)
    resolution.set(occurrence.key, { asset: picture.asset, ...(authoredSize !== undefined ? { authoredSize } : {}) })
  }
  return resolution
}

const tagPictures = new WeakMap<Uint8Array, Map<number, Promise<MediaAssetDeclaration>>>()

/** A tag's picture, taken once per Source Document however many places use
 *  it — so the same tag is the same Media Asset everywhere. */
export function tagPicture(source: ResolvingSource, tag: ImageTag): Promise<MediaAssetDeclaration> {
  let cache = tagPictures.get(source.bytes)
  if (!cache) tagPictures.set(source.bytes, (cache = new Map()))
  let picture = cache.get(tag.tag)
  if (!picture) {
    picture = (async () => {
      if (!hasPages(source)) {
        const { pictureForWordTag } = await import('./word-document')
        const { bytes, mimeType } = await pictureForWordTag(source.bytes, tag)
        return mediaAssetOfPicture(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mimeType }))
      }
      const [{ pictureForTag, browserRaster }, { mediaAssetOf }] = await Promise.all([
        import('./source-document'),
        import('./pending-images'),
      ])
      return mediaAssetOf(await pictureForTag(source.bytes, tag, browserRaster), 'image/png')
    })()
    cache.set(tag.tag, picture)
    picture.catch(() => cache!.delete(tag.tag))
  }
  return picture
}

/** A tag's picture, as a choice for a Pending Image. */
export async function tagChoice(source: ResolvingSource, tag: ImageTag): Promise<ResolvedPicture> {
  return { asset: await tagPicture(source, tag), origin: { kind: 'tag', tag: tag.tag }, pageShare: shareOf(tag.box) }
}

/** A region of a Source Document page, as a choice for a Pending Image. */
export async function cropChoice(source: ResolvingSource, page: number, box: PageBox): Promise<ResolvedPicture> {
  const [{ cropSourcePage, browserRaster }, { mediaAssetOf }] = await Promise.all([
    import('./source-document'),
    import('./pending-images'),
  ])
  const png = await cropSourcePage(source.bytes, page, box, browserRaster)
  return { asset: await mediaAssetOf(png, 'image/png'), origin: { kind: 'crop', page }, pageShare: shareOf(box) }
}

const SUPPORTED = new Set(['image/png', 'image/jpeg', 'image/webp'])

/** A picture's bytes as a Media Asset: PNG, JPEG and WebP as they are, and
 *  any other picture the browser can draw normalized to PNG. */
async function mediaAssetOfPicture(picture: Blob): Promise<MediaAssetDeclaration> {
  const { mediaAssetOf } = await import('./pending-images')
  const type = picture.type.toLowerCase()
  if (SUPPORTED.has(type)) {
    return mediaAssetOf(new Uint8Array(await picture.arrayBuffer()), type as MediaAssetDeclaration['mimeType'])
  }
  if (!type.startsWith('image/') || type === 'image/svg+xml') throw new Error('Choose a PNG, JPEG or WebP picture.')
  const bitmap = await createImageBitmap(picture)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!png) throw new Error('This picture could not be read.')
    return mediaAssetOf(new Uint8Array(await png.arrayBuffer()), 'image/png')
  } finally {
    bitmap.close()
  }
}

/** An uploaded file, as a choice for a Pending Image. It has no page, so it
 *  arrives at the size it fits. */
export async function uploadChoice(file: File): Promise<ResolvedPicture> {
  return { asset: await mediaAssetOfPicture(file), origin: { kind: 'upload', name: file.name } }
}

/** Every Pending Image that names a tag the Source Document has, filled with
 *  that tag's picture. */
export async function prefilledPictures(
  occurrences: readonly PendingImageOccurrence[],
  source: ResolvingSource,
): Promise<Map<string, ResolvedPicture>> {
  const filled = new Map<string, ResolvedPicture>()
  await Promise.all(
    occurrences.map(async ({ key, pending }) => {
      if (!('image' in pending)) return
      const tag = source.tags.find((candidate) => candidate.tag === pending.image)
      if (!tag) return
      try {
        filled.set(key, await tagChoice(source, tag))
      } catch {
        // A picture that cannot be taken is left for the teacher to fill.
      }
    }),
  )
  return filled
}

/** The other Pending Images naming the same tag as this one: a change to one
 *  is offered to all of them. */
export function sharingTag(
  occurrences: readonly PendingImageOccurrence[],
  occurrence: PendingImageOccurrence,
): PendingImageOccurrence[] {
  const { pending } = occurrence
  if (!('image' in pending)) return []
  return occurrences.filter(
    (other) => other.key !== occurrence.key && 'image' in other.pending && other.pending.image === pending.image,
  )
}

/** Resolutions with one Pending Image — and, when `shared`, every other one
 *  naming its tag — given a picture, or left for later when it is null. */
export function withPicture(
  resolutions: Resolutions,
  occurrences: readonly PendingImageOccurrence[],
  occurrence: PendingImageOccurrence,
  picture: ResolvedPicture | null,
  shared: boolean,
): Resolutions {
  const next = new Map(resolutions)
  for (const { key } of [occurrence, ...(shared ? sharingTag(occurrences, occurrence) : [])]) {
    if (picture) next.set(key, picture)
    else next.delete(key)
  }
  return next
}

export const pendingName = (pending: PendingImageOccurrence['pending']) =>
  'image' in pending ? `IMG ${pending.image}` : `page ${pending.page}`

/** Where a Pending Image sits, as a teacher reads it. */
export const placeName = (occurrence: PendingImageOccurrence) =>
  occurrence.label ?? (occurrence.where === 'Question'
    ? `Question ${occurrence.questionNumber}`
    : `Question ${occurrence.questionNumber}, ${occurrence.where}`)

/** Where a picture came from, as a teacher reads it. */
export function originName(picture: ResolvedPicture, source: ResolvingSource | null): string {
  switch (picture.origin.kind) {
    case 'tag':
      return `IMG ${picture.origin.tag} from ${source?.fileName ?? 'your test'}`
    case 'crop':
      return `Cropped from page ${picture.origin.page}`
    case 'upload':
      return `Uploaded ${picture.origin.name}`
  }
}

export const pictureSource = (asset: MediaAssetDeclaration) => `data:${asset.mimeType};base64,${asset.bytes}`

/** Store a picture as a Media Asset here, returning its owned source. */
export async function storedPicture(asset: MediaAssetDeclaration): Promise<string> {
  const { saveImage } = await import('./local-images')
  const bytes = Uint8Array.from(atob(asset.bytes), (character) => character.charCodeAt(0))
  return saveImage(new Blob([bytes], { type: asset.mimeType }))
}
