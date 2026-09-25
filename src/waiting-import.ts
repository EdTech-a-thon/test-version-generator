import type { ImageTag } from './source-document'

/**
 * The import that is waiting for an assistant: a teacher dropped their own
 * PDF, Test Parrot tagged it, and the JSON the assistant returns has not been
 * dropped back yet. It holds the Source Document itself, because that is where
 * every Pending Image's picture will come from.
 *
 * It lives in a browser database of its own, outside the databases an Account
 * Backup captures (they are all named for `STORAGE_NAME`): a backup holds a
 * teacher's work, not a temporary copy of their test. Exactly one import
 * waits at a time. It is deleted when its import finishes, when the teacher
 * discards it, or once it is older than seven days — checked when the app
 * starts — so forgotten tests do not pile up in the browser.
 */

export const WAITING_IMPORT_DATABASE = 'test-parrot-waiting-import'
const STORE = 'waiting-import'
const KEY = 'current'
export const WAITING_IMPORT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

export type WaitingImport = {
  fileName: string
  bytes: Uint8Array
  pageCount: number
  tags: ImageTag[]
  pageText: string[]
  /** ISO time the Source Document was dropped. */
  createdAt: string
}

type Stored = Omit<WaitingImport, 'bytes'> & { key: typeof KEY; bytes: ArrayBuffer }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WAITING_IMPORT_DATABASE, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('The waiting import could not be opened.'))
    request.onblocked = () => reject(new Error('The waiting import could not be opened.'))
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  use: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const database = await open()
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode)
      const request = use(transaction.objectStore(STORE))
      let result: T | undefined
      if (request) request.onsuccess = () => { result = request.result }
      transaction.oncomplete = () => resolve(result)
      transaction.onabort = transaction.onerror = () =>
        reject(transaction.error ?? new Error('The waiting import could not be saved.'))
    })
  } finally {
    database.close()
  }
}

const expired = (value: Pick<WaitingImport, 'createdAt'>, now: Date) =>
  now.getTime() - new Date(value.createdAt).getTime() > WAITING_IMPORT_LIFETIME_MS

/** The import that is waiting, unless there is none or it has expired — in
 *  which case it is deleted rather than resumed. */
export async function readWaitingImport(now = new Date()): Promise<WaitingImport | null> {
  const stored = await withStore<Stored | undefined>('readonly', (store) => store.get(KEY))
  if (!stored) return null
  if (expired(stored, now)) {
    await discardWaitingImport()
    return null
  }
  const { key: _key, bytes, ...rest } = stored
  void _key
  return { ...rest, bytes: new Uint8Array(bytes) }
}

/** Start waiting on a Source Document, replacing any import already waiting.
 *  The dialog asks before it replaces one. */
export async function saveWaitingImport(waiting: WaitingImport): Promise<void> {
  const stored: Stored = {
    ...waiting,
    key: KEY,
    bytes: waiting.bytes.slice().buffer as ArrayBuffer,
    tags: waiting.tags.map((tag) => ({ ...tag, box: { ...tag.box } })),
    pageText: [...waiting.pageText],
  }
  await withStore('readwrite', (store) => { store.put(stored) })
}

export async function discardWaitingImport(): Promise<void> {
  await withStore('readwrite', (store) => { store.delete(KEY) })
}

/** Run when the app starts: a waiting import older than seven days is gone. */
export async function expireWaitingImport(now = new Date()): Promise<void> {
  await readWaitingImport(now)
}
