import { useEffect, useId, useState } from 'react'
import { ClipboardCheck, ClipboardPaste } from 'lucide-react'
import extractInstructions from '../public/extract.md?raw'
import { fillImageTags } from './image-tag-list'
import { SUPPORTED_SOURCES } from './question-formats/catalog'

/**
 * What sits under every drop zone that starts an import: the tools whose
 * files come straight in with no AI, and, for questions a teacher has only
 * as text, a box to paste them into — read the way a dropped text file is —
 * or the instructions to give an AI with them.
 */

export function SupportedSources() {
  return <div className="import-sources" aria-label="Question files read without AI">
    <span>Reads without AI</span>
    <ul>{SUPPORTED_SOURCES.map((source) => <li key={source}>{source}</li>)}</ul>
  </div>
}

export function TextOnlyChoices({ busy, onPaste }: {
  busy: boolean
  /** The pasted questions, as the text file they would have been saved as. */
  onPaste: (file: File) => void
}) {
  const textId = useId()
  const [pasting, setPasting] = useState(false)
  const [pasted, setPasted] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  return <>
    {pasting ? (
      <form
        className="import-paste"
        onSubmit={(event) => {
          event.preventDefault()
          if (pasted.trim()) onPaste(new File([pasted], 'Pasted questions.txt', { type: 'text/plain' }))
        }}
      >
        <label htmlFor={textId}>Paste your questions</label>
        <textarea
          id={textId}
          value={pasted}
          rows={10}
          spellCheck={false}
          autoFocus
          placeholder={'MC\nWhich flower grows almost anywhere?\na rose\n*a dandelion\nan orchid\n\nTF\nDandelions are perennials.\nT'}
          onChange={(event) => setPasted(event.target.value)}
        />
        <p>
          Written for the Blackboard Test Generator, Blackboard, Aiken, GIFT, Respondus or another
          format Test Parrot reads. Leave a blank line between questions.
        </p>
        <div className="import-paste-actions">
          <button type="button" className="secondary-button" onClick={() => setPasting(false)}>Cancel</button>
          <button type="submit" className="primary-button" disabled={busy || !pasted.trim()}>
            Read my questions
          </button>
        </div>
      </form>
    ) : (
      <p className="convert-text-only">
        Only have it as text?{' '}
        <button type="button" className="link-button" disabled={busy} onClick={() => setPasting(true)}>
          <ClipboardPaste aria-hidden="true" /> Paste your questions
        </button>
        , or{' '}
        <button
          type="button"
          className="link-button"
          onClick={() => void navigator.clipboard
            .writeText(fillImageTags(extractInstructions, null))
            .then(() => setCopied(true))}
        >
          copy the instructions
        </button>{' '}
        and paste them into your AI with it.
      </p>
    )}
    {copied && (
      <div className="copied-toast" role="status">
        <ClipboardCheck aria-hidden="true" /> Instructions copied
      </div>
    )}
  </>
}
