import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ShieldCheck } from 'lucide-react'
import { DocView } from './doc-view'
import {
  recordDocumentToEditorNodes,
  type SemanticDocument,
} from './question-bank-export'
import { DifficultyBadge, TopicBadge } from './badges'
import type { Difficulty } from './exam'
import type { ProseMirrorJSON } from './question-doc'
import type { QuestionBankImportProposal } from './question-bank-import'

/** A JSON file carries the canonical record directly; a PDF carries it as an
 *  attachment. Nothing downstream can tell the two apart, because what is
 *  inspected, verified and imported is the same record either way. */
function isRecordFile(file: File): boolean {
  return file.type === 'application/json' || /\.json$/i.test(file.name)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Point a preview document's images at the bytes the record carries.
 *
 * `recordDocumentToEditorNodes` addresses an image as `/local-images/<hash>`,
 * which resolves only for a Question Bank that already lives here. Nothing has
 * been imported yet, so the preview would draw every image broken; the record's
 * own Media Assets are the only copy that exists, and they are already base64.
 */
function resolveMedia(
  node: ProseMirrorJSON,
  sources: Map<string, string>,
): ProseMirrorJSON {
  const attrs = node.attrs as Record<string, unknown> | null | undefined
  const resolved =
    attrs && typeof attrs.src === 'string' ? sources.get(attrs.src) : undefined
  return {
    ...node,
    ...(resolved ? { attrs: { ...attrs, src: resolved } } : {}),
    ...(Array.isArray(node.content)
      ? {
          content: (node.content as ProseMirrorJSON[]).map((child) =>
            resolveMedia(child, sources),
          ),
        }
      : {}),
  }
}

export function QuestionBankImportDialog({
  onClose,
  onImport,
  initialFile,
}: {
  onClose: () => void
  onImport: (
    proposal: QuestionBankImportProposal,
    proposedName: string,
  ) => Promise<void>
  /** A file already chosen elsewhere — dropped onto the page — inspected as
   *  soon as the dialog opens rather than asked for again. */
  initialFile?: File
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
        const importer = await import('./question-bank-import')
        if (isRecordFile(file)) {
          return importer.inspectQuestionBankRecord(new Uint8Array(bytes))
        }
        const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs')
        pdf.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
          import.meta.url,
        ).href
        return importer.inspectQuestionBankFile(new Uint8Array(bytes))
      })
      .then((next) => {
        setProposal(next)
        setProposedName(next.summary.bankName)
      })
      .catch((reason) => {
        setError(
          reason instanceof Error && reason.message
            ? reason.message
            : 'This Question Bank could not be inspected safely.',
        )
        setPhase('choose')
      })
      .then(() => setPhase('choose'))
  }

  const inspectOnOpen = useRef(initialFile)
  useEffect(() => {
    const file = inspectOnOpen.current
    inspectOnOpen.current = undefined
    // Deliberately once, for the file the dialog was opened with. A later drop
    // opens the dialog again with a fresh key rather than mutating this one.
    if (file) inspect(file)
  }, [])

  /** Every image in the record, resolved once per proposal rather than once per
   *  question: one Media Asset is commonly referenced by several questions. */
  const previewDocument = useMemo(() => {
    const sources = new Map<string, string>()
    for (const asset of proposal?.record.media ?? []) {
      sources.set(
        `/local-images/${asset.id.slice('sha256:'.length)}`,
        `data:${asset.mimeType};base64,${asset.bytes}`,
      )
    }
    return (document: SemanticDocument) =>
      recordDocumentToEditorNodes(document).map((node) =>
        resolveMedia(node, sources),
      )
  }, [proposal])

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

  const questions = proposal?.record.bank.questions ?? []

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialog}
        className={[
          'bank-import-dialog',
          proposal ? 'bank-import-dialog--review' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
      >
        <header className="dialog-header">
          <div>
            <h2 id={titleId}>Import Question Bank</h2>
            <p>
              Inspection reads the file&rsquo;s canonical record—not its visible
              pages—and changes nothing until you import.
            </p>
          </div>
          {proposal && (
            <p className="bank-import-integrity">
              <ShieldCheck aria-hidden="true" />
              <span>
                <strong>Record integrity verified</strong>
                Author identity is not verified, and neither are the visible
                pages of a PDF.
              </span>
            </p>
          )}
        </header>

        {!proposal && (
          <div className="bank-import-choose">
            <label className="bank-import-file">
              <span>Question Bank PDF or JSON</span>
              <input
                ref={input}
                type="file"
                accept="application/pdf,.pdf,application/json,.json"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  // Cleared so that choosing the same file after an error, or
                  // after backing out of a review, is still a change event.
                  event.target.value = ''
                  if (file) inspect(file)
                }}
              />
            </label>
          </div>
        )}

        <div
          className="bank-import-announcements"
          aria-live="polite"
          aria-atomic="true"
        >
          {phase === 'inspecting' && <p role="status">Validating Question Bank…</p>}
          {phase === 'saving' && <p role="status">Creating Question Bank…</p>}
          {error && <p className="home-error" role="alert">{error}</p>}
        </div>

        {proposal && (
          <section className="bank-import-body" aria-label="Import confirmation">
            <div className="bank-import-preview" aria-label="Question Bank preview">
              <header className="bank-import-preview-head">
                <h3>{proposal.record.bank.name || 'Untitled Question Bank'}</h3>
                <p>
                  {questions.length}{' '}
                  {questions.length === 1 ? 'Question' : 'Questions'}
                </p>
                {proposal.record.bank.description && (
                  <p className="bank-import-preview-description">
                    {proposal.record.bank.description}
                  </p>
                )}
              </header>
              {questions.map((question, index) => (
                <article key={question.id} className="bank-import-question">
                  <div className="bank-import-question-head">
                    <span className="bank-import-question-number">
                      {index + 1}
                    </span>
                    <span className="bank-import-question-type">
                      {question.type === 'multiple-choice'
                        ? 'Multiple Choice'
                        : 'Short Answer'}
                    </span>
                    {question.difficulty && (
                      <DifficultyBadge
                        difficulty={question.difficulty as Difficulty}
                      />
                    )}
                    {question.topics?.map((topic) => (
                      <TopicBadge key={topic} topic={topic} />
                    ))}
                  </div>
                  <DocView
                    className="bank-import-stem"
                    content={previewDocument(question.stem)}
                  />
                  {question.choices && (
                    <ol type="A" className="bank-import-choices">
                      {question.choices.map((choice) => (
                        <li
                          key={choice.id}
                          className={choice.correct ? 'is-correct' : undefined}
                        >
                          <DocView content={previewDocument(choice.content)} />
                          {choice.correct && (
                            <Check
                              className="bank-import-correct"
                              role="img"
                              aria-label="Correct answer"
                            />
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                  {question.suggestedAnswer && (
                    <section className="bank-import-answer">
                      <h4>Suggested Answer</h4>
                      <DocView
                        content={previewDocument(question.suggestedAnswer)}
                      />
                    </section>
                  )}
                </article>
              ))}
            </div>

            <aside className="bank-import-controls">
              <label className="bank-import-name">
                <span>New Question Bank name</span>
                <input
                  autoFocus
                  value={proposedName}
                  disabled={busy}
                  onChange={(event) => setProposedName(event.target.value)}
                />
              </label>

              <dl className="bank-import-summary">
                <div>
                  <dt>Multiple Choice</dt>
                  <dd>{proposal.summary.questionCounts['multiple-choice']}</dd>
                </div>
                <div>
                  <dt>Short Answer</dt>
                  <dd>{proposal.summary.questionCounts['short-answer']}</dd>
                </div>
                {proposal.summary.incompleteMultipleChoice > 0 && (
                  <div className="is-warning">
                    <dt>Incomplete Multiple Choice</dt>
                    <dd>{proposal.summary.incompleteMultipleChoice}</dd>
                  </div>
                )}
                <div>
                  <dt>Media Assets</dt>
                  <dd>
                    {proposal.summary.mediaAssets}
                    {proposal.summary.mediaAssets > 0 && (
                      <small>
                        {formatBytes(proposal.summary.decodedMediaBytes)}
                      </small>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>External links</dt>
                  <dd>{proposal.summary.externalLinks ? 'Present' : 'None'}</dd>
                </div>
                <div>
                  <dt>Format version</dt>
                  <dd>{proposal.summary.formatVersion}</dd>
                </div>
              </dl>

              {proposal.summary.topics.length > 0 && (
                <div className="bank-import-topics">
                  <h4>Topics</h4>
                  <div>
                    {proposal.summary.topics.map((topic) => (
                      <TopicBadge key={topic} topic={topic} />
                    ))}
                  </div>
                </div>
              )}

              {(proposal.record.bank.author || proposal.record.bank.license) && (
                <dl className="bank-import-provenance">
                  {proposal.record.bank.author && (
                    <div>
                      <dt>Declared author (unverified)</dt>
                      <dd>{proposal.record.bank.author}</dd>
                    </div>
                  )}
                  {proposal.record.bank.license && (
                    <div>
                      <dt>License</dt>
                      <dd>
                        {proposal.record.bank.license.name}
                        {proposal.record.bank.license.url
                          ? ` — ${proposal.record.bank.license.url}`
                          : ''}
                      </dd>
                    </div>
                  )}
                </dl>
              )}

              <p className="bank-import-note">
                Import always creates a new Question Bank. Duplicate names are
                allowed; nothing is merged or replaced.
              </p>
            </aside>
          </section>
        )}

        <footer className="dialog-actions">
          {proposal && (
            <button
              type="button"
              className="secondary-button bank-import-back"
              disabled={busy}
              onClick={() => {
                setProposal(null)
                setError(null)
              }}
            >
              Choose a different file
            </button>
          )}
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onClose}
          >
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
