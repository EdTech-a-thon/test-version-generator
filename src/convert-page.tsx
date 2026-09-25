import { useEffect, useRef, useState } from 'react'
import { ClipboardCheck, UploadCloud } from 'lucide-react'
import extractInstructions from '../public/extract.md?raw'
import { fillImageTags } from './image-tag-list'
import { discardWaitingImport, readWaitingImport, type WaitingImport } from './import-history'
import { SourceDocumentSteps } from './source-document-steps'
import { TEST_FILE_TYPES, kindOfFile, startWaitingImport, unsupportedFileMessage } from './source-file'
import { inspectUploadedFile } from './question-bank-upload'
import { LandingHeader } from './landing-page'
import { Footer, Link } from './site-chrome'

/**
 * The second onboarding page, for a teacher with a test already in hand. It
 * asks for one thing: the test. What happens next depends on what was
 * dropped, so the page shows nothing else until it knows — then, in place,
 * the one path that file needs (see `SourceDocumentSteps`). A Test Parrot
 * file, or the file the AI gives back, goes straight to the import.
 *
 * Every visit starts a new import. The one this page started is named in its
 * address (`?import=`), so a reload while the teacher is in their AI chat
 * comes back to it; any other import part-way through waits in Imports.
 */

const IMPORT_PARAMETER = 'import'

/** Name the import this page is converting in its address, or none. */
function rememberImport(id: string | null) {
  const url = new URL(window.location.href)
  if (id) url.searchParams.set(IMPORT_PARAMETER, id)
  else url.searchParams.delete(IMPORT_PARAMETER)
  window.history.replaceState(window.history.state, '', url)
}
export function ConvertPage({
  dropped,
  importOpen,
  onOpenImport,
}: {
  /** A file dropped anywhere on the page, taken as if dropped on the zone. */
  dropped: { file: File; id: number } | null
  /** Whether the import dialog is showing, so the page looks again for the
   *  waiting import once it closes: importing finishes it. */
  importOpen: boolean
  /** Open the import, for the file the AI gave back to the import it
   *  answers when there is one. */
  onOpenImport: (file: File, waitingImportId?: string) => void
}) {
  const [waiting, setWaiting] = useState<WaitingImport | null>(null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justCopied, setJustCopied] = useState(false)
  useEffect(() => {
    if (!justCopied) return
    const timer = window.setTimeout(() => setJustCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [justCopied])
  // Looked for again whenever the import closes: importing finishes it.
  useEffect(() => {
    if (importOpen) return
    const id = new URLSearchParams(window.location.search).get(IMPORT_PARAMETER)
    if (!id) return
    let current = true
    void readWaitingImport(id).then((found) => {
      if (!current) return
      setWaiting(found)
      if (!found) rememberImport(null)
    }, () => undefined)
    return () => { current = false }
  }, [importOpen])

  const start = async (file: File) => {
    setReading(true)
    setError(null)
    try {
      const started = await startWaitingImport(file)
      setWaiting(started)
      rememberImport(started.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'This file could not be read.')
    } finally {
      setReading(false)
    }
  }

  const take = async (file: File) => {
    setError(null)
    const kind = kindOfFile(file)
    if (kind === 'record') return onOpenImport(file, waiting?.id)
    if (kind === 'other') return setError(unsupportedFileMessage(file))
    if (kind === 'pdf') {
      // A Question Bank File or an Exam PDF already is a Test Parrot file.
      setReading(true)
      try {
        await inspectUploadedFile(file)
        setReading(false)
        return onOpenImport(file)
      } catch (reason) {
        setReading(false)
        const code = reason instanceof Error && 'code' in reason ? reason.code : null
        if (code !== 'missing-attachment') {
          return setError(reason instanceof Error ? reason.message : 'This PDF could not be read.')
        }
      }
    }
    await start(file)
  }

  const taken = useRef<number | null>(null)
  useEffect(() => {
    if (!dropped || taken.current === dropped.id) return
    taken.current = dropped.id
    void take(dropped.file)
  })

  const startOver = async () => {
    if (waiting) await discardWaitingImport(waiting.id).catch(() => undefined)
    setWaiting(null)
    rememberImport(null)
    setError(null)
  }

  return (
    <div className="landing landing--onboarding landing--convert">
      <LandingHeader>
        <Link href="/get-started" className="site-link">
          Back
        </Link>
        <Link href="/about" className="site-link">
          About
        </Link>
      </LandingHeader>

      <main className="convert">
        <div className="convert-head">
          {waiting
            ? <h1 className="convert-title" title={waiting.fileName}>
                <span>Converting</span> <span className="convert-title-name">{waiting.fileName}</span>
              </h1>
            : <h1>Convert a test you already have</h1>}
          {!waiting && (
            <p className="landing-lede">
              An AI assistant turns your test into a file Test Parrot imports: your questions, the
              test laid out as you gave it, and its pictures.
            </p>
          )}
        </div>

        <div className="convert-body">
          {error && <p className="home-error" role="alert">{error}</p>}
          {waiting ? (
            <SourceDocumentSteps
              waiting={waiting}
              busy={reading}
              onReturnedFile={(file) => void take(file)}
              onStartOver={() => void startOver()}
            />
          ) : (
            <>
              <label className="bank-import-drop convert-drop">
                <input
                  type="file"
                  aria-label="Your test"
                  accept={`${TEST_FILE_TYPES},application/json,.json`}
                  disabled={reading}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) void take(file)
                  }}
                />
                <UploadCloud aria-hidden="true" />
                <strong>{reading ? 'Reading your test…' : 'Drop your PDF here to get started'}</strong>
                <span>or click to choose it. A Word document or a photo of your test works too.</span>
              </label>
              <p className="convert-text-only">
                Only have it as text?{' '}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => void navigator.clipboard
                    .writeText(fillImageTags(extractInstructions, null))
                    .then(() => setJustCopied(true))}
                >
                  Copy the instructions
                </button>{' '}
                and paste them into your AI with it.
              </p>
            </>
          )}
        </div>
      </main>

      {justCopied && (
        <div className="copied-toast" role="status">
          <ClipboardCheck aria-hidden="true" /> Instructions copied
        </div>
      )}

      <Footer />
    </div>
  )
}
