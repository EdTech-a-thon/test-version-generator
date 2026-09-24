import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  Cloud,
  CloudAlert,
  CloudCheck,
  CloudDownload,
  CloudOff,
  Download,
  ExternalLink,
  RefreshCw,
  Settings,
  Upload,
  X,
} from 'lucide-react'
import {
  accountBackupBlob,
  accountBackupFileName,
  captureAccount,
  readAccountBackup,
  stageRestore,
  AccountBackupError,
  type AccountManifest,
} from './account-backup'
import {
  disableSync,
  dismissSettingsRequest,
  enableSync,
  loadIncoming,
  refreshConnection,
  resolveConflict,
  resumeAfterRedirect,
  subscribeSync,
  syncNow,
  syncState,
  type SyncState,
} from './account-sync'
import { allowDrive, driveAllowed, signIn, signOut } from './google-broker'
import { folderUrl, DRIVE_FOLDER_NAME } from './google-drive'
import type { PersistentStorageStatus } from './durable-storage'
import { useModalScrollLock } from './use-modal-scroll-lock'
import { navigate, useRoute } from './use-route'
import './account-menu.css'

/**
 * Where the work lives, and the ways to keep it. An icon in the top bar says
 * where the work is saved and points to Settings, which holds the two ways to
 * keep a copy: a backup file, and syncing through Google Drive.
 */

export const SETTINGS_PATH = '/settings'

function useSync(): SyncState {
  return useSyncExternalStore(subscribeSync, syncState)
}

