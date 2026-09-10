import { useLayoutEffect, useRef } from 'react'
import { ExportPreview } from './exam-page'
import type { ExportRecord } from './export-preparation'

function creationTime(createdAt: string): string {
  const date = new Date(createdAt)
  return Number.isNaN(date.getTime())
    ? createdAt
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date)
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
  onReExport: () => void
  reExportButton: React.RefObject<HTMLButtonElement | null>
  focusKey: number
}) {
  const back = useRef<HTMLButtonElement>(null)

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
          <button ref={reExportButton} type="button" className="primary-button" onClick={onReExport}>
            Re-export {record.format.toUpperCase()}
          </button>
        </div>
      </header>
      <div className="historical-document-pages">
        {record.plans.map((plan, index) => (
          <ExportPreview
            key={`${plan.arrangement.id}-${plan.pages[0]?.stream}-${index}`}
            plan={plan}
          />
        ))}
      </div>
    </section>
  )
}
