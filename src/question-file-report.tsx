import { useId } from 'react'
import { AlertTriangle, Info, XCircle } from 'lucide-react'
import type { FormatId, QuestionFileSummary } from './question-formats'
import type { ImportIssue } from './question-formats/types'
import { FORMAT_LABELS } from './question-formats/catalog'

/**
 * What reading a question file from another tool found, shown above its
 * preview: the format it was read as — with the others it could be, to read
 * it as one of them instead — how many questions it held and how many are
 * coming in, and every problem, each with the line to find it on. Nothing is
 * imported until the teacher confirms, so a wrong guess costs a click.
 */

const ICONS: Record<ImportIssue['severity'], typeof Info> = { error: XCircle, warning: AlertTriangle, info: Info }

const plural = (count: number, singular: string, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`

export function QuestionFileReport({
  reading,
  busy,
  onReadAs,
  onConvertInstead,
}: {
  reading: QuestionFileSummary
  busy: boolean
  onReadAs: (format: FormatId) => void
  /** For a Word document: convert it with an AI after all. */
  onConvertInstead?: () => void
}) {
  const selectId = useId()
  const leftOut = Math.max(0, reading.found - reading.imported)
  const errors = reading.issues.filter((issue) => issue.severity === 'error')
  const others = reading.issues.filter((issue) => issue.severity !== 'error')
  const suggested = new Set(reading.candidates.map(({ id }) => id))
  const formats = [
    ...reading.candidates.map(({ id }) => id),
    ...(Object.keys(FORMAT_LABELS) as FormatId[]).filter((id) => !suggested.has(id)),
  ]

  return <section className="question-file-report" aria-label="How your file was read">
    <div className="question-file-report-head">
      <label htmlFor={selectId}>Read as</label>
      <select
        id={selectId}
        value={reading.format}
        disabled={busy}
        onChange={(event) => onReadAs(event.target.value as FormatId)}
      >
        {formats.map((id) => <option key={id} value={id}>{FORMAT_LABELS[id]}</option>)}
      </select>
      <p role="status">
        {plural(reading.found, 'question')} found · <strong>{reading.imported} coming in</strong>
        {leftOut > 0 && <> · <span className="question-file-report-left-out">{leftOut} left out</span></>}
      </p>
      {onConvertInstead && (
        <button type="button" className="link-button" disabled={busy} onClick={onConvertInstead}>
          Convert it with your AI instead
        </button>
      )}
    </div>
    {reading.issues.length > 0 && (
      <details className="question-file-report-issues" open={errors.length > 0}>
        <summary>
          {[
            errors.length ? plural(errors.length, 'question left out', 'questions left out') : '',
            others.length ? plural(others.length, 'note') : '',
          ].filter(Boolean).join(' · ')}
        </summary>
        <ul>
          {[...errors, ...others].map((issue, index) => {
            const Icon = ICONS[issue.severity]
            return <li key={index} data-severity={issue.severity}>
              <Icon aria-hidden="true" />
              <span>
                {issue.message}
                {issue.excerpt && <q>{issue.excerpt}</q>}
              </span>
            </li>
          })}
        </ul>
      </details>
    )}
  </section>
}
