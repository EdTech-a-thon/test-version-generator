// The export dialog: one place a teacher decides what they are publishing.
//
// It replaces the old Export menu and the print-options strip that used to push
// the document down the page. Everything one export operation needs is decided
// here — the output format, which documents, how many Versions, and whether the
// additional ones are randomized — and then handed to `onSubmit` in one piece.
//
// The dialog decides nothing about export itself. It does not plan, shuffle,
// print, or write a file: it collects a configuration, validates it against what
// the exam can actually produce, and reports what the preparation behind it says
// while it works. That keeps every arrangement decision in
// `export-preparation.ts`, where it can be tested without a browser.
//
// It is a small state machine. `configurable` is the ordinary state;
// `preparing` locks every control and both dismissals so one click cannot start
// two exports or close a dialog mid-flight; `failed` returns to `configurable`
// with the teacher's configuration intact and an error they can act on.

import { useEffect, useId, useRef, useState } from 'react'
import type { Exam, Version } from './exam'
import {
  VERSION_LIMIT,
  maxDistinctVersions,
  type ExportConfiguration,
  type OutputFormat,
  type PreparationProgress,
} from './export-preparation'

/** What the primary button says, which is also what it does. */
const PRIMARY_LABEL: Record<OutputFormat, string> = {
  print: 'Print',
  docx: 'Download DOCX',
}

const FORMAT_LABEL: Record<OutputFormat, string> = {
  print: 'Print / Save as PDF',
  docx: 'Word (.docx)',
}

const FORMATS: readonly OutputFormat[] = ['print', 'docx']

function progressMessage(progress: PreparationProgress): string {
  return progress.stage === 'versions'
    ? `Generating version ${progress.completed} of ${progress.total}…`
    : `Laying out document ${progress.completed} of ${progress.total}…`
}

/** Everything focusable inside the dialog, in document order. */
function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])',
    ),
    // `:disabled` rather than `[disabled]`: a control inside a disabled
    // fieldset carries no attribute of its own but is still out of reach.
  ).filter((element) => !element.matches(':disabled'))
}

