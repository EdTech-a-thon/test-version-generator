import { useEffect, useRef, useState } from 'react'
import { ClipboardCheck, UploadCloud } from 'lucide-react'
import extractInstructions from '../public/extract.md?raw'
import { fillImageTags } from './image-tag-list'
import { TEST_FILE_TYPES, kindOfFile, startWaitingImport, unsupportedFileMessage } from './source-file'
import { inspectUploadedFile } from './question-bank-upload'
import { LandingHeader } from './landing-page'
import { Footer, Link } from './site-chrome'
import { navigate } from './use-route'

/**
 * The second onboarding page, for a teacher with a test already in hand. It
 * asks for one thing: the test. A test to convert starts a new import and
 * opens its page in Imports, where the steps for that file wait — and where
 * the teacher finds it again after their AI chat. A Test Parrot file goes
 * straight to the import.
 */
export function ConvertPage({
  dropped,
  onOpenImport,
}: {
  /** A file dropped anywhere on the page, taken as if dropped on the zone. */
  dropped: { file: File; id: number } | null
  /** Open the import for a Test Parrot file. */
  onOpenImport: (file: File) => void
}) {
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justCopied, setJustCopied] = useState(false)
  useEffect(() => {
    if (!justCopied) return
    const timer = window.setTimeout(() => setJustCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [justCopied])

  const take = async (file: File) => {
    setError(null)
    const kind = kindOfFile(file)
    if (kind === 'record') return onOpenImport(file)
    if (kind === 'other') return setError(unsupportedFileMessage(file))
    setReading(true)
    try {
      if (kind === 'pdf') {
        // A Question Bank File or an Exam PDF already is a Test Parrot file.
        try {
          await inspectUploadedFile(file)
          setReading(false)
          return onOpenImport(file)
        } catch (reason) {
          const code = reason instanceof Error && 'code' in reason ? reason.code : null
          if (code !== 'missing-attachment') throw reason
        }
      }
      const started = await startWaitingImport(file)
      navigate(`/import?id=${encodeURIComponent(started.id)}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'This file could not be read.')
      setReading(false)
    }
  }

  const taken = useRef<number | null>(null)
  useEffect(() => {
    if (!dropped || taken.current === dropped.id) return
    taken.current = dropped.id
    void take(dropped.file)
  })

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
          <p className="landing-lede">
            An AI assistant turns your test into a file Test Parrot imports: your questions, the
            test laid out as you gave it, and its pictures.
          </p>
        </div>

        <div className="convert-body">
          {error && <p className="home-error" role="alert">{error}</p>}
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
