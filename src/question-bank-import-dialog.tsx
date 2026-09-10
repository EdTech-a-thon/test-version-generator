import { useRef, useState } from 'react'
import type { QuestionBankImportProposal } from './question-bank-import'

export function QuestionBankImportDialog({
  onClose,
}: {
  onClose: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [proposal, setProposal] = useState<QuestionBankImportProposal | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [inspecting, setInspecting] = useState(false)

  return (
    <div className="export-dialog-backdrop" role="presentation">
      <section
        className="export-dialog bank-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bank-import-title"
      >
        <header className="export-dialog-heading">
          <div>
            <p className="export-dialog-eyebrow">Question Bank File</p>
            <h2 id="bank-import-title">Inspect Question Bank PDF</h2>
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
        </header>
        <p>
          Inspection reads the PDF’s canonical Question Bank Record. It does not
          import, save, or change any resource.
        </p>
        <label className="bank-import-file">
          <span>Question Bank PDF</span>
          <input
            ref={input}
            autoFocus
            type="file"
            accept="application/pdf,.pdf"
            disabled={inspecting}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (!file) return
              setInspecting(true)
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
                  const { inspectQuestionBankFile } = await import(
                    './question-bank-import'
                  )
                  return inspectQuestionBankFile(new Uint8Array(bytes))
                })
                .then(setProposal)
                .catch((reason: unknown) => {
                  setError(
                    reason instanceof Error && reason.message
                      ? reason.message
                      : 'This Question Bank File could not be inspected safely.',
                  )
                  requestAnimationFrame(() => input.current?.focus())
                })
                .finally(() => setInspecting(false))
            }}
          />
        </label>
        {inspecting && <p role="status">Inspecting Question Bank File…</p>}
        {error && <p className="home-error" role="alert">{error}</p>}
        {proposal && (
          <section aria-label="Validated import proposal">
            <h3>{proposal.summary.bankName}</h3>
            <p>Record integrity verified. Generator identity and PDF pages are not verified.</p>
            <dl>
              <div><dt>Format version</dt><dd>{proposal.summary.formatVersion}</dd></div>
              <div><dt>Multiple Choice</dt><dd>{proposal.summary.questionCounts['multiple-choice']}</dd></div>
              <div><dt>Short Answer</dt><dd>{proposal.summary.questionCounts['short-answer']}</dd></div>
              <div><dt>Media Assets</dt><dd>{proposal.summary.mediaAssets}</dd></div>
            </dl>
            <p>Inspection succeeded. Import confirmation and durable creation are completed by the Question Bank import workflow.</p>
          </section>
        )}
      </section>
    </div>
  )
}
