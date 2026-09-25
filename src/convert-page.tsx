import { useEffect, useState } from 'react'
import { Check, ClipboardCheck, Copy } from 'lucide-react'
import extractInstructions from '../public/extract.md?raw'
import { fillImageTags } from './image-tag-list'
import { LandingHeader } from './landing-page'
import { Footer, Link } from './site-chrome'

/**
 * The second onboarding page, for a teacher with a test already in hand. The
 * trip is: copy our instructions, open an AI, paste them, attach the test,
 * download the file it gives back, drop the file here. Five moves, so the
 * page is the five moves in order, with the two the app can do for you —
 * copying and opening — done from the step itself. Dropping the file needs
 * no zone of its own: the whole page already takes one, which is the point
 * of the last step.
 */

const ASSISTANTS = [
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/new' },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app' },
] as const

type AssistantId = (typeof ASSISTANTS)[number]['id']

/** Copied from here, the instructions go with no labeled copy: a teacher who
 *  wants pictures filled in drops their PDF into the import first. */
function copyInstructions(): Promise<void> {
  return navigator.clipboard.writeText(fillImageTags(extractInstructions, null))
}

function StepMark({ number, done }: { number: number; done: boolean }) {
  return (
    <span className="convert-step-mark" data-done={done ? 'true' : undefined}>
      {done ? <Check aria-hidden="true" /> : number}
      {done && <span className="sr-only">Done: </span>}
    </span>
  )
}

export function ConvertPage() {
  const [copied, setCopied] = useState(false)
  const [justCopied, setJustCopied] = useState(false)
  const [assistant, setAssistant] = useState<AssistantId | ''>('')
  useEffect(() => {
    if (!justCopied) return
    const timer = window.setTimeout(() => setJustCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [justCopied])

  const copy = () => {
    void copyInstructions().then(() => {
      setCopied(true)
      setJustCopied(true)
    })
  }
  const open = (id: AssistantId) => {
    const chosen = ASSISTANTS.find((candidate) => candidate.id === id)
    if (!chosen) return
    setAssistant(id)
    // The instructions go along for the ride whether or not step 1 was
    // pressed: the chat that opens is a place to paste, so make sure there is
    // something on the clipboard to paste.
    void copyInstructions().then(() => setCopied(true), () => undefined)
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
            Any AI assistant can turn a PDF, scan or screenshot into a file Test Parrot imports: your questions, and the test laid out as you gave it. Five
            steps, about a minute.
          </p>
        </div>

        <div className="convert-body">
          <ol className="convert-steps" aria-label="Steps">
            <li>
              <StepMark number={1} done={copied} />
              <div className="convert-step-text">
                <strong>Copy our instructions</strong>
                <span>They tell the AI exactly what file to make.</span>
              </div>
              <button type="button" className="secondary-button convert-step-action" onClick={copy}>
                {justCopied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {justCopied ? 'Copied' : 'Copy instructions'}
              </button>
            </li>
            <li>
              <StepMark number={2} done={assistant !== ''} />
              <div className="convert-step-text">
                <strong>Open ChatGPT, Claude or Gemini — whichever you use</strong>
                <span>
                  {assistantName
                    ? `${assistantName} is open in a new tab. Paste the instructions into the chat.`
                    : 'Then paste the instructions into a new chat.'}
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
              <StepMark number={3} done={false} />
              <div className="convert-step-text">
                <strong>Attach your test</strong>
                <span>The PDF, scan or screenshot, in the same message. Send it.</span>
              </div>
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
                  Literally anywhere on this page — just drag it in. You’ll see every question
                  before anything is imported.
                </span>
              </div>
            </li>
          </ol>
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
