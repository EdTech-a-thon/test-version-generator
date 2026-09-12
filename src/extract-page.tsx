import { useEffect, useState } from 'react'
import { marked } from 'marked'
import type { PersistentStorageStatus } from './durable-storage'
import { AppShell } from './app-shell'
import instructions from '../public/extract.md?raw'

/**
 * The instructions an AI assistant follows to turn a teacher's PDF, scan or
 * document into an importable Question Bank Record. The Markdown in `public/`
 * is the one source: it stays fetchable raw at `/extract.md` for assistants
 * that read URLs, and this page renders the same text for a teacher to read or
 * copy into a chat.
 */
const INSTRUCTIONS_HTML = marked.parse(instructions, { async: false })

export function ExtractPage({
  persistentStorage,
}: {
  persistentStorage: PersistentStorageStatus
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])
  const copy = () => { void navigator.clipboard.writeText(instructions).then(() => setCopied(true)) }
  return (
    <AppShell
      crumbs={[{ label: 'Home', href: '/' }, { label: 'Extract' }]}
      persistentStorage={persistentStorage}
      actions={
        <button type="button" className="secondary-button" onClick={copy}>
          {copied ? 'Copied' : 'Copy instructions'}
        </button>
      }
    >
      <div className="site-prose">
        <p className="site-lede">
          Paste these instructions into an AI assistant along with your existing test, or give it
          the link <a href="/extract.md">testparrot.com/extract.md</a>, to get a file you can drag
          into Test Parrot.
        </p>
        <section className="site-card site-markdown" dangerouslySetInnerHTML={{ __html: INSTRUCTIONS_HTML }} />
      </div>
    </AppShell>
  )
}
