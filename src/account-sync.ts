// Account Sync keeps one Account Backup in the teacher's own Google Drive and
// brings every device that syncs to it up to date. Test Parrot never stores
// the work itself: the browser talks to Drive directly with a `drive.file`
// token minted by the auth broker.
//
// Sync compares whole accounts. Each device remembers the fingerprint of the
// account it last agreed with Drive on, which says who has changed since:
//   - only this device  → upload it
//   - only Drive        → load Drive's copy (before the app starts, or on a
//                         reload the teacher chooses, never under their hands)
//   - both              → a conflict the teacher resolves; the side they do
//                         not keep is saved as a dated copy in the folder, so
//                         resolving one can never lose work.

import {
  accountBackupBlob,
  accountFingerprint,
  captureAccount,
  DEVICE_ONLY_PREFIX,
  readAccountBackup,
  replaceAccount,
  stageRestore,
  type AccountSnapshot,
  type StagedRestoreOutcome,
} from './account-backup'
import {
  BrokerError,
  consumeArrivalError,
  describeArrivalError,
  driveAllowed,
  getConnection,
  type DriveConnection,
} from './google-broker'
import {
  DriveError,
  downloadFile,
  ensureFolder,
  findAccountFile,
  keepCopy,
  uploadAccount,
  type DriveFile,
} from './google-drive'
import { CANONICAL_QUESTION_STORE, EXAM_STORE, STORAGE_NAME } from './storage-schema'

const LINK_KEY = `${DEVICE_ONLY_PREFIX}drive-sync`
const RESUME_KEY = `${DEVICE_ONLY_PREFIX}drive-sync-resume`
const CHECK_INTERVAL = 60_000

/** What this browser knows about its sync. Never part of a backup. */
export type SyncLink = {
  folderId: string
  fileId?: string
  googleEmail?: string
  lastSyncedFingerprint?: string
  lastSyncedAt?: string
}

export type SyncStatus =
  | 'off'
  | 'syncing'
  | 'synced'
  | 'offline'
  | 'reconnect'
  | 'incoming'
  | 'conflict'

export type SyncState = {
  status: SyncStatus
  link: SyncLink | null
  /** `undefined` while unknown; `null` when signed out of Google. */
  connection: DriveConnection | null | undefined
  error: string
  /** Set when the teacher came back from Google and should land back on Settings. */
  settingsRequested: boolean
  /** When Drive's copy last changed, for an incoming change or a conflict. */
  remoteModifiedAt?: string
}

// ---------------------------------------------------------------------------
// State.

function readLink(): SyncLink | null {
  try {
    const value = JSON.parse(localStorage.getItem(LINK_KEY) ?? 'null') as SyncLink | null
    return value && typeof value.folderId === 'string' ? value : null
  } catch {
    return null
  }
}

function writeLink(link: SyncLink | null) {
  if (link) localStorage.setItem(LINK_KEY, JSON.stringify(link))
  else localStorage.removeItem(LINK_KEY)
}

let state: SyncState = {
  status: readLink() ? 'synced' : 'off',
  link: readLink(),
  connection: undefined,
  error: '',
  settingsRequested: false,
}
const listeners = new Set<() => void>()

function update(next: Partial<SyncState>) {
  state = { ...state, ...next }
  if ('link' in next) writeLink(next.link ?? null)
  for (const listener of listeners) listener()
}

