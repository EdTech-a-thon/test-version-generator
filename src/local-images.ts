import {
  MEDIA_ASSET_STORE,
  VERSIONED_STORAGE_NAME,
  VERSIONED_STORAGE_VERSION,
} from './storage-schema'
import type { ProseMirrorJSON } from './question-doc'

const imagePath = '/local-images/'
const ownedReference = /^\/local-images\/[a-f0-9]{64}$/

export type MediaAsset = {
  hash: string
  mimeType: string
  bytes: ArrayBuffer
  width: number
  height: number
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function imageMetadata(blob: Blob): Promise<Pick<MediaAsset, 'width' | 'height'>> {
  const bitmap = await createImageBitmap(blob)
  try {
    if (bitmap.width < 1 || bitmap.height < 1) throw new Error('Image has no intrinsic size.')
    return { width: bitmap.width, height: bitmap.height }
  } finally {
    bitmap.close()
  }
}

function openMediaDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VERSIONED_STORAGE_NAME, VERSIONED_STORAGE_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(MEDIA_ASSET_STORE)) {
        request.result.createObjectStore(MEDIA_ASSET_STORE, { keyPath: 'hash' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open Media Store.'))
    request.onblocked = () => reject(new Error('Could not open Media Store.'))
  })
}

function requestOf<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Media Store request failed.'))
  })
}

function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('Media Store transaction aborted.'))
    transaction.onerror = () => reject(transaction.error ?? new Error('Media Store transaction failed.'))
  })
}

/** Ingests image bytes as an immutable, content-addressed Media Asset. */
export async function saveImage(file: Blob): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.')

  let bytes: ArrayBuffer
  let metadata: Pick<MediaAsset, 'width' | 'height'>
  try {
    ;[bytes, metadata] = await Promise.all([file.arrayBuffer(), imageMetadata(file)])
  } catch {
    throw new Error('This image could not be captured.')
  }
  const hash = hex(await crypto.subtle.digest('SHA-256', bytes))
  const database = await openMediaDatabase()
  try {
    const transaction = database.transaction(MEDIA_ASSET_STORE, 'readwrite')
    const store = transaction.objectStore(MEDIA_ASSET_STORE)
    const existing = await requestOf(store.get(hash) as IDBRequest<MediaAsset | undefined>)
    if (!existing) store.put({ hash, mimeType: file.type.toLowerCase(), bytes, ...metadata })
    await completed(transaction)
  } finally {
    database.close()
  }
  return `${imagePath}${hash}`
}

async function hasMediaAsset(source: string): Promise<boolean> {
  const hash = source.slice(imagePath.length)
  const database = await openMediaDatabase()
  try {
    const transaction = database.transaction(MEDIA_ASSET_STORE, 'readonly')
    const asset = await requestOf(
      transaction.objectStore(MEDIA_ASSET_STORE).get(hash) as IDBRequest<MediaAsset | undefined>,
    )
    await completed(transaction)
    return asset !== undefined
  } finally {
    database.close()
  }
}

/** Copies a source into the Media Store, never returning the source itself. */
export async function captureImageSource(source: string): Promise<string> {
  if (ownedReference.test(source)) {
    if (await hasMediaAsset(source)) return source
    throw new Error('This image could not be captured.')
  }
  let response: Response
  try {
    response = await fetch(source)
  } catch {
    throw new Error('This image could not be captured.')
  }
  if (!response.ok) throw new Error('This image could not be captured.')
  const image = await response.blob()
  if (!image.type.startsWith('image/')) throw new Error('This image could not be captured.')
  return saveImage(image)
}

/** Ensures no mutable image source survives when Question Content is stored. */
export async function ownDocumentMedia(document: ProseMirrorJSON): Promise<ProseMirrorJSON> {
  const own = async (node: ProseMirrorJSON): Promise<ProseMirrorJSON> => {
    const attrs = node.attrs as Record<string, unknown> | undefined
    if ((node.type === 'image' || node.type === 'image-block') && typeof attrs?.src === 'string') {
      try {
        return { ...node, attrs: { ...attrs, src: await captureImageSource(attrs.src) } }
      } catch {
        return {
          type: 'paragraph',
          content: [{ type: 'text', text: '[Image could not be captured.]' }],
        }
      }
    }
    if (!Array.isArray(node.content)) return node
    return {
      ...node,
      content: await Promise.all(node.content.map((child) => own(child as ProseMirrorJSON))),
    }
  }
  return own(document)
}
