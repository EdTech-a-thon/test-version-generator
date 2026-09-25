import type { MediaAssetDeclaration, PendingImageOccurrence } from './pending-images'
import type { ImageTag } from './source-document'

/**
 * What Resolve Images decides, as data: a picture for each Pending Image it
 * has one for, where the picture came from, and whether the teacher has
 * accepted it. Taking a tag's picture out of a Source Document lives here too,
 * so the import can fill tagged pictures before the step is drawn.
 */

export type PictureOrigin =
  | { kind: 'tag'; tag: number }
  | { kind: 'crop'; page: number }
  | { kind: 'upload'; name: string }

export type ResolvedPicture = {
  asset: MediaAssetDeclaration
  origin: PictureOrigin
  /** Filled but not yet accepted pictures stay Pending Images. */
  accepted: boolean
}

export type Resolutions = ReadonlyMap<string, ResolvedPicture>

/** The Source Document, when the teacher has it here. */
export type ResolvingSource = {
  fileName: string
  bytes: Uint8Array
  pageCount: number
  tags: readonly ImageTag[]
}

/** The accepted pictures, as the import plan takes them. */
export function acceptedPictures(resolutions: Resolutions): Map<string, MediaAssetDeclaration> {
  return new Map([...resolutions].flatMap(([key, { asset, accepted }]) => (accepted ? [[key, asset] as const] : [])))
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

/** Every Pending Image that names a tag the Source Document has, filled with
 *  that tag's picture. Accepted unless the file seemed to come from another
 *  test, in which case the teacher accepts them. */
export async function prefilledPictures(
  occurrences: readonly PendingImageOccurrence[],
  source: ResolvingSource,
  accepted: boolean,
): Promise<Map<string, ResolvedPicture>> {
  const filled = new Map<string, ResolvedPicture>()
  await Promise.all(
    occurrences.map(async ({ key, pending }) => {
      if (!('image' in pending)) return
      const tag = source.tags.find((candidate) => candidate.tag === pending.image)
      if (!tag) return
      try {
        filled.set(key, { asset: await tagPicture(source, tag), origin: { kind: 'tag', tag: tag.tag }, accepted })
      } catch {
        // A picture that cannot be taken is left for the teacher to fill.
      }
    }),
  )
  return filled
}

export const pendingName = (pending: PendingImageOccurrence['pending']) =>
  'image' in pending ? `IMG ${pending.image}` : `page ${pending.page}`


/** Store a picture as a Media Asset here, returning its owned source. */
export async function storedPicture(asset: MediaAssetDeclaration): Promise<string> {
  const { saveImage } = await import('./local-images')
  const bytes = Uint8Array.from(atob(asset.bytes), (character) => character.charCodeAt(0))
  return saveImage(new Blob([bytes], { type: asset.mimeType }))
}
