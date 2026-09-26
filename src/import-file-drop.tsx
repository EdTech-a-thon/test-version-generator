import { useEffect, useRef, useState } from 'react'
import { ClipboardCheck, UploadCloud } from 'lucide-react'
import extractInstructions from '../public/extract.md?raw'
import { fillImageTags } from './image-tag-list'
import { ImportError } from './import-error'
import { routeImportFile } from './import-file-route'
import { TEST_FILE_TYPES } from './source-file'
import { navigate } from './use-route'

/**
 * The one place an import starts: a drop for the test itself, or for the
 * file an AI made from it (see `routeImportFile`). A new import, or the one
 * in progress a file answers, opens on its page in Imports.
 */
export function ImportFileDrop({
  dropped,
  onOpenImport,
}: {
  /** A file dropped anywhere on the page, taken as if dropped on the zone. */
  dropped: { file: File; id: number } | null
  /** Open the import dialog for a file, continuing the import it answers
   *  when there is one. */
  onOpenImport: (file: File, waitingImportId?: string) => void
}) {
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<{ message: string; aiMade?: boolean } | null>(null)
  const [justCopied, setJustCopied] = useState(false)
  useEffect(() => {
    if (!justCopied) return
    const timer = window.setTimeout(() => setJustCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [justCopied])

  const take = async (file: File) => {
    setError(null)
    setReading(true)
    const route = await routeImportFile(file)
    setReading(false)
    if (route.to === 'error') return setError(route)
    if (route.to === 'import') return onOpenImport(file)
    const id = route.to === 'waiting' ? route.waiting.id : route.waitingImportId
    navigate(`/import?id=${encodeURIComponent(id)}`)
    if (route.to === 'answer') onOpenImport(file, id)
  }

  const taken = useRef<number | null>(null)
  useEffect(() => {
    if (!dropped || taken.current === dropped.id) return
    taken.current = dropped.id
    void take(dropped.file)
  })

  return <>
    {error && <ImportError message={error.message} aiMade={error.aiMade} />}
    <label className="bank-import-drop convert-drop">
      <input
        type="file"
        aria-label="Your test, or the file your AI gave back"
        accept={`${TEST_FILE_TYPES},application/json,.json`}
        disabled={reading}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void take(file)
        }}
      />
      <UploadCloud aria-hidden="true" />
      <strong>{reading ? 'Reading your file…' : 'Drop your test here to get started'}</strong>
      <span>
        or click to choose it: a PDF, a Word document or a photo of your test. The file your AI
        gave back goes here too.
      </span>
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
    {justCopied && (
      <div className="copied-toast" role="status">
        <ClipboardCheck aria-hidden="true" /> Instructions copied
      </div>
    )}
  </>
}
