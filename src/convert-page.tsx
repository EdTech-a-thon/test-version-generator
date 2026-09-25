import { useEffect, useRef, useState } from 'react'
import { ClipboardCheck, UploadCloud } from 'lucide-react'
import extractInstructions from '../public/extract.md?raw'
import { fillImageTags } from './image-tag-list'
import { discardWaitingImport, readWaitingImport, type WaitingImport } from './waiting-import'
import { SourceDocumentSteps } from './source-document-steps'
import { kindOfFile, startWaitingImport, unsupportedFileMessage } from './source-file'
import { inspectUploadedFile } from './question-bank-upload'
import { LandingHeader } from './landing-page'
import { Footer, Link } from './site-chrome'

/**
 * The second onboarding page, for a teacher with a test already in hand. It
 * asks for one thing: the test. What happens next depends on what was
 * dropped, so the page shows nothing else until it knows — then, in place,
 * the one path that file needs (see `SourceDocumentSteps`). A Test Parrot
 * file, or the file the AI gives back, goes straight to the import.
 */
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
  onOpenImport: (file: File) => void
}) {
  const [waiting, setWaiting] = useState<WaitingImport | null>(null)
  const [reading, setReading] = useState(false)
  const [replacing, setReplacing] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [justCopied, setJustCopied] = useState(false)
  useEffect(() => {
    if (!justCopied) return
    const timer = window.setTimeout(() => setJustCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [justCopied])
  useEffect(() => {
    if (importOpen) return
    let current = true
    void readWaitingImport().then((found) => { if (current) setWaiting(found) }, () => undefined)
    return () => { current = false }
  }, [importOpen])

  const start = async (file: File) => {
    setReplacing(null)
    setReading(true)
    setError(null)
    try {
      setWaiting(await startWaitingImport(file))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'This file could not be read.')
    } finally {
      setReading(false)
    }
  }

  const take = async (file: File) => {
    setError(null)
    const kind = kindOfFile(file)
    if (kind === 'record') return onOpenImport(file)
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
    if (waiting) return setReplacing(file)
    await start(file)
  }

  const taken = useRef<number | null>(null)
  useEffect(() => {
    if (!dropped || taken.current === dropped.id) return
    taken.current = dropped.id
    void take(dropped.file)
  })

  const startOver = async () => {
    await discardWaitingImport().catch(() => undefined)
    setWaiting(null)
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
          <h1>Convert a test you already have</h1>
          {!waiting && (
            <p className="landing-lede">
              An AI assistant turns your test into a file Test Parrot imports: your questions, the
              test laid out as you gave it, and its pictures.
            </p>
          )}
        </div>

        <div className="convert-body">
          {error && <p className="home-error" role="alert">{error}</p>}
          {replacing && waiting && (
            <div className="bank-import-assist" data-emphasis="true" role="alert">
              <span>
                <strong>You already started with {waiting.fileName}.</strong>{' '}
                Start again with {replacing.name} instead?
              </span>
              <span className="bank-import-assist-actions">
                <button type="button" className="secondary-button" onClick={() => setReplacing(null)}>Keep {waiting.fileName}</button>
                <button type="button" className="primary-button" onClick={() => void start(replacing)}>Start again</button>
              </span>
            </div>
          )}
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
                  accept="application/pdf,.pdf,image/*,application/json,.json"
                  disabled={reading}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) void take(file)
                  }}
                />
                <UploadCloud aria-hidden="true" />
                <strong>{reading ? 'Reading your test…' : 'Drop your PDF here to get started'}</strong>
                <span>or click to choose it. A photo of your test works too.</span>
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