function relativeTime(iso: string | undefined, now = Date.now()) {
  if (!iso) return ''
  const seconds = Math.round((now - Date.parse(iso)) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function syncSummary(sync: SyncState): string {
  switch (sync.status) {
    case 'off': return ''
    case 'syncing': return 'Syncing…'
    case 'synced': return sync.link?.lastSyncedAt ? `Synced ${relativeTime(sync.link.lastSyncedAt)}` : 'Synced'
    case 'offline': return 'Offline · will retry'
    case 'reconnect': return 'Sync paused · reconnect Google'
    case 'incoming': return 'Newer work in Drive'
    case 'conflict': return 'Needs your choice'
  }
}

function BadgeIcon({ sync }: { sync: SyncState }) {
  if (sync.status === 'off') return <CloudOff aria-hidden="true" />
  if (sync.status === 'syncing') return <RefreshCw aria-hidden="true" className="account-spin" />
  if (sync.status === 'synced') return <CloudCheck aria-hidden="true" />
  if (sync.status === 'incoming') return <CloudDownload aria-hidden="true" />
  if (sync.status === 'offline') return <Cloud aria-hidden="true" />
  return <CloudAlert aria-hidden="true" />
}

async function downloadBackup() {
  const blob = await accountBackupBlob(await captureAccount())
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = accountBackupFileName()
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function AccountBadge({ status }: { status: PersistentStorageStatus }) {
  const sync = useSync()
  const route = useRoute()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const panelId = useId()

  // Coming back from Google, the teacher lands on Settings, where the steps are.
  useEffect(() => {
    if (sync.settingsRequested && route !== SETTINGS_PATH) navigate(SETTINGS_PATH)
  }, [sync.settingsRequested, route])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const syncing = sync.status !== 'off'
  const label = syncing ? `Backup and sync: ${syncSummary(sync)}` : 'Where your work is stored'

  return (
    <div className="account-badge" ref={root}>
      <button
        type="button"
        className="storage-badge-button"
        data-status={status}
        data-sync={sync.status}
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <BadgeIcon sync={sync} />
      </button>
      {open && (
        <div className="account-panel" id={panelId} role="region" aria-label="Backup and sync">
          <strong>{syncing ? 'Your work syncs with Google Drive.' : 'Your work is saved in your browser.'}</strong>
          {syncing && <p className="account-sync-status" data-sync={sync.status}>{syncSummary(sync)}</p>}
          <p>
            {syncing
              ? 'Go to Settings to export your data or change how it syncs.'
              : 'Go to Settings to either export your data or sync it across devices.'}
          </p>
          {status === 'denied' && (
            <p className="account-warning">
              Persistent storage was denied. Your browser may clear this local data when space is needed.
            </p>
          )}
          <div className="account-actions">
            <button
              type="button"
              className="secondary-button account-action"
              onClick={() => { setOpen(false); navigate(SETTINGS_PATH) }}
            >
              <Settings aria-hidden="true" />
              Settings
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Download the whole account as one file, or replace it from one. */
export function BackupSettings({ status }: { status: PersistentStorageStatus }) {
  const sync = useSync()
  const [restoring, setRestoring] = useState<{ file: File; manifest: AccountManifest } | null>(null)
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const backup = async () => {
    setBusy('backup')
    setError('')
    try {
      await downloadBackup()
    } catch {
      setError('The backup could not be created. Try again.')
    } finally {
      setBusy(null)
    }
  }

  const chooseRestore = async (file: File | undefined) => {
    if (!file) return
    setBusy('restore')
    setError('')
    try {
      const snapshot = await readAccountBackup(file)
      setRestoring({ file, manifest: snapshot.manifest })
    } catch (caught) {
      setError(caught instanceof AccountBackupError ? caught.message : 'This backup could not be read.')
    } finally {
      setBusy(null)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <section className="site-card account-settings" aria-labelledby="settings-backup">
      <h2 id="settings-backup">Back up your work</h2>
      <p>
        Exams, Question Banks, Working Copies, and Export History are saved in this browser. Download
        a backup now and then, and restore it here or in another browser.
      </p>
      {status === 'denied' && (
        <p className="account-warning">
          Persistent storage was denied. Your browser may clear this local data when space is needed.
        </p>
      )}
      {status === 'granted' && <p className="account-ok">Persistent browser storage is enabled.</p>}
      <div className="account-actions">
        <button type="button" className="secondary-button account-action" onClick={backup} disabled={busy !== null}>
          {busy === 'backup' ? <RefreshCw aria-hidden="true" className="account-spin" /> : <Download aria-hidden="true" />}
          {busy === 'backup' ? 'Preparing…' : 'Download backup'}
        </button>
        <button type="button" className="secondary-button account-action" onClick={() => fileInput.current?.click()} disabled={busy !== null}>
          <Upload aria-hidden="true" />
          {busy === 'restore' ? 'Reading…' : 'Restore…'}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".zip,application/zip"
          hidden
          aria-label="Choose an account backup to restore"
          onChange={(event) => void chooseRestore(event.target.files?.[0])}
        />
      </div>
      {error && <p className="account-warning" role="alert">{error}</p>}
      {restoring && (
        <RestoreDialog
          file={restoring.file}
          manifest={restoring.manifest}
          syncing={sync.status !== 'off'}
          onClose={() => setRestoring(null)}
        />
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------

function Modal({ title, onClose, children, className = '' }: {
  title: string
  onClose: () => void
  children: ReactNode
  className?: string
}) {
  const titleId = useId()
  const dialog = useRef<HTMLElement>(null)
  useModalScrollLock()
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const focusable = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') ?? [])
    requestAnimationFrame(() => focusable()[0]?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const controls = focusable()
      if (controls.length === 0) return
      const first = controls[0]!
      const last = controls.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      requestAnimationFrame(() => { if (previous?.isConnected) previous.focus() })
    }
  }, [])
  return createPortal(
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <section
        ref={dialog}
        className={`account-dialog ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="resource-picker-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="question-bank-action" aria-label="Close" onClick={onClose}><X /></button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  )
}

function Step({ done, number, title, detail, action }: {
  done: boolean
  number: number
  title: string
  detail: ReactNode
  action?: ReactNode
}) {
  return (
    <li className="account-step" data-done={done}>
      <span className="account-step-mark" aria-hidden="true">{done ? <Check /> : number}</span>
      <div className="account-step-text">
        <span className="account-step-title">
          {title}
          <span className="sr-only">{done ? ' (done)' : ' (to do)'}</span>
        </span>
        <span className="account-step-detail">{detail}</span>
      </div>
      {!done && action}
    </li>
  )
}

/** Sign in, allow Drive access, turn sync on, and settle what it reports. */
export function SyncSettings() {
  const sync = useSync()
  const [working, setWorking] = useState<string | null>(null)
  const [localError, setLocalError] = useState('')

  useEffect(() => { void refreshConnection() }, [])
  useEffect(() => { if (sync.settingsRequested) dismissSettingsRequest() }, [sync.settingsRequested])

  const connection = sync.connection
  const signedIn = Boolean(connection)
  const allowed = driveAllowed(connection ?? null)
  // Still asking the broker; if it could not be reached, offer the steps anyway.
  const loading = connection === undefined && !sync.error

  const run = async (name: string, task: () => Promise<void>) => {
    setWorking(name)
    setLocalError('')
    try {
      await task()
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Something went wrong. Try again.')
    } finally {
      setWorking(null)
    }
  }

  const error = localError || sync.error

  return (
    <section className="site-card account-settings" aria-labelledby="settings-sync">
      <h2 id="settings-sync">Sync with Google Drive</h2>
      <p>
        Keep your work in a <strong>{DRIVE_FOLDER_NAME}</strong> folder in your own Google Drive and
        pick it up on any device. Test Parrot never stores your work, and it can see only the files it
        creates in your Drive.
      </p>
      <ol className="account-steps">
        <Step
          number={1}
          done={signedIn}
          title="Sign in with Google"
          detail={loading ? 'Checking…' : signedIn ? `Signed in as ${connection?.googleEmail ?? 'your Google account'}` : 'Uses your Google account; there is no Test Parrot password.'}
          action={!loading && (
            <button
              type="button"
              className="primary-button"
              disabled={working !== null}
              onClick={() => void run('sign-in', async () => { resumeAfterRedirect('open'); await signIn() })}
            >
              Sign in
            </button>
          )}
        />
        <Step
          number={2}
          done={allowed}
          title="Allow Google Drive access"
          detail={allowed
            ? 'Test Parrot can create and update its own folder.'
            : connection?.status === 'invalid'
              ? 'Drive access stopped working. Allow it again to keep syncing.'
              : 'Lets Test Parrot create its own folder. It cannot see anything else in your Drive.'}
          action={!loading && (
            <button
              type="button"
              className={signedIn ? 'primary-button' : 'secondary-button'}
              disabled={!signedIn || working !== null}
              onClick={() => void run('allow', async () => { resumeAfterRedirect('enable'); await allowDrive() })}
            >
              Allow
            </button>
          )}
        />
      </ol>

      {error && <p className="account-warning" role="alert">{error}</p>}

      {allowed && !sync.link && (
        <button
          type="button"
          className="primary-button account-wide"
          disabled={working !== null}
          onClick={() => void run('enable', enableSync)}
        >
          {working === 'enable' ? 'Turning on…' : 'Turn on sync'}
        </button>
      )}

      {sync.link && sync.status === 'conflict' && (
        <div className="account-callout" role="status">
          <strong>This device and Google Drive both have changes.</strong>
          <p>
            Choose whose work to keep. The other is saved as a dated copy in your {DRIVE_FOLDER_NAME} folder,
            so nothing is lost.
          </p>
          <div className="account-actions">
            <button type="button" className="primary-button" disabled={working !== null} onClick={() => void run('keep-local', () => resolveConflict('this-device'))}>
              Keep this device’s work
            </button>
            <button type="button" className="secondary-button" disabled={working !== null} onClick={() => void run('keep-drive', () => resolveConflict('drive'))}>
              Use Drive’s work
            </button>
          </div>
        </div>
      )}

      {sync.link && sync.status === 'incoming' && (
        <div className="account-callout" role="status">
          <strong>Newer work from another device is in Google Drive.</strong>
          <p>Loading it reloads Test Parrot. It also loads by itself the next time Test Parrot opens.</p>
          <div className="account-actions">
            <button type="button" className="primary-button" disabled={working !== null} onClick={() => void run('load', loadIncoming)}>
              Load it now
            </button>
          </div>
        </div>
      )}

      {sync.link && (
        <dl className="account-details">
          <dt>Status</dt>
          <dd data-sync={sync.status}>{syncSummary(sync)}</dd>
          <dt>Folder</dt>
          <dd>
            {sync.link.folderId
              ? <a href={folderUrl(sync.link.folderId)} target="_blank" rel="noreferrer">Open in Google Drive <ExternalLink aria-hidden="true" /></a>
              : 'Creating…'}
          </dd>
        </dl>
      )}

      {sync.link && (
        <div className="account-actions">
          <button
            type="button"
            className="secondary-button account-action"
            disabled={working !== null || sync.status === 'syncing' || sync.status === 'conflict'}
            onClick={() => void run('sync', () => syncNow())}
          >
            <RefreshCw aria-hidden="true" className={sync.status === 'syncing' ? 'account-spin' : ''} />
            Sync now
          </button>
          <button type="button" className="secondary-button" disabled={working !== null} onClick={disableSync}>
            Turn off sync
          </button>
        </div>
      )}

      {signedIn && (
        <p className="account-signed-in">
          Signed in as {connection?.googleEmail ?? 'your Google account'} ·{' '}
          <button
            type="button"
            className="account-link"
            disabled={working !== null}
            onClick={() => void run('sign-out', async () => { await signOut(); await refreshConnection() })}
          >
            Sign out
          </button>
        </p>
      )}
    </section>
  )
}

function RestoreDialog({ file, manifest, syncing, onClose }: {
  file: File
  manifest: AccountManifest
  syncing: boolean
  onClose: () => void
}) {
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null)
  const [error, setError] = useState('')
  const made = new Date(manifest.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const restore = async () => {
    setBusy('restore')
    setError('')
    try {
      await stageRestore({ bytes: await file.arrayBuffer(), source: 'file' })
      window.location.reload()
    } catch {
      setError('The backup could not be restored. Nothing in this browser was changed.')
      setBusy(null)
    }
  }
  const backupFirst = async () => {
    setBusy('backup')
    setError('')
    try {
      await downloadBackup()
    } catch {
      setError('The backup could not be created. Try again.')
    } finally {
      setBusy(null)
    }
  }
  return (
    <Modal title="Restore this backup?" onClose={onClose}>
      <p className="account-dialog-copy">
        <strong>{file.name}</strong> was made {made}. Restoring replaces every Exam, Question Bank,
        Working Copy, and Export History in this browser with the ones in the backup, then reloads
        Test Parrot.
        {syncing && ' Sync is on, so the restored work becomes what your other devices see too.'}
      </p>
      {error && <p className="account-warning" role="alert">{error}</p>}
      <div className="account-actions account-actions--end">
        <button type="button" className="secondary-button account-action" disabled={busy !== null} onClick={() => void backupFirst()}>
          <Download aria-hidden="true" />
          {busy === 'backup' ? 'Preparing…' : 'Download current work first'}
        </button>
        <button type="button" className="primary-button" disabled={busy !== null} onClick={() => void restore()}>
          {busy === 'restore' ? 'Restoring…' : 'Replace and reload'}
        </button>
      </div>
    </Modal>
  )
}
