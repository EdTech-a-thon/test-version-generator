import { saveWaitingImport, type WaitingImport } from './waiting-import'

/**
 * What a teacher dropped to start converting a test, and the import that
 * waits on it. A PDF and a Word document (.docx) are their own Source
 * Documents. A photo becomes a one-page PDF, so its pictures can be cropped
 * from it after importing. Anything else a test might be saved as is answered
 * with how to make it one of those.
 */

export type DroppedFile = 'record' | 'pdf' | 'word' | 'photo' | 'other'

const WORD_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export function kindOfFile(file: File): DroppedFile {
  const type = file.type.toLowerCase()
  if (type === 'application/json' || /\.json$/i.test(file.name)) return 'record'
  if (type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf'
  if (type === WORD_MIME_TYPE || /\.docx$/i.test(file.name)) return 'word'
  if (type.startsWith('image/') && type !== 'image/svg+xml') return 'photo'
  return 'other'
}

/** The files a drop zone for a test to convert takes. */
export const TEST_FILE_TYPES = `application/pdf,.pdf,${WORD_MIME_TYPE},.docx,image/*`

const OTHER_DOCUMENT = /\.(doc|odt|pages|rtf)$/i

/** Why a file cannot start a conversion, in words a teacher can act on. */
export function unsupportedFileMessage(file: File): string {
  return OTHER_DOCUMENT.test(file.name)
    ? 'Save your document as a PDF or a Word document (.docx), then drop it here.'
    : 'Drop your test as a PDF, a Word document, or a photo of it.'
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

/** A dropped test read as a Source Document: its bytes and the pictures in
 *  it, found the same way every time. */
export type SourceFile = Omit<WaitingImport, 'createdAt'>

export async function readSourceDocument(file: File): Promise<SourceFile> {
  const kind = kindOfFile(file)
  if (kind === 'word') {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const { analyzeWordDocument } = await import('./word-document')
    return { kind, fileName: file.name, bytes, ...(await analyzeWordDocument(bytes)) }
  }
  if (kind !== 'pdf' && kind !== 'photo') throw new Error(unsupportedFileMessage(file))
  const { analyzeSourceDocument, photoSourceDocument } = await import('./source-document')
  let bytes: Uint8Array
  if (kind === 'photo') {
    const photo = await embeddablePhoto(file)
    bytes = await photoSourceDocument(photo.bytes, photo.type)
  } else {
    bytes = new Uint8Array(await file.arrayBuffer())
  }
  return { kind, fileName: file.name, bytes, ...(await analyzeSourceDocument(bytes)) }
}

/** Find the pictures in a dropped test and start waiting on it, replacing
 *  any import already waiting — the caller asks first. */
export async function startWaitingImport(file: File): Promise<WaitingImport> {
  const waiting: WaitingImport = { ...(await readSourceDocument(file)), createdAt: new Date().toISOString() }
  await saveWaitingImport(waiting)
  return waiting
}
