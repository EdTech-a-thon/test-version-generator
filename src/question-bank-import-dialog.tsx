import { useEffect, useId, useRef, useState } from 'react'
import type { QuestionBankImportProposal } from './question-bank-import'

export function QuestionBankImportDialog({
  onClose,
  onImport,
}: {
  onClose: () => void
  onImport: (
    proposal: QuestionBankImportProposal,
    proposedName: string,
  ) => Promise<void>
}) {
  const titleId = useId()
  const dialog = useRef<HTMLElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [proposal, setProposal] = useState<QuestionBankImportProposal | null>(null)
  const [proposedName, setProposedName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<'choose' | 'inspecting' | 'saving'>('choose')
  const busy = phase !== 'choose'
  const busyRef = useRef(busy)
  busyRef.current = busy

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    requestAnimationFrame(() => input.current?.focus())
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const controls = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled)',
        ) ?? [],
      )
      if (!controls.length) return
      const first = controls[0]!
      const last = controls.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      requestAnimationFrame(() => {
        if (previous?.isConnected) previous.focus()
      })
    }
  }, [onClose])

  useEffect(() => {
    if (error && phase === 'choose') input.current?.focus()
  }, [error, phase])

  const inspect = (file: File) => {
    setPhase('inspecting')
    setProposal(null)
    setError(null)
    void file
      .arrayBuffer()
      .then(async (bytes) => {
        const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs')
        pdf.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
          import.meta.url,
        ).href
        const { inspectQuestionBankFile } = await import('./question-bank-import')
        return inspectQuestionBankFile(new Uint8Array(bytes))
      })
      .then((next) => {
        setProposal(next)
        setProposedName(next.summary.bankName)
        requestAnimationFrame(() =>
          dialog.current
            ?.querySelector<HTMLInputElement>('[aria-label="New Question Bank name"]')
            ?.focus(),
        )
      })
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error && reason.message
            ? reason.message
            : 'This Question Bank File could not be inspected safely.',
        )
        setPhase('choose')
      })
      .then(() => setPhase('choose'))
  }

  const confirm = async () => {
    if (!proposal || busy) return
    setPhase('saving')
    setError(null)
    try {
      await onImport(proposal, proposedName)
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message
          ? `The Question Bank could not be saved: ${reason.message}`
          : 'The Question Bank could not be saved. Check browser storage and try again.',
      )
      setPhase('choose')
    }
  }

  return (
    <div className="export-dialog-backdrop" role="presentation">
      <section
        ref={dialog}
        className="export-dialog bank-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
      >
        <header className="export-dialog-heading">
          <div>
            <p className="export-dialog-eyebrow">Question Bank File</p>
            <h2 id={titleId}>Import Question Bank</h2>
          </div>
        </header>
        <p>
          Choose a Test Parrot Question Bank PDF. Inspection reads its canonical
          record—not its visible PDF pages—and changes nothing until you import.
        </p>
        <label className="bank-import-file">
          <span>Question Bank PDF</span>
          <input
            ref={input}
            type="file"
            accept="application/pdf,.pdf"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) inspect(file)
            }}
          />
        </label>
        <div className="bank-import-announcements" aria-live="polite" aria-atomic="true">
          {phase === 'inspecting' && <p role="status">Validating Question Bank File…</p>}
          {phase === 'saving' && <p role="status">Creating Question Bank…</p>}
          {error && <p className="home-error" role="alert">{error}</p>}
        </div>
        {proposal && (
          <section aria-label="Import confirmation">
            <h3>Review the new independent Question Bank</h3>
            <label className="bank-import-name">
              <span>New Question Bank name</span>
              <input
                autoFocus
                value={proposedName}
                disabled={busy}
                onChange={(event) => setProposedName(event.target.value)}
              />
            </label>
            <p>
              <strong>Record integrity verified.</strong> Author identity and the
              visible PDF pages are not verified.
            </p>
            {(proposal.record.bank.description || proposal.record.bank.author || proposal.record.bank.license) && (
              <dl>
                {proposal.record.bank.description && <div><dt>Description</dt><dd>{proposal.record.bank.description}</dd></div>}
                {proposal.record.bank.author && <div><dt>Declared author (unverified)</dt><dd>{proposal.record.bank.author}</dd></div>}
                {proposal.record.bank.license && <div><dt>License</dt><dd>{proposal.record.bank.license.name}{proposal.record.bank.license.url ? ` — ${proposal.record.bank.license.url}` : ''}</dd></div>}
              </dl>
            )}
            <dl>
              <div><dt>Format version</dt><dd>{proposal.summary.formatVersion}</dd></div>
              <div><dt>Multiple Choice</dt><dd>{proposal.summary.questionCounts['multiple-choice']}</dd></div>
              <div><dt>Short Answer</dt><dd>{proposal.summary.questionCounts['short-answer']}</dd></div>
              <div><dt>Incomplete Multiple Choice</dt><dd>{proposal.summary.incompleteMultipleChoice}</dd></div>
              <div><dt>Topics</dt><dd>{proposal.summary.topics.join(', ') || 'None'}</dd></div>
              <div><dt>Media Assets</dt><dd>{proposal.summary.mediaAssets} ({proposal.summary.decodedMediaBytes} bytes)</dd></div>
              <div><dt>External links</dt><dd>{proposal.summary.externalLinks ? 'Present' : 'None'}</dd></div>
            </dl>
            <p>Import always creates a new bank. Duplicate names are allowed; nothing is merged or replaced.</p>
          </section>
        )}
        <footer className="dialog-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          {proposal && (
            <button
              type="button"
              className="primary-button"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {phase === 'saving' ? 'Creating Question Bank…' : 'Import Question Bank'}
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}
