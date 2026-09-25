import { useEffect, useState } from 'react'
import { Clock, FileText, ImageIcon, Library } from 'lucide-react'
import { AppShell } from './app-shell'
import type { PersistentStorageStatus } from './durable-storage'
import {
  WAITING_IMPORT_LIFETIME_MS,
  discardWaitingImport,
  listImports,
  readWaitingImport,
  type ImportEntry,
  type ImportFileKind,
  type WaitingImport,
} from './import-history'
import { Link } from './site-chrome'
import { SourceDocumentSteps } from './source-document-steps'

/**
 * The Imports section: every import this browser has started. Those still
 * waiting for the file an assistant makes come first, each continued on its
 * own page; below them, what every finished import brought in.
 */

const KIND_LABELS: Record<ImportFileKind, string> = {
  pdf: 'PDF',
  photo: 'Photo',
  word: 'Word document',
  record: 'Test Parrot file',
}

const plural = (count: number, singular: string) => `${count} ${count === 1 ? singular : `${singular}s`}`

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** How long a waiting import has left, in words. */
function timeLeft(createdAt: string, now: Date): string {
  const days = Math.ceil((new Date(createdAt).getTime() + WAITING_IMPORT_LIFETIME_MS - now.getTime()) / (24 * 60 * 60 * 1000))
  return days <= 1 ? 'Expires within a day' : `Expires in ${days} days`
}

/** One import's own page. */
const importHref = (id: string) => `/import?id=${encodeURIComponent(id)}`

function WaitingRow({ entry, onDiscard }: { entry: Extract<ImportEntry, { stage: 'waiting' }>; onDiscard: () => void }) {
  const [confirming, setConfirming] = useState(false)
  return <li className="import-row" aria-label={entry.fileName}>
    <div className="import-row-main">
      <strong className="import-row-name">{entry.fileName}</strong>
      <span className="import-stage" data-stage="waiting"><Clock aria-hidden="true" />Waiting for the file from your AI</span>
      <span className="import-row-facts">
        {KIND_LABELS[entry.kind]} · started {when(entry.createdAt)}
        {entry.tags > 0 && ` · ${plural(entry.tags, 'picture')} detected`}
        {' · '}{timeLeft(entry.createdAt, new Date())}
      </span>
    </div>
    <div className="import-row-actions">
      {confirming
        ? <>
            <span>Discard it and its file?</span>
            <button type="button" className="secondary-button" onClick={() => setConfirming(false)}>Keep</button>
            <button type="button" className="danger-button" onClick={onDiscard}>Discard</button>
          </>
        : <>
            <button type="button" className="secondary-button" onClick={() => setConfirming(true)}>Discard…</button>
            <Link href={importHref(entry.id)} className="primary-button">Continue</Link>
          </>}
    </div>
  </li>
}

function FinishedRow({
  entry,
  picturesNeeded,
}: {
  entry: Exclude<ImportEntry, { stage: 'waiting' }>
  /** How many of its pictures are still needed now, once counted. */
  picturesNeeded: number | undefined
}) {
  const needed = entry.stage === 'imported' ? picturesNeeded ?? entry.imported.picturesNeeded : 0
  return <li className="import-row" aria-label={entry.fileName}>
    <div className="import-row-main">
      <strong className="import-row-name">{entry.fileName}</strong>
      {entry.stage === 'imported'
        ? <span className="import-stage" data-stage="imported">Imported</span>
        : <span className="import-stage" data-stage="expired">Expired</span>}
      <span className="import-row-facts">
        {KIND_LABELS[entry.kind]} · {entry.stage === 'imported'
          ? `imported ${when(entry.importedAt)} · ${plural(entry.imported.questions, 'Question')}`
          : `started ${when(entry.createdAt)}, and its file was removed after seven days before it was imported`}
      </span>
      {entry.stage === 'imported' && (entry.imported.exams.length > 0 || entry.imported.banks.length > 0) && (
        <span className="import-row-links">
          {entry.imported.exams.map((exam) => (
            // The editor and a bank's page are loaded as the page starts, so
            // they are opened with a full load, as their cards open them.
            <a key={exam.id} href={`/editor?exam=${exam.id}`} className="import-row-link">
              <FileText aria-hidden="true" />{exam.name || 'Untitled Test'}
            </a>
          ))}
          {entry.imported.banks.map((bank) => (
            <a key={bank.id} href={`/question-bank?id=${bank.id}`} className="import-row-link">
              <Library aria-hidden="true" />{bank.name || 'Untitled Question Bank'}
            </a>
          ))}
        </span>
      )}
    </div>
    {needed > 0 && (
      <span className="import-pictures-needed">
        <ImageIcon aria-hidden="true" />{plural(needed, 'picture')} still needed
      </span>
    )}
  </li>
}

