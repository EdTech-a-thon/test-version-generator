import { useId, useLayoutEffect, useRef, useState } from 'react'
import { ExportPreview } from './exam-page'
import type { ExportContentSelection } from './export-plan'
import type { ExportRecord, ReprintChoice } from './export-preparation'

function creationTime(createdAt: string): string {
  const date = new Date(createdAt)
  return Number.isNaN(date.getTime())
    ? createdAt
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date)
}

// A few names, then how many more, so a long batch keeps its card short.
function versionsLabel(versions: readonly string[]): string {
  const shown = versions.slice(0, 2).join(', ')
  return versions.length > 2 ? `${shown} +${versions.length - 2}` : shown
}

function selectionLabel(record: ExportRecord): string {
  if (record.selection.test && record.selection.answerKey) {
    return 'Student Test + Answer Key'
  }
  return record.selection.test ? 'Student Test' : 'Answer Key'
}

export function ExportHistoryDrawer({
  records,
  selectedRecordId,
  open,
  onOpenChange,
  onSelect,
}: {
  records: readonly ExportRecord[]
  selectedRecordId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (record: ExportRecord) => void
}) {
  const drawer = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    if (!open) return
    drawer.current?.querySelector<HTMLElement>('.export-history-item, button')?.focus()
  }, [open])

  return (
    <aside
      className="export-history-drawer"
      id="export-history"
      aria-label="Export History"
      aria-hidden={!open}
      hidden={!open}
      ref={drawer}
      tabIndex={-1}
    >
      <header className="export-history-header">
        <div>
          <h2>Export History</h2>
          <p>Immutable output events stored in this browser.</p>
        </div>
        <button
          type="button"
          className="toolbar-icon-button"
          aria-label="Close Export History"
          onClick={() => onOpenChange(false)}
        >
          ×
        </button>
      </header>
      {records.length === 0 ? (
        <p className="export-history-empty">Export this Exam to keep a record here.</p>
      ) : (
        <ol className="export-history-list">
          {[...records].reverse().map((record) => (
            <li key={record.id}>
              <button
                type="button"
                className="export-history-item export-history-item"
                aria-current={selectedRecordId === record.id ? 'page' : undefined}
                onClick={() => onSelect(record)}
              >
                <strong>{record.capturedName}</strong>
                <time dateTime={record.createdAt}>{creationTime(record.createdAt)}</time>
                <span>{record.format.toUpperCase()} · {selectionLabel(record)}</span>
                {record.versions && (
                  <span className="export-history-versions">
                    {record.versions.length === 1 ? 'Version' : `${record.versions.length} Versions`}: {versionsLabel(record.versions)}
                  </span>
                )}
                <span>
                  {record.questionCount} {record.questionCount === 1 ? 'question' : 'questions'}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  )
}

export function HistoricalExportRecord({
  record,
  onBack,
  onReExport,
  reExportButton,
  focusKey,
}: {
  record: ExportRecord
  onBack: () => void
  onReExport: (choice: ReprintChoice) => void
  reExportButton: React.RefObject<HTMLButtonElement | null>
  focusKey: number
}) {
  const back = useRef<HTMLButtonElement>(null)
  const id = useId()
  const [chosen, setChosen] = useState<{
    recordId: string
    versions: string[]
    selection: ExportContentSelection
  }>(() => ({ recordId: record.id, versions: record.versions ?? [], selection: record.selection }))
  // A newly opened record starts from everything it printed.
  const choice = chosen.recordId === record.id
    ? chosen
    : { recordId: record.id, versions: record.versions ?? [], selection: record.selection }
  const both = record.selection.test && record.selection.answerKey
  const nothing =
    (!choice.selection.test && !choice.selection.answerKey)
    || (record.versions !== undefined && choice.versions.length === 0)

  const toggleVersion = (name: string, on: boolean) =>
    setChosen({
      ...choice,
      // Kept in the record's own order, whatever order they were ticked in.
      versions: (record.versions ?? []).filter((candidate) =>
        candidate === name ? on : choice.versions.includes(candidate)),
    })

  useLayoutEffect(() => {
    back.current?.focus()
  }, [focusKey, record.id])

  return (
    <section className="historical-document" aria-label={`${record.capturedName} Export Record`}>
      <header className="historical-document-bar">
        <div>
          <p>Viewing immutable Export Record</p>
          <h2>{record.capturedName}</h2>
          <p>{record.format.toUpperCase()} · {selectionLabel(record)} · {creationTime(record.createdAt)}</p>
        </div>
        <div className="historical-document-actions">
          <button ref={back} type="button" className="secondary-button" onClick={onBack}>
            Back to Exam
          </button>
          <button
            ref={reExportButton}
            type="button"
            className="primary-button"
            disabled={nothing}
            onClick={() => onReExport({
              ...(record.versions ? { versions: choice.versions } : {}),
              selection: choice.selection,
            })}
          >
            Re-export {record.format.toUpperCase()}
          </button>
        </div>
      </header>
      {(record.versions || both) && (
        <div className="historical-reprint" role="group" aria-label="What to re-export">
          {record.versions && (
            <fieldset className="export-field">
              <legend>Versions</legend>
              {record.versions.map((name) => (
                <label key={name}>
                  <input
                    type="checkbox"
                    checked={choice.versions.includes(name)}
                    onChange={(event) => toggleVersion(name, event.target.checked)}
                  />
                  {name}
                </label>
              ))}
            </fieldset>
          )}
          {both && (
            <fieldset className="export-field">
              <legend>Content selection</legend>
              <label>
                <input
                  type="checkbox"
                  checked={choice.selection.test}
                  onChange={(event) => setChosen({
                    ...choice,
                    selection: { ...choice.selection, test: event.target.checked },
                  })}
                />
                Student test
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={choice.selection.answerKey}
                  onChange={(event) => setChosen({
                    ...choice,
                    selection: { ...choice.selection, answerKey: event.target.checked },
                  })}
                />
                Answer key
              </label>
            </fieldset>
          )}
          {nothing && (
            <p className="export-error" id={`${id}-reprint-error`} role="alert">
              Choose at least one Version and document to re-export.
            </p>
          )}
        </div>
      )}
      <div className="historical-document-pages">
        {/* The pages shown are the pages a re-export prints, so ticking one
            Version steps the view to it. */}
        {record.plans.filter((plan) =>
          (plan.selection.answerKey ? choice.selection.answerKey : choice.selection.test)
          && (!record.versions || choice.versions.includes(plan.arrangement.version ?? '')),
        ).map((plan, index) => (
          <div className="historical-paper" key={`${plan.arrangement.id}-${plan.pages[0]?.stream}-${index}`}>
            {plan.arrangement.version && (
              <p className="historical-paper-label">
                {plan.arrangement.version} · {plan.selection.answerKey ? 'Answer key' : 'Student test'}
              </p>
            )}
            <ExportPreview plan={plan} />
          </div>
        ))}
      </div>
    </section>
  )
}
