import { useEffect, useState } from 'react'
import { Check, Copy, Download, ImageIcon, UploadCloud } from 'lucide-react'
import extractInstructions from '../public/extract.md?raw'
import { fillImageTags } from './image-tag-list'
import type { WaitingImport } from './waiting-import'

/**
 * What to do with the test a teacher just dropped, while its import waits for
 * the AI. Only one of three paths is ever shown, the one the file needs:
 *
 * - a PDF or Word document with pictures goes to the AI as a labeled copy,
 *   so it can say which picture goes where by the number printed on it;
 * - one without pictures goes as it is, with the plain instructions;
 * - a photo goes as it is, and each picture in it is cropped after importing.
 *
 * In every path the AI never estimates where a picture is; Test Parrot takes
 * the pictures from the file itself.
 */

const ASSISTANTS = [
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/new' },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app' },
] as const

const plural = (count: number, singular: string) => `${count} ${count === 1 ? singular : `${singular}s`}`

export function SourceDocumentSteps({
  waiting,
  onReturnedFile,
  onStartOver,
  busy = false,
}: {
  waiting: WaitingImport
  /** The file the AI gave back, dropped or chosen here. */
  onReturnedFile: (file: File) => void
  onStartOver: () => void
  busy?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const [assistant, setAssistant] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  const photo = waiting.kind === 'photo'
  const word = waiting.kind === 'word'
  const pictures = !photo && waiting.tags.length > 0
  // A photo's page has nothing tagged on it; it gets the instructions for a
  // source with no labeled copy, which name every picture by page 1.
  const instructions = fillImageTags(extractInstructions, photo ? null : waiting.tags, word ? 'word' : 'pdf')
  const copy = () => void navigator.clipboard.writeText(instructions).then(() => setCopied(true))
  /** What the teacher calls the file they dropped. */
  const file = photo ? 'photo' : word ? 'document' : 'PDF'
  const attach = pictures ? `the labeled ${file} (not your original)` : `your ${file}`

  const download = async () => {
    setError(null)
    try {
      let labeled: { bytes: Uint8Array; type: string; name: string }
      if (word) {
        const { labelWordDocument, labeledWordFilename, WORD_MIME_TYPE } = await import('./word-document')
        labeled = { bytes: await labelWordDocument(waiting.bytes), type: WORD_MIME_TYPE, name: labeledWordFilename(waiting.fileName) }
      } else {
        const [{ labelSourceDocument, labeledFilename }, { browserPdfFonts }] = await Promise.all([
          import('./source-document'),
          import('./pdf-export'),
        ])
        labeled = {
          bytes: await labelSourceDocument(waiting.bytes, waiting.tags, browserPdfFonts),
          type: 'application/pdf',
          name: labeledFilename(waiting.fileName),
        }
      }
      const url = URL.createObjectURL(new Blob([labeled.bytes.slice().buffer as ArrayBuffer], { type: labeled.type }))
      const link = document.createElement('a')
      link.href = url
      link.download = labeled.name
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `The labeled ${file} could not be made.`)
    }
  }

  const steps = [
    ...(pictures
      ? [{
          key: 'download',
          title: `Download the labeled ${file}`,
          text: word
            ? 'A copy of your document with a small number just before each picture.'
            : 'A copy of your test with a small number on each picture.',
          action: <button type="button" className="secondary-button" disabled={busy} onClick={() => void download()}>
            <Download aria-hidden="true" />Download labeled {file}
          </button>,
        }]
      : []),
    {
      key: 'copy',
      title: 'Copy the instructions',
      text: pictures ? 'They list those picture numbers, so the AI can say which picture goes where.' : 'They tell the AI exactly what file to make.',
      action: <button type="button" className="secondary-button" disabled={busy} onClick={copy}>
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {copied ? 'Copied' : 'Copy instructions'}
      </button>,
    },
    {
      key: 'assistant',
      title: 'Open your AI',
      text: `Paste the instructions, attach ${attach}, and send.`,
      action: <select
        className="convert-select"
        aria-label="Open an AI assistant"
        value={assistant}
        disabled={busy}
        onChange={(event) => {
          const chosen = ASSISTANTS.find(({ id }) => id === event.target.value)
          if (!chosen) return
          setAssistant(chosen.id)
          // The chat that opens is a place to paste: these instructions are
          // what should be there to paste.
          void navigator.clipboard.writeText(instructions).catch(() => undefined)
          window.open(chosen.url, '_blank', 'noopener')
        }}
      >
        <option value="" disabled>Open…</option>
        {ASSISTANTS.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
      </select>,
    },
  ]

  return <section className="source-steps" aria-label="Convert your test">
    <header className="source-steps-head" data-pictures={pictures ? 'true' : undefined}>
      {pictures && <ImageIcon aria-hidden="true" />}
      <div>
        <h2 role="status">
          {pictures
            ? `Pictures detected in your ${file}`
            : photo
              ? 'A photo of your test'
              : `No pictures in your ${file}`}
        </h2>
        <p>
          {pictures
            ? `Test Parrot found ${plural(waiting.tags.length, 'picture')} in ${waiting.fileName}. Give your AI the labeled copy below, and Test Parrot fills in the real pictures when you import.`
            : photo
              ? `Your AI writes the questions from ${waiting.fileName}. After importing, you crop each picture from the photo.`
              : `${waiting.fileName} has no pictures to keep track of, so your AI only needs the ${file} itself.`}
        </p>
      </div>
    </header>

    <ol className="source-steps-list">
      {steps.map((step) => <li key={step.key}>
        <div>
          <strong>{step.title}</strong>
          <span>{step.text}</span>
        </div>
        {step.action}
      </li>)}
      <li className="source-steps-return">
        <div>
          <strong>Drop the file it gives back</strong>
          <span>A <code>.parrot.json</code> file. You check every question{pictures || photo ? ' and picture' : ''} before anything is imported.</span>
        </div>
        <label className="bank-import-drop">
          <input
            type="file"
            aria-label="File from your AI"
            accept="application/json,.json"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) onReturnedFile(file)
            }}
          />
          <UploadCloud aria-hidden="true" />
          <strong>Drop the .parrot.json here</strong>
          <span>or click to choose it</span>
        </label>
      </li>
    </ol>

    {error && <p className="home-error" role="alert">{error}</p>}
    <p className="source-steps-foot">
      <span>Your {file} stays in this browser only until this import finishes, for at most seven days.</span>
      <button type="button" className="link-button" disabled={busy} onClick={onStartOver}>Start over with another file</button>
    </p>
  </section>
}
