import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Crop, ImagePlus, Images, Upload } from 'lucide-react'
import type { MediaAssetDeclaration, PendingImageOccurrence } from './pending-images'
import {
  pendingName,
  tagPicture,
  type ResolvedPicture,
  type Resolutions,
  type ResolvingSource,
} from './resolved-pictures'
import type { ImageTag, PageBox } from './source-document'

/**
 * Resolve Images: the step where a teacher confirms or replaces the picture
 * for each Pending Image — the tagged picture from their Source Document,
 * another of its pictures, a crop of any of its pages, or an uploaded file —
 * or leaves it for later. It ends an import that leaves Pending Images, and is
 * reopened later from a “picture needed” block. It only decides: what it
 * returns is a picture per Pending Image, which the caller writes.
 */

const SUPPORTED = new Set(['image/png', 'image/jpeg', 'image/webp'])

async function uploadedPicture(file: File): Promise<MediaAssetDeclaration> {
  const { mediaAssetOf } = await import('./pending-images')
  const type = file.type.toLowerCase()
  if (SUPPORTED.has(type)) {
    return mediaAssetOf(new Uint8Array(await file.arrayBuffer()), type as MediaAssetDeclaration['mimeType'])
  }
  if (!type.startsWith('image/') || type === 'image/svg+xml') throw new Error('Choose a PNG, JPEG or WebP picture.')
  // Any other picture the browser can draw is normalized to PNG.
  const bitmap = await createImageBitmap(file)
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

const pictureSource = (asset: MediaAssetDeclaration) => `data:${asset.mimeType};base64,${asset.bytes}`

const placeName = (occurrence: PendingImageOccurrence) =>
  occurrence.label ?? (occurrence.where === 'Question'
    ? `Question ${occurrence.questionNumber}`
    : `Question ${occurrence.questionNumber}, ${occurrence.where}`)

function statusOf(occurrence: PendingImageOccurrence, picture: ResolvedPicture | undefined, source: ResolvingSource | null) {
  if (picture) {
    const from =
      picture.origin.kind === 'tag'
        ? `IMG ${picture.origin.tag} from ${source?.fileName ?? 'your PDF'}`
        : picture.origin.kind === 'crop'
          ? `Cropped from page ${picture.origin.page}`
          : `Uploaded ${picture.origin.name}`
    return picture.accepted ? from : `${from} — not accepted yet`
  }
  if ('image' in occurrence.pending && source && !source.tags.some(({ tag }) => tag === (occurrence.pending as { image: number }).image)) {
    return `Picture needed: ${source.fileName} has no IMG ${occurrence.pending.image}`
  }
  return `Picture needed (${pendingName(occurrence.pending)})`
}

/** Which page a picker or a crop opens on: the one the Pending Image names. */
function namedPage(occurrence: PendingImageOccurrence, source: ResolvingSource): number {
  if ('page' in occurrence.pending) return Math.min(source.pageCount, occurrence.pending.page)
  const image = occurrence.pending.image
  return source.tags.find(({ tag }) => tag === image)?.page ?? 1
}

function TagChooser({
  source,
  page,
  onChoose,
}: {
  source: ResolvingSource
  page: number
  onChoose: (tag: ImageTag) => void
}) {
  const [thumbnails, setThumbnails] = useState<ReadonlyMap<number, string>>(new Map())
  useEffect(() => {
    let current = true
    void Promise.all(
      source.tags.map(async (tag) => [tag.tag, pictureSource(await tagPicture(source, tag))] as const),
    ).then((entries) => { if (current) setThumbnails(new Map(entries)) }, () => undefined)
    return () => { current = false }
  }, [source])
  const pages = [...new Set(source.tags.map((tag) => tag.page))].sort((a, b) =>
    a === page ? -1 : b === page ? 1 : a - b,
  )
  if (pages.length === 0) return <p className="resolve-image-note">{source.fileName} has no tagged pictures. Crop one from a page instead.</p>
  return <div className="resolve-image-chooser" role="group" aria-label={`Pictures in ${source.fileName}`}>
    {pages.map((number) => (
      <section key={number}>
        <h5>Page {number}</h5>
        <div>
          {source.tags.filter((tag) => tag.page === number).map((tag) => (
            <button key={tag.tag} type="button" aria-label={`Use IMG ${tag.tag}`} onClick={() => onChoose(tag)}>
              {thumbnails.get(tag.tag) ? <img src={thumbnails.get(tag.tag)} alt="" /> : <span className="resolve-image-thumb-loading" />}
              <span>IMG {tag.tag}</span>
            </button>
          ))}
        </div>
      </section>
    ))}
  </div>
}

function PageCropper({
  source,
  startPage,
  onCrop,
  onCancel,
}: {
  source: ResolvingSource
  startPage: number
  onCrop: (page: number, box: PageBox) => void
  onCancel: () => void
}) {
  const [page, setPage] = useState(startPage)
  const [image, setImage] = useState<string | null>(null)
  const [box, setBox] = useState<PageBox | null>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let current = true
    setImage(null)
    setBox(null)
    void import('./source-document')
      .then(({ renderSourcePage, browserRaster }) => renderSourcePage(source.bytes, page, browserRaster))
      .then((png) => {
        if (!current) return
        const blob = new Blob([png.slice().buffer as ArrayBuffer], { type: 'image/png' })
        setImage(URL.createObjectURL(blob))
      }, () => undefined)
    return () => { current = false }
  }, [source, page])
  useEffect(() => () => { if (image) URL.revokeObjectURL(image) }, [image])

  const at = (event: ReactPointerEvent) => {
    const rect = frame.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1000, ((event.clientX - rect.left) / rect.width) * 1000)),
      y: Math.max(0, Math.min(1000, ((event.clientY - rect.top) / rect.height) * 1000)),
    }
  }
  const extend = (event: ReactPointerEvent) => {
    if (!drag.current) return
    const point = at(event)
    setBox({
      left: Math.min(drag.current.x, point.x),
      right: Math.max(drag.current.x, point.x),
      top: Math.min(drag.current.y, point.y),
      bottom: Math.max(drag.current.y, point.y),
    })
  }
  const usable = box && box.right - box.left > 5 && box.bottom - box.top > 5
  return <div className="resolve-image-cropper" role="group" aria-label="Crop a picture from a page">
    <div className="resolve-image-cropper-bar">
      <button type="button" className="secondary-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous page</button>
      <span>Page {page} of {source.pageCount}</span>
      <button type="button" className="secondary-button" disabled={page >= source.pageCount} onClick={() => setPage(page + 1)}>Next page</button>
    </div>
    <p className="resolve-image-note">Drag a box around the picture.</p>
    <div
      ref={frame}
      className="resolve-image-page"
      aria-label={`Page ${page}`}
      role="img"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = at(event)
        setBox(null)
      }}
      onPointerMove={extend}
      onPointerUp={(event) => { extend(event); drag.current = null }}
    >
      {image ? <img src={image} alt="" draggable={false} /> : <p role="status">Rendering page {page}…</p>}
      {box && <span
        className="resolve-image-box"
        style={{
          left: `${box.left / 10}%`,
          top: `${box.top / 10}%`,
          width: `${(box.right - box.left) / 10}%`,
          height: `${(box.bottom - box.top) / 10}%`,
        }}
      />}
    </div>
    <div className="resolve-image-cropper-bar">
      <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
      <button type="button" className="secondary-button" onClick={() => onCrop(page, { left: 0, top: 0, right: 1000, bottom: 1000 })}>Use the whole page</button>
      <button type="button" className="primary-button" disabled={!usable} onClick={() => box && onCrop(page, box)}>Use this crop</button>
    </div>
  </div>
}