export function subscribeSync(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function syncState() { return state }

export function dismissSettingsRequest() {
  if (state.settingsRequested) update({ settingsRequested: false })
}

// ---------------------------------------------------------------------------
// Startup. Both run before the app opens its own databases.

/**
 * Finishes whatever a previous page left staged, and notes a return from
 * Google. Call first thing at startup.
 */
export async function prepareAccountSync(
  outcome: StagedRestoreOutcome | null,
): Promise<{ restoredFromFile: boolean; restoreError: string }> {
  let restoreError = ''
  if (outcome?.applied && outcome.staged.source === 'drive' && state.link && outcome.staged.fingerprint) {
    update({
      link: { ...state.link, lastSyncedFingerprint: outcome.staged.fingerprint, lastSyncedAt: new Date().toISOString() },
    })
  }
  if (outcome && !outcome.applied && outcome.reason === 'failed') {
    restoreError = 'The backup could not be restored, so nothing in this browser was changed.'
  }
  const arrival = consumeArrivalError()
  const resume = sessionStorage.getItem(RESUME_KEY)
  sessionStorage.removeItem(RESUME_KEY)
  if (arrival || resume) {
    update({ settingsRequested: true, error: arrival ? describeArrivalError(arrival) : '' })
  }
  if (resume === 'enable' && !arrival) enableAfterStart = true
  return { restoredFromFile: Boolean(outcome?.applied && outcome.staged.source === 'file'), restoreError }
}

let enableAfterStart = false

/**
 * Loads a newer account from Drive before anything renders, so opening Test
 * Parrot on a second device simply shows the latest work. Gives up quietly
 * (the normal sync pass will report why) rather than delay startup.
 */
export async function pullBeforeStart(timeoutMs = 6000): Promise<void> {
  const link = state.link
  if (!link?.lastSyncedFingerprint || !navigator.onLine) return
  const attempt = async () => {
    const remote = await findAccountFile(link.fileId)
    const remoteFingerprint = remote?.appProperties?.fingerprint
    if (!remote || !remoteFingerprint || remoteFingerprint === link.lastSyncedFingerprint) return null
    const local = await accountFingerprint(await captureAccount())
    if (local !== link.lastSyncedFingerprint) return null
    return { remote, remoteFingerprint }
  }
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
  try {
    const found = await Promise.race([attempt(), timeout])
    if (!found) return
    const snapshot = await readAccountBackup(await downloadFile(found.remote.id))
    // The download itself is allowed to take longer than the check.
    await replaceAccount(snapshot)
    update({
      link: {
        ...link,
        fileId: found.remote.id,
        lastSyncedFingerprint: found.remoteFingerprint,
        lastSyncedAt: new Date().toISOString(),
      },
    })
  } catch {
    // The sync pass after startup reports what went wrong.
  }
}

// ---------------------------------------------------------------------------
// Google.

export async function refreshConnection(): Promise<DriveConnection | null> {
  try {
    const connection = await getConnection()
    update({ connection })
    return connection
  } catch (caught) {
    update({ error: messageOf(caught) })
    return state.connection ?? null
  }
}

/** Marks that the dialog should reopen (and maybe finish) after a redirect. */
export function resumeAfterRedirect(then: 'open' | 'enable') {
  sessionStorage.setItem(RESUME_KEY, then)
}

// ---------------------------------------------------------------------------
// The sync pass.

let running: Promise<void> | null = null
let again = false
let retryTimer: ReturnType<typeof setTimeout> | undefined
let retryDelay = 2000
let remote: DriveFile | null = null

function messageOf(caught: unknown) {
  return caught instanceof Error ? caught.message : 'Google Drive could not be reached.'
}

function needsReconnect(caught: unknown) {
  return (caught instanceof BrokerError && (caught.needsConnection || caught.signedOut))
    || (caught instanceof DriveError && (caught.status === 401 || caught.status === 403))
}

function fail(caught: unknown) {
  if (!state.link) return
  if (needsReconnect(caught)) {
    update({ status: 'reconnect', error: messageOf(caught) })
    return
  }
  update({ status: 'offline', error: messageOf(caught) })
  if (retryTimer) return
  const delay = retryDelay
  retryDelay = Math.min(delay * 2, 60_000)
  retryTimer = setTimeout(() => { retryTimer = undefined; void syncNow() }, delay)
}

function isEmpty(snapshot: AccountSnapshot) {
  const registry = snapshot.manifest.databases.find((database) => database.name === STORAGE_NAME)
  if (!registry) return true
  return [EXAM_STORE, CANONICAL_QUESTION_STORE].every((name) =>
    (registry.stores.find((store) => store.name === name)?.entries.length ?? 0) === 0)
}

function withLock(task: () => Promise<void>) {
  // One sync at a time across every tab of this browser.
  if (navigator.locks?.request) return navigator.locks.request('test-parrot-drive-sync', task)
  return task()
}

async function pass(options: { first?: boolean } = {}) {
  const link = state.link
  if (!link) return
  // Turning sync off mid-pass wins: nothing the pass learns is written back.
  const settle = (next: Partial<SyncState>) => { if (state.link) update(next) }
  update({ status: 'syncing' })
  const snapshot = await captureAccount()
  const local = await accountFingerprint(snapshot)
  const folder = await ensureFolder(link.folderId)
  remote = await findAccountFile(link.fileId)
  const remoteFingerprint = remote?.appProperties?.fingerprint
  const synced = (fingerprint: string, file: DriveFile) => settle({
    status: 'synced',
    error: '',
    remoteModifiedAt: undefined,
    link: {
      ...link,
      folderId: folder.id,
      fileId: file.id,
      lastSyncedFingerprint: fingerprint,
      lastSyncedAt: new Date().toISOString(),
    },
  })

  if (!remote || !remoteFingerprint) {
    synced(local, await uploadAccount({ folderId: folder.id, existingId: remote?.id, body: await accountBackupBlob(snapshot), fingerprint: local }))
    return
  }
  if (remoteFingerprint === local) { synced(local, remote); return }

  const localChanged = local !== link.lastSyncedFingerprint
  const remoteChanged = remoteFingerprint !== link.lastSyncedFingerprint
  if (!remoteChanged) {
    synced(local, await uploadAccount({ folderId: folder.id, existingId: remote.id, body: await accountBackupBlob(snapshot), fingerprint: local }))
    return
  }
  if (!localChanged || (options.first && isEmpty(snapshot))) {
    // A device with nothing of its own joins the Drive account at once.
    if (options.first && isEmpty(snapshot)) { await loadFromDrive(local); return }
    settle({ status: 'incoming', error: '', remoteModifiedAt: remote.modifiedTime, link: { ...link, folderId: folder.id, fileId: remote.id } })
    return
  }
  settle({ status: 'conflict', error: '', remoteModifiedAt: remote.modifiedTime, link: { ...link, folderId: folder.id, fileId: remote.id } })
}

/** Runs one sync pass now; overlapping requests fold into one more pass. */
export function syncNow(options: { first?: boolean } = {}): Promise<void> {
  if (!state.link) return Promise.resolve()
  if (running) { again = true; return running }
  clearTimeout(retryTimer)
  retryTimer = undefined
  running = (async () => {
    try {
      await withLock(() => pass(options))
      retryDelay = 2000
    } catch (caught) {
      fail(caught)
    } finally {
      running = null
    }
    if (again) { again = false; await syncNow() }
  })()
  return running
}

/** Turns sync on for this browser. Google must already allow Drive access. */
export async function enableSync(): Promise<void> {
  const connection = await refreshConnection()
  if (!driveAllowed(connection)) {
    update({ status: 'off', error: connection ? 'Allow Google Drive access first.' : 'Sign in with Google first.' })
    return
  }
  update({ link: { folderId: '', googleEmail: connection?.googleEmail }, error: '' })
  startWatching()
  await syncNow({ first: true })
}

/** Stops syncing this browser. Nothing in Drive is removed. */
export function disableSync() {
  clearTimeout(retryTimer)
  retryTimer = undefined
  remote = null
  update({ link: null, status: 'off', error: '', remoteModifiedAt: undefined })
}

/**
 * Loads Drive's copy on the next page load, where it replaces this browser's
 * account before the app opens it. Work written after this call is never
 * overwritten: the restore checks the account is still `local`.
 */
async function loadFromDrive(local: string) {
  if (!remote) throw new Error('Drive has no Test Parrot account to load.')
  const bytes = await (await downloadFile(remote.id)).arrayBuffer()
  const snapshot = await readAccountBackup(new Blob([bytes]))
  await stageRestore({
    bytes,
    source: 'drive',
    fingerprint: await accountFingerprint(snapshot),
    replacesFingerprint: local,
  })
  window.location.reload()
}

export async function loadIncoming(): Promise<void> {
  try {
    await loadFromDrive(await accountFingerprint(await captureAccount()))
  } catch (caught) {
    fail(caught)
  }
}

function stamp(now = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}`
}

/** Settles a conflict. The side not kept is saved as a copy in the folder. */
export async function resolveConflict(keep: 'this-device' | 'drive'): Promise<void> {
  const link = state.link
  if (!link || !remote) return
  update({ status: 'syncing', error: '' })
  try {
    const snapshot = await captureAccount()
    const local = await accountFingerprint(snapshot)
    if (keep === 'this-device') {
      await keepCopy({ folderId: link.folderId, sourceId: remote.id, name: `Test Parrot account (replaced ${stamp()}).zip` })
      const file = await uploadAccount({ folderId: link.folderId, existingId: remote.id, body: await accountBackupBlob(snapshot), fingerprint: local })
      update({ status: 'synced', remoteModifiedAt: undefined, link: { ...link, fileId: file.id, lastSyncedFingerprint: local, lastSyncedAt: new Date().toISOString() } })
      return
    }
    await keepCopy({ folderId: link.folderId, body: await accountBackupBlob(snapshot), name: `Test Parrot account (from another device ${stamp()}).zip` })
    await loadFromDrive(local)
  } catch (caught) {
    fail(caught)
  }
}

// ---------------------------------------------------------------------------
// Watching for changes. There is no single change event across the app's
// stores, so a pass runs on an interval while the page is visible, when it is
// hidden or closed (the moment work is most likely to be left behind), when
// it comes back into view, and when the network returns.

let watching = false

export function startWatching() {
  if (watching || !state.link) return
  watching = true
  setInterval(() => { if (state.link && document.visibilityState === 'visible' && state.status !== 'conflict') void syncNow() }, CHECK_INTERVAL)
  document.addEventListener('visibilitychange', () => { if (state.link && state.status !== 'conflict') void syncNow() })
  window.addEventListener('online', () => { if (state.link) void syncNow() })
}

/** Call once the app has rendered. */
export function startAccountSync() {
  if (enableAfterStart) {
    enableAfterStart = false
    void enableSync()
    return
  }
  if (!state.link) return
  startWatching()
  void syncNow()
}
