import { useEffect, useState } from 'react'
import { Check, ClipboardCheck, Copy, Download, FileUp } from 'lucide-react'
import extractInstructions from '../public/extract.md?raw'
import { fillImageTags } from './image-tag-list'
import { readWaitingImport, type WaitingImport } from './waiting-import'
import { LandingHeader } from './landing-page'
import { Footer, Link } from './site-chrome'

/**
 * The second onboarding page, for a teacher with a test already in hand. The
 * trip starts from their own PDF: Test Parrot numbers its pictures on a
 * labeled copy, the assistant is given that copy and the instructions that
 * list those numbers, and the file it gives back is dropped here — where each
 * picture is filled in from the original. Five moves, so the page is the five
 * moves in order, with the ones the app can do for you done from the step
 * itself. Dropping the returned file needs no zone of its own: the whole page
 * already takes one, which is the point of the last step.
 *
 * A test that is only a photo, a Word document or pasted text has no PDF to
 * start from; it converts from the instructions alone, and its pictures are
 * added after importing.
 */

const ASSISTANTS = [
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/new' },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app' },
] as const

type AssistantId = (typeof ASSISTANTS)[number]['id']

/** The instructions for the import that is waiting, listing its tags; with
 *  none waiting, the instructions for a source with no labeled copy. */
function copyInstructions(waiting: WaitingImport | null): Promise<void> {
  return navigator.clipboard.writeText(fillImageTags(extractInstructions, waiting?.tags ?? null))
}

function StepMark({ number, done }: { number: number; done: boolean }) {
  return (
    <span className="convert-step-mark" data-done={done ? 'true' : undefined}>
      {done ? <Check aria-hidden="true" /> : number}
      {done && <span className="sr-only">Done: </span>}
    </span>
  )
}

export function ConvertPage({
  importOpen,
  onOpenImport,
}: {
  /** Whether the import dialog is showing, so the page knows to look again
   *  for a waiting import once it closes. */
  importOpen: boolean
  /** Opens the import dialog, with a file when one was chosen here. */
  onOpenImport: (file?: File) => void
}) {
  const [waiting, setWaiting] = useState<WaitingImport | null>(null)
  const [justCopied, setJustCopied] = useState(false)
  const [assistant, setAssistant] = useState<AssistantId | ''>('')
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

  const copy = () => {
    void copyInstructions(null).then(() => setJustCopied(true))
  }
  const open = (id: AssistantId) => {
    const chosen = ASSISTANTS.find((candidate) => candidate.id === id)
    if (!chosen) return
    setAssistant(id)
    // The chat that opens is a place to paste, so make sure the instructions
    // for this test — its picture numbers and all — are what is there to paste.
    void copyInstructions(waiting).catch(() => undefined)
    window.open(chosen.url, '_blank', 'noopener')
  }
  const assistantName = ASSISTANTS.find((candidate) => candidate.id === assistant)?.name

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
            Any AI assistant can turn your test’s PDF into a file Test Parrot imports: your
            questions, the test laid out as you gave it, and every graph, map and diagram from
            the original. Five steps, a few minutes.
          </p>
        </div>

        <div className="convert-body">
          <ol className="convert-steps" aria-label="Steps">
            <li>
              <StepMark number={1} done={waiting !== null} />
              <div className="convert-step-text">
                <strong>Drop your test’s PDF here</strong>
                <span>
                  {waiting
                    ? `${waiting.fileName} is ready: Test Parrot numbered its ${waiting.tags.length === 1 ? 'picture' : `${waiting.tags.length} pictures`} so the AI can say which goes where.`
                    : 'Test Parrot numbers each picture in it so the AI can say which goes where. The PDF stays in this browser.'}
                </span>
              </div>
              <label className="secondary-button convert-step-action convert-file">
                <FileUp aria-hidden="true" />
                {waiting ? 'Choose another PDF' : 'Choose PDF'}
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  aria-label="Your test’s PDF"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) onOpenImport(file)
                  }}
                />
              </label>
            </li>
            <li>
              <StepMark number={2} done={false} />
              <div className="convert-step-text">
                <strong>Download the labeled PDF and copy the instructions</strong>
                <span>
                  Both are in the window that opens. The labeled copy has a small number on each
                  picture, and the instructions list those numbers.
                </span>
              </div>
              {waiting && (
                <button type="button" className="secondary-button convert-step-action" onClick={() => onOpenImport()}>
                  <Download aria-hidden="true" />
                  Open them
                </button>
              )}
            </li>
            <li>
              <StepMark number={3} done={assistant !== ''} />
              <div className="convert-step-text">
                <strong>Open ChatGPT, Claude or Gemini — whichever you use</strong>
                <span>
                  {assistantName
                    ? `${assistantName} is open in a new tab. Paste the instructions, attach the labeled PDF, and send.`
                    : 'Paste the instructions into a new chat, attach the labeled PDF — not the original — and send.'}
                </span>
              </div>
              <select
                className="convert-step-action convert-select"
                aria-label="Open an AI assistant"
                value={assistant}
                onChange={(event) => open(event.target.value as AssistantId)}
              >
                <option value="" disabled>
                  Open…
                </option>
                {ASSISTANTS.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </li>
            <li>
              <StepMark number={4} done={false} />
              <div className="convert-step-text">
                <strong>Download the question file</strong>
                <span>
                  It replies with a <code>.parrot.json</code>. Save it.
                </span>
              </div>
            </li>
            <li>
              <StepMark number={5} done={false} />
              <div className="convert-step-text">
                <strong>Drop that file here</strong>
                <span>
                  Literally anywhere on this page — just drag it in. The pictures are filled in
                  from your PDF, and you’ll see every question and picture before anything is
                  imported.
                </span>
              </div>
            </li>
          </ol>

          <div className="convert-alternative">
            <p>
              <strong>Only have a photo, a Word document or pasted text?</strong>{' '}
              Copy the instructions and give them to the AI with your test instead of steps 1 and 2.
              You’ll add its pictures after importing.
            </p>
            <button type="button" className="secondary-button convert-step-action" onClick={copy}>
              {justCopied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {justCopied ? 'Copied' : 'Copy instructions'}
            </button>
          </div>
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