type Panel = { key: string; kind: 'choose' | 'crop' } | null

export function ResolveImages({
  occurrences,
  source,
  resolutions,
  onChange,
  onSourceFile,
  filling = false,
}: {
  occurrences: readonly PendingImageOccurrence[]
  source: ResolvingSource | null
  resolutions: Resolutions
  onChange: (next: Resolutions) => void
  /** Offered when there is no Source Document: the teacher drops it again to
   *  take pictures from it. */
  onSourceFile?: (file: File) => void
  /** Whether tagged pictures are still being taken from the document. */
  filling?: boolean
}) {
  const [panel, setPanel] = useState<Panel>(null)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [shareAll, setShareAll] = useState<Record<string, boolean>>({})

  /** The places a change to one Pending Image offers to change with it: the
   *  others naming the same tag. */
  const sharing = (occurrence: PendingImageOccurrence) =>
    'image' in occurrence.pending
      ? occurrences.filter(
          (other) => other.key !== occurrence.key && 'image' in other.pending && other.pending.image === (occurrence.pending as { image: number }).image,
        )
      : []

  const set = (occurrence: PendingImageOccurrence, picture: ResolvedPicture | null) => {
    const next = new Map(resolutions)
    const keys = [occurrence.key, ...((shareAll[occurrence.key] ?? true) ? sharing(occurrence).map(({ key }) => key) : [])]
    for (const key of keys) {
      if (picture) next.set(key, picture)
      else next.delete(key)
    }
    onChange(next)
  }

  const run = async (occurrence: PendingImageOccurrence, make: () => Promise<ResolvedPicture>) => {
    setError(null)
    setWorking(occurrence.key)
    try {
      set(occurrence, await make())
      setPanel(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That picture could not be used.')
    } finally {
      setWorking(null)
    }
  }

  const filled = occurrences.filter(({ key }) => resolutions.has(key))
  const acceptedCount = filled.filter(({ key }) => resolutions.get(key)!.accepted).length
  const unaccepted = filled.length - acceptedCount

  return <section className="resolve-images" aria-labelledby="resolve-images-heading">
    <header className="resolve-images-head">
      <div>
        <h3 id="resolve-images-heading">Resolve Images</h3>
        <p role="status">
          {filling
            ? 'Taking pictures from your PDF…'
            : `${acceptedCount} of ${occurrences.length} ${occurrences.length === 1 ? 'picture' : 'pictures'} ready.`}
          {' '}Any left unresolved stay as “picture needed” and can be added later.
        </p>
      </div>
      <button
        type="button"
        className="secondary-button"
        disabled={unaccepted === 0}
        onClick={() => onChange(new Map([...resolutions].map(([key, picture]) => [key, { ...picture, accepted: true }])))}
      >
        Accept all
      </button>
    </header>
    {!source && onSourceFile && (
      <label className="resolve-images-source">
        <ImagePlus aria-hidden="true" />
        <span>Drop your original PDF here to take pictures from it, or upload each picture below.</span>
        <input
          type="file"
          accept="application/pdf,.pdf"
          aria-label="Your original PDF"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) onSourceFile(file)
          }}
        />
      </label>
    )}
    {error && <p className="home-error" role="alert">{error}</p>}
    <ol className="resolve-images-list">
      {occurrences.map((occurrence) => {
        const picture = resolutions.get(occurrence.key)
        const others = sharing(occurrence)
        const name = placeName(occurrence)
        const open = panel?.key === occurrence.key ? panel.kind : null
        return <li key={occurrence.key} className="resolve-image" aria-label={name} data-accepted={picture?.accepted ? 'true' : undefined}>
          <div className="resolve-image-picture">
            {picture
              ? <img src={pictureSource(picture.asset)} alt={occurrence.alt ?? `Picture for ${name}`} />
              : <span className="picture-needed">Picture needed<small>{pendingName(occurrence.pending)}</small></span>}
          </div>
          <div className="resolve-image-body">
            <h4>{name}</h4>
            {(occurrence.caption || occurrence.alt) && <p className="resolve-image-description">{occurrence.caption || occurrence.alt}</p>}
            <p className="resolve-image-status">{working === occurrence.key ? 'Working…' : statusOf(occurrence, picture, source)}</p>
            {others.length > 0 && (
              <label className="resolve-image-share">
                <input
                  type="checkbox"
                  checked={shareAll[occurrence.key] ?? true}
                  onChange={(event) => setShareAll({ ...shareAll, [occurrence.key]: event.target.checked })}
                />
                <span>Change the {others.length === 1 ? 'other place' : `${others.length} other places`} that {others.length === 1 ? 'uses' : 'use'} {pendingName(occurrence.pending)} too</span>
              </label>
            )}
            <div className="resolve-image-actions">
              {picture && !picture.accepted && (
                <button type="button" className="primary-button" onClick={() => set(occurrence, { ...picture, accepted: true })}>Accept</button>
              )}
              {source && source.tags.length > 0 && (
                <button type="button" className="secondary-button" aria-expanded={open === 'choose'} onClick={() => setPanel(open === 'choose' ? null : { key: occurrence.key, kind: 'choose' })}>
                  <Images aria-hidden="true" />{picture ? 'Choose another picture' : 'Choose a picture'}
                </button>
              )}
              {source && (
                <button type="button" className="secondary-button" aria-expanded={open === 'crop'} onClick={() => setPanel(open === 'crop' ? null : { key: occurrence.key, kind: 'crop' })}>
                  <Crop aria-hidden="true" />Crop from a page
                </button>
              )}
              <label className="secondary-button resolve-image-upload">
                <Upload aria-hidden="true" />Upload a file
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/*"
                  aria-label={`Upload a picture for ${name}`}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) void run(occurrence, async () => ({ asset: await uploadedPicture(file), origin: { kind: 'upload', name: file.name }, accepted: true }))
                  }}
                />
              </label>
              {picture && (
                <button type="button" className="secondary-button" onClick={() => set(occurrence, null)}>Leave for later</button>
              )}
            </div>
            {open === 'choose' && source && (
              <TagChooser
                source={source}
                page={namedPage(occurrence, source)}
                onChoose={(tag) => void run(occurrence, async () => ({ asset: await tagPicture(source, tag), origin: { kind: 'tag', tag: tag.tag }, accepted: true }))}
              />
            )}
            {open === 'crop' && source && (
              <PageCropper
                source={source}
                startPage={namedPage(occurrence, source)}
                onCancel={() => setPanel(null)}
                onCrop={(page, box) => void run(occurrence, async () => {
                  const [{ cropSourcePage, browserRaster }, { mediaAssetOf }] = await Promise.all([
                    import('./source-document'),
                    import('./pending-images'),
                  ])
                  const png = await cropSourcePage(source.bytes, page, box, browserRaster)
                  return { asset: await mediaAssetOf(png, 'image/png'), origin: { kind: 'crop', page }, accepted: true }
                })}
              />
            )}
          </div>
        </li>
      })}
    </ol>
  </section>
}
