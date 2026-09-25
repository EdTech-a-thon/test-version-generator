import { saveWaitingImport, type WaitingImport } from './waiting-import'

/**
 * What a teacher dropped to start converting a test, and the import that
 * waits on it. A PDF is its own Source Document. A photo becomes a one-page
 * one, so its pictures can be cropped from it after importing. Anything else
 * a test might be saved as is answered with how to make it one of those.
 */

export type DroppedFile = 'record' | 'pdf' | 'photo' | 'other'

export function kindOfFile(file: File): DroppedFile {
  const type = file.type.toLowerCase()
  if (type === 'application/json' || /\.json$/i.test(file.name)) return 'record'
  if (type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf'
  if (type.startsWith('image/') && type !== 'image/svg+xml') return 'photo'
  return 'other'
}

const WORD = /\.(docx?|odt|pages|rtf)$/i

/** Why a file cannot start a conversion, in words a teacher can act on. */
export function unsupportedFileMessage(file: File): string {
  return WORD.test(file.name)
    ? 'Save your document as a PDF, then drop the PDF here.'
    : 'Drop your test as a PDF, or a photo of it.'
}

/** A photo's bytes as PNG or JPEG, the forms a PDF can hold; any other
 *  picture the browser can draw is redrawn as PNG. */
async function embeddablePhoto(file: File): Promise<{ bytes: Uint8Array; type: 'image/png' | 'image/jpeg' }> {
  const type = file.type.toLowerCase()
  if (type === 'image/png' || type === 'image/jpeg') {
    return { bytes: new Uint8Array(await file.arrayBuffer()), type }
  }
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('This photo could not be read. Try a PNG or JPEG.')
  }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!png) throw new Error('This photo could not be read. Try a PNG or JPEG.')
    return { bytes: new Uint8Array(await png.arrayBuffer()), type: 'image/png' }
  } finally {
    bitmap.close()
  }
}

/** Find the pictures in a dropped PDF or photo and start waiting on it,
 *  replacing any import already waiting — the caller asks first. */
export async function startWaitingImport(file: File): Promise<WaitingImport> {
  const kind = kindOfFile(file)
  if (kind !== 'pdf' && kind !== 'photo') throw new Error(unsupportedFileMessage(file))
  const { analyzeSourceDocument, photoSourceDocument } = await import('./source-document')
  let bytes: Uint8Array
  if (kind === 'photo') {
    const photo = await embeddablePhoto(file)
    bytes = await photoSourceDocument(photo.bytes, photo.type)
  } else {
    bytes = new Uint8Array(await file.arrayBuffer())
  }
  const analysis = await analyzeSourceDocument(bytes)
  const waiting: WaitingImport = { kind, fileName: file.name, bytes, ...analysis, createdAt: new Date().toISOString() }
  await saveWaitingImport(waiting)
  return waiting
}