export function ExportDialog({
  exam,
  version,
  configuration,
  onConfigurationChange,
  initialError,
  onSubmit,
  onCancel,
}: {
  exam: Exam
  version: Version
  /** Held by the caller so a failed export can reopen with it intact. */
  configuration: ExportConfiguration
  onConfigurationChange: (configuration: ExportConfiguration) => void
  /** An error from an export that failed after the dialog had closed. */
  initialError?: string | null
  /** Prepares and publishes. Resolving closes the dialog; rejecting keeps it
   *  open with the message and the configuration the teacher gave. */
  onSubmit: (
    configuration: ExportConfiguration,
    onProgress: (progress: PreparationProgress) => void,
  ) => Promise<void>
  onCancel: () => void
}) {
  const [preparing, setPreparing] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(initialError ?? null)
  // The count as typed. An impossible number stays on screen with an
  // explanation rather than being silently corrected to one the exam can meet.
  const [countText, setCountText] = useState(String(configuration.versionCount))
  const dialog = useRef<HTMLElement>(null)
  const id = useId()

  const { format, selection, randomization } = configuration
  const maximum = maxDistinctVersions(exam, version, randomization)
  const typedCount = Number(countText)
  const countIsNumber = countText.trim() !== '' && Number.isInteger(typedCount)
  const count = countIsNumber ? typedCount : configuration.versionCount

  const countError = !countIsNumber || typedCount < 1
    ? 'Enter a whole number of versions, at least one.'
    : typedCount > VERSION_LIMIT
      ? `An export can hold at most ${VERSION_LIMIT} versions, A through Z.`
      : typedCount > maximum
        ? `This exam can produce ${maximum} unique version${maximum === 1 ? '' : 's'} `
          + 'with the randomization selected. Change the count or enable more randomization.'
        : null
  const selectionError = !selection.test && !selection.answerKey
    ? 'Choose the student test, the answer key, or both.'
    : null
  const invalid = countError !== null || selectionError !== null

  const change = (patch: Partial<ExportConfiguration>) =>
    onConfigurationChange({ ...configuration, ...patch })

  useEffect(() => {
    // Deterministic initial focus: the first control in the dialog, whichever
    // format it happens to be showing.
    const [first] = focusableWithin(dialog.current!)
    first?.focus()
  }, [])

  const close = () => {
    if (preparing) return
    onCancel()
  }

  const submit = async () => {
    if (preparing || invalid) return
    setPreparing(true)
    setError(null)
    setProgress('Saving your latest changes…')
    try {
      await onSubmit(
        { ...configuration, versionCount: count },
        (update) => setProgress(progressMessage(update)),
      )
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Something went wrong while preparing the export. Please try again.',
      )
      setPreparing(false)
      setProgress(null)
    }
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return
        // Without this the browser's own focus-on-mousedown lands on the
        // backdrop a moment after the dialog closed, and the focus this
        // restores to Export is thrown away again.
        event.preventDefault()
        close()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          close()
          return
        }
        if (event.key !== 'Tab' || !dialog.current) return
        // Focus stays in the dialog: a modal that lets Tab wander into the
        // document behind it loses a keyboard user their place.
        const focusable = focusableWithin(dialog.current)
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (!first || !last) return
        const active = document.activeElement
        if (event.shiftKey && (active === first || !dialog.current.contains(active))) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && active === last) {
          event.preventDefault()
          first.focus()
        }
      }}
    >
      <section
        className="export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        ref={dialog}
      >
        <header className="dialog-header">
          <h2 id={`${id}-title`}>Export</h2>
        </header>

        <div className="export-dialog-body">
          <fieldset className="export-field">
            <legend>Output format</legend>
            {FORMATS.map((option) => (
              <label key={option}>
                <input
                  type="radio"
                  name={`${id}-format`}
                  value={option}
                  checked={format === option}
                  disabled={preparing}
                  onChange={() => change({ format: option })}
                />
                {FORMAT_LABEL[option]}
              </label>
            ))}
          </fieldset>

          <fieldset
            className="export-field"
            aria-describedby={selectionError ? `${id}-content-error` : undefined}
          >
            <legend>Content</legend>
            <label>
              <input
                type="checkbox"
                checked={selection.test}
                disabled={preparing}
                onChange={(event) =>
                  change({ selection: { ...selection, test: event.target.checked } })
                }
              />
              Student test
            </label>
            <label>
              <input
                type="checkbox"
                checked={selection.answerKey}
                disabled={preparing}
                onChange={(event) =>
                  change({ selection: { ...selection, answerKey: event.target.checked } })
                }
              />
              Answer key
            </label>
            {selectionError && (
              <p className="export-error" id={`${id}-content-error`} role="alert">
                {selectionError}
              </p>
            )}
          </fieldset>

          <div className="export-field">
            <label className="export-count" htmlFor={`${id}-count`}>
              Versions
              <input
                id={`${id}-count`}
                type="number"
                min={1}
                max={VERSION_LIMIT}
                step={1}
                value={countText}
                disabled={preparing}
                aria-invalid={countError !== null}
                aria-describedby={`${id}-count-help${countError ? ` ${id}-count-error` : ''}`}
                onChange={(event) => {
                  setCountText(event.target.value)
                  const typed = Number(event.target.value)
                  if (Number.isInteger(typed) && typed >= 1) {
                    change({ versionCount: typed })
                  }
                }}
              />
            </label>
            <p className="export-hint" id={`${id}-count-help`}>
              {maximum === 1
                ? 'This exam and these randomization settings can produce one unique version.'
                : `Up to ${maximum} unique versions are possible, labelled A onward.`}
            </p>
            {countError && (
              <p className="export-error" id={`${id}-count-error`} role="alert">
                {countError}
              </p>
            )}
          </div>

          {/* Selectable whatever the count is: a teacher may reasonably decide
              how the extra papers should vary before deciding how many to make.
              With one Version there is nothing to vary, and these simply have
              no effect — Version A is always the arrangement on screen. */}
          <fieldset className="export-field" disabled={preparing}>
            <legend>Randomize additional versions</legend>
            <label>
              <input
                type="checkbox"
                checked={randomization.questions}
                onChange={(event) =>
                  change({
                    randomization: { ...randomization, questions: event.target.checked },
                  })
                }
              />
              Shuffle question order
            </label>
            <label>
              <input
                type="checkbox"
                checked={randomization.answers}
                onChange={(event) =>
                  change({
                    randomization: { ...randomization, answers: event.target.checked },
                  })
                }
              />
              Shuffle answer order
            </label>
            <p className="export-hint">
              Version A always keeps the arrangement on screen. Randomization
              applies to versions B onward, so it changes nothing while you are
              exporting one version.
            </p>
          </fieldset>
        </div>

        <footer className="dialog-actions export-actions">
          <p className="export-status" role="status" aria-live="polite">
            {preparing ? progress : null}
          </p>
          {error && (
            <p className="export-error export-failure" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            className="secondary-button"
            disabled={preparing}
            onClick={close}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={preparing || invalid}
            onClick={() => void submit()}
          >
            {preparing ? 'Preparing…' : PRIMARY_LABEL[format]}
          </button>
        </footer>
      </section>
    </div>
  )
}
