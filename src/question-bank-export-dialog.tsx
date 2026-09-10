import { useEffect, useId, useRef, useState } from 'react'
import { DocView } from './doc-view'
import {
  prepareQuestionBankExport,
  recordDocumentToEditorNodes,
  type PreparedQuestionBankExport,
} from './question-bank-export'
import type { QuestionBankResource } from './question-bank-workspaces'

export function QuestionBankExportDialog({
  bank,
  onClose,
}: {
  bank: QuestionBankResource
  onClose: () => void
}) {
  const titleId = useId()
  const dialog = useRef<HTMLElement>(null)
  const [prepared, setPrepared] = useState<PreparedQuestionBankExport | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const exportingRef = useRef(exporting)
  exportingRef.current = exporting

  useEffect(() => {
    let current = true
    void prepareQuestionBankExport(bank).then(
      (next) => {
        if (current) setPrepared(next)
      },
      (reason) => {
        if (current)
          setError(
            reason instanceof Error
              ? reason.message
              : 'The Question Bank cannot be prepared.',
          )
      },
    )
    return () => {
      current = false
    }
  }, [bank])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    requestAnimationFrame(() =>
      dialog.current?.querySelector<HTMLElement>('button')?.focus(),
    )
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !exportingRef.current) {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const controls = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled)',
        ) ?? [],
      )
      if (controls.length === 0) return
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

  const download = async () => {
    if (!prepared || exporting) return
    setExporting(true)
    setError(null)
    try {
      // Package all bytes before handing anything to the browser. Preparation
      // and PDF creation are read-only, so any failure leaves every resource
      // untouched and cannot leave a partial download.
      const { createQuestionBankPdf } = await import('./question-bank-pdf')
      const bytes = await createQuestionBankPdf(prepared)
      const url = URL.createObjectURL(
        new Blob([bytes], { type: 'application/pdf' }),
      )
      const link = document.createElement('a')
      link.href = url
      link.download = prepared.filename
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      onClose()
    } catch (reason) {
      console.error('Could not export the Question Bank', reason)
      setError(
        reason instanceof Error
          ? reason.message
          : 'The Question Bank PDF could not be created. Try again.',
      )
      setExporting(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialog}
        className="question-bank-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={!prepared && !error ? true : exporting}
      >
        <header className="dialog-header">
          <div>
            <h2 id={titleId}>Export Question Bank</h2>
            <p>
              For teachers: this file contains correct answers and Suggested
              Answers. It is separate from publishing an Exam.
            </p>
          </div>
        </header>
        {error && (
          <p className="dialog-save-error" role="alert">
            {error}
          </p>
        )}
        {!prepared && !error ? (
          <p role="status" aria-live="polite">Preparing Question Bank Record and complete preview…</p>
        ) : (
          prepared && (
            <div
              className="question-bank-export-preview"
              aria-label="Question Bank PDF preview"
            >
              <h1>{prepared.record.bank.name || 'Untitled Question Bank'}</h1>
              <p>
                <strong>Teacher Question Bank containing answers</strong>
              </p>
              <p>
                This Question Bank can be imported into Test Parrot. Import data
                may be lost if this PDF is rewritten or printed.
              </p>
              {prepared.record.bank.description && <p>{prepared.record.bank.description}</p>}
              {prepared.record.bank.author && <p><strong>Declared author (unverified):</strong> {prepared.record.bank.author}</p>}
              {prepared.record.bank.license && <p><strong>License:</strong> {prepared.record.bank.license.name}{prepared.record.bank.license.url ? ` — ${prepared.record.bank.license.url}` : ''}</p>}
              <p>
                <strong>
                  {prepared.record.bank.questions.length}{' '}
                  {prepared.record.bank.questions.length === 1
                    ? 'Question'
                    : 'Questions'}
                </strong>
              </p>
              {prepared.record.bank.questions.map((question, index) => (
                <article
                  key={question.id}
                  className="question-bank-export-question"
                >
                  <h2>Question {index + 1}</h2>
                  <dl>
                    <div>
                      <dt>Question Type</dt>
                      <dd>
                        {question.type === 'multiple-choice'
                          ? 'Multiple Choice'
                          : 'Short Answer'}
                      </dd>
                    </div>
                    <div>
                      <dt>Difficulty</dt>
                      <dd>
                        {question.difficulty
                          ? question.difficulty[0]!.toUpperCase() +
                            question.difficulty.slice(1)
                          : 'Unspecified'}
                      </dd>
                    </div>
                    <div>
                      <dt>Topics</dt>
                      <dd>{question.topics?.join(', ') || 'None'}</dd>
                    </div>
                  </dl>
                  <DocView
                    content={recordDocumentToEditorNodes(question.stem)}
                  />
                  {question.choices && (
                    <ol type="A" className="question-bank-export-choices">
                      {question.choices.map((choice) => (
                        <li key={choice.id}>
                          <DocView
                            content={recordDocumentToEditorNodes(
                              choice.content,
                            )}
                          />
                          {choice.correct && (
                            <strong className="question-bank-correct">
                              Correct answer
                            </strong>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                  {question.suggestedAnswer && (
                    <section>
                      <h3>Suggested Answer</h3>
                      <DocView
                        content={recordDocumentToEditorNodes(
                          question.suggestedAnswer,
                        )}
                      />
                    </section>
                  )}
                </article>
              ))}
            </div>
          )
        )}
        <footer className="dialog-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={exporting}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!prepared || exporting}
            onClick={() => void download()}
          >
            {exporting ? 'Creating PDF…' : 'Download PDF'}
          </button>
        </footer>
      </section>
    </div>
  )
}
