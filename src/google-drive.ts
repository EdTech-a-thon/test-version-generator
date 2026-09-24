// The Drive side of Account Sync. With the `drive.file` scope Test Parrot can
// see only what it created, so the folder and the account file are found by
// their `appProperties` rather than by name: renaming or moving them in Drive
// never breaks sync, and nothing else in the teacher's Drive is visible.

import { accessToken, clearAuthorization } from './google-broker'

const API = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const MARK = 'testParrot'
const FILE_FIELDS = 'id,name,version,modifiedTime,appProperties,trashed'

export const DRIVE_FOLDER_NAME = 'Test Parrot'
export const DRIVE_ACCOUNT_FILE_NAME = 'Test Parrot account.zip'

export type DriveFile = {
  id: string
  name: string
  version?: string
  modifiedTime?: string
  trashed?: boolean
  appProperties?: Record<string, string>
}

export class DriveError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'DriveError'
    this.status = status
  }
}

async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${await accessToken()}`, ...init.headers },
    })
  } catch (caught) {
    if (caught instanceof Error && caught.name !== 'TypeError') throw caught
    throw new DriveError('Google Drive could not be reached.', 0)
  }
  if (response.ok) return response
  if (response.status === 401) clearAuthorization()
  const body = await response.json().catch(() => ({})) as { error?: { message?: string } }
  throw new DriveError(body.error?.message ?? `Google Drive returned ${response.status}.`, response.status)
}

async function driveJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  return await (await driveFetch(url, init)).json() as T
}

function query(q: string) {
  const params = new URLSearchParams({ q, fields: `files(${FILE_FIELDS})`, spaces: 'drive', pageSize: '10', orderBy: 'modifiedTime desc' })
  return `${API}?${params}`
}

async function findMarked(kind: 'folder' | 'account'): Promise<DriveFile | null> {
  const q = `appProperties has { key='${MARK}' and value='${kind}' } and trashed = false`
  const { files } = await driveJson<{ files: DriveFile[] }>(query(q))
  return files[0] ?? null
}

export async function getFile(id: string): Promise<DriveFile | null> {
  try {
    const file = await driveJson<DriveFile>(`${API}/${encodeURIComponent(id)}?fields=${FILE_FIELDS}`)
    return file.trashed ? null : file
  } catch (caught) {
    if (caught instanceof DriveError && caught.status === 404) return null
    throw caught
  }
}

/** The Test Parrot folder, created the first time any device syncs. */
export async function ensureFolder(knownId?: string): Promise<DriveFile> {
  if (knownId) {
    const known = await getFile(knownId)
    if (known) return known
  }
  const found = await findMarked('folder')
  if (found) return found
  return driveJson<DriveFile>(`${API}?fields=${FILE_FIELDS}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: FOLDER_MIME, appProperties: { [MARK]: 'folder' } }),
  })
}

export async function findAccountFile(knownId?: string): Promise<DriveFile | null> {
  if (knownId) {
    const known = await getFile(knownId)
    if (known) return known
  }
  return findMarked('account')
}

/** A resumable upload works at any size; multipart stops at 5 MB. */
async function resumableUpload(
  url: string,
  method: 'POST' | 'PATCH',
  metadata: object,
  body: Blob,
): Promise<DriveFile> {
  const session = await driveFetch(`${url}${url.includes('?') ? '&' : '?'}uploadType=resumable&fields=${FILE_FIELDS}`, {
    method,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': body.type || 'application/zip',
      'X-Upload-Content-Length': String(body.size),
    },
    body: JSON.stringify(metadata),
  })
  const location = session.headers.get('Location')
  if (!location) throw new DriveError('Google Drive did not start the upload.', 502)
  return driveJson<DriveFile>(location, { method: 'PUT', headers: { 'Content-Type': body.type || 'application/zip' }, body })
}

export function uploadAccount(options: {
  folderId: string
  existingId?: string
  body: Blob
  fingerprint: string
}): Promise<DriveFile> {
  const appProperties = { [MARK]: 'account', fingerprint: options.fingerprint }
  if (options.existingId) {
    return resumableUpload(`${UPLOAD}/${encodeURIComponent(options.existingId)}`, 'PATCH', { appProperties }, options.body)
  }
  return resumableUpload(UPLOAD, 'POST', {
    name: DRIVE_ACCOUNT_FILE_NAME,
    parents: [options.folderId],
    mimeType: 'application/zip',
    appProperties,
  }, options.body)
}

export async function downloadFile(id: string): Promise<Blob> {
  return (await driveFetch(`${API}/${encodeURIComponent(id)}?alt=media`)).blob()
}

/** Keeps the losing side of a conflict as a dated file beside the account. */
export async function keepCopy(options: {
  folderId: string
  name: string
  sourceId?: string
  body?: Blob
}): Promise<void> {
  const appProperties = { [MARK]: 'copy' }
  if (options.sourceId) {
    await driveFetch(`${API}/${encodeURIComponent(options.sourceId)}/copy?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: options.name, parents: [options.folderId], appProperties }),
    })
    return
  }
  if (options.body) {
    await resumableUpload(UPLOAD, 'POST', {
      name: options.name, parents: [options.folderId], mimeType: 'application/zip', appProperties,
    }, options.body)
  }
}

export function folderUrl(id: string) {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`
}