export function ImportsPage({
  persistentStorage,
  revision,
  onImport,
  picturesNeededIn,
}: {
  persistentStorage: PersistentStorageStatus
  /** Changes whenever an import may have finished, so the list is read again. */
  revision: number
  onImport: () => void
  /** How many Pending Images the given banks hold now: an import's count
   *  falls as its pictures are added, long after it finished. */
  picturesNeededIn: (bankIds: readonly string[]) => Promise<number>
}) {
  const [entries, setEntries] = useState<readonly ImportEntry[] | null>(null)
  const [needed, setNeeded] = useState<ReadonlyMap<string, number>>(new Map())
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let current = true
    void listImports().then(async (found) => {
      if (!current) return
      setEntries(found)
      const counts = await Promise.all(found.flatMap((entry) =>
        entry.stage === 'imported' && entry.imported.picturesNeeded > 0
          ? [picturesNeededIn(entry.imported.banks.map(({ id }) => id)).then((count) => [entry.id, count] as const, () => null)]
          : []))
      if (current) setNeeded(new Map(counts.filter((count) => count !== null)))
    }, () => { if (current) setEntries([]) })
    return () => { current = false }
  }, [revision, reload, picturesNeededIn])

  const waiting = entries?.filter((entry): entry is Extract<ImportEntry, { stage: 'waiting' }> => entry.stage === 'waiting') ?? []
  const finished = entries?.filter((entry): entry is Exclude<ImportEntry, { stage: 'waiting' }> => entry.stage !== 'waiting') ?? []

  return <AppShell crumbs={[{ label: 'Home', href: '/' }, { label: 'Imports' }]} persistentStorage={persistentStorage}>
    <header className="collection-heading">
      <h1>Imports</h1>
      <div className="collection-actions">
        <Link href="/get-started/convert" className="secondary-button">Convert a test</Link>
        <button type="button" className="primary-button" onClick={onImport}>Import</button>
      </div>
    </header>
    {entries === null
      ? <p className="import-list-status" role="status">Loading imports…</p>
      : entries.length === 0
        ? <div className="home-empty">
            <h2>No imports yet</h2>
            <p>Every test you convert and every file you import is listed here.</p>
          </div>
        : <>
            {waiting.length > 0 && <section className="import-section" aria-labelledby="imports-waiting">
              <h2 id="imports-waiting">In progress</h2>
              <ul className="import-list">
                {waiting.map((entry) => (
                  <WaitingRow
                    key={entry.id}
                    entry={entry}
                    onDiscard={() => void discardWaitingImport(entry.id).then(() => setReload((count) => count + 1))}
                  />
                ))}
              </ul>
            </section>}
            {finished.length > 0 && <section className="import-section" aria-labelledby="imports-history">
              <h2 id="imports-history">History</h2>
              <ul className="import-list">
                {finished.map((entry) => <FinishedRow key={entry.id} entry={entry} picturesNeeded={needed.get(entry.id)} />)}
              </ul>
            </section>}
          </>}
  </AppShell>
}

/** One import still waiting, continued where it was left: its steps, and
 *  the drop for the file the AI gives back. */
export function WaitingImportPage({
  id,
  persistentStorage,
  revision,
  onReturnedFile,
}: {
  id: string
  persistentStorage: PersistentStorageStatus
  revision: number
  onReturnedFile: (file: File) => void
}) {
  const [waiting, setWaiting] = useState<WaitingImport | null | 'loading'>('loading')
  useEffect(() => {
    let current = true
    void readWaitingImport(id).then((found) => { if (current) setWaiting(found) }, () => { if (current) setWaiting(null) })
    return () => { current = false }
  }, [id, revision])
  const name = waiting && waiting !== 'loading' ? waiting.fileName : 'Import'
  return <AppShell
    crumbs={[{ label: 'Home', href: '/' }, { label: 'Imports', href: '/imports' }, { label: name }]}
    persistentStorage={persistentStorage}
  >
    <div className="import-page">
      {waiting === 'loading'
        ? <p className="import-list-status" role="status">Loading…</p>
        : waiting
          ? <SourceDocumentSteps
              waiting={waiting}
              named
              onReturnedFile={onReturnedFile}
              onStartOver={() => void discardWaitingImport(id).then(() => window.location.assign('/imports'))}
            />
          : <div className="home-empty">
              <h2>This import is no longer waiting</h2>
              <p>It was imported, discarded, or expired. <Link href="/imports">See every import</Link>.</p>
            </div>}
    </div>
  </AppShell>
}
