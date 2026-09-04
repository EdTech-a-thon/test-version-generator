import { useEffect, useId, useRef, useState } from 'react'
import { ExportPreview } from './exam-page'
import type { LayoutPlan } from './export-plan'
import type {
  ExportConfiguration,
  PreparationProgress,
  PreparedExport,
} from './export-preparation'

function progressMessage(progress: PreparationProgress): string {
  return progress.stage === 'planning'
    ? `Laying out document ${progress.completed} of ${progress.total}…`
    : 'Resolving Version identity…'
}

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.matches(':disabled'))
}

export function ExportDialog({
  configuration,
  onConfigurationChange,
  resolution,
  previewPlans,
  empty,
  initialError,
  onSubmit,
  onCancel,
}: {
  configuration: ExportConfiguration
  onConfigurationChange: (configuration: ExportConfiguration) => void
  resolution: PreparedExport['resolution'] | null
  previewPlans: readonly LayoutPlan[]
  empty: boolean
  initialError?: string | null
  onSubmit: (
    configuration: ExportConfiguration,
    onProgress: (progress: PreparationProgress) => void,
  ) => Promise<void>
  onCancel: () => void
}) {
  const [preparing, setPreparing] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(initialError ?? null)
  const dialog = useRef<HTMLElement>(null)
  const id = useId()
  const { selection } = configuration
  const selectionError =
    !selection.test && !selection.answerKey
      ? 'Choose the student test, the answer key, or both.'
      : null
  const emptyError = empty
    ? 'Add at least one question to the Exam Draft before exporting.'
    : null
  const invalid = selectionError !== null || emptyError !== null || !resolution

  const changeSelection = (selection: ExportConfiguration['selection']) =>
    onConfigurationChange({ selection })

  useEffect(() => {
    const [first] = focusableWithin(dialog.current!)
    first?.focus()
  }, [])

  const close = () => {
    if (!preparing) onCancel()
  }

  const submit = async () => {
    if (preparing || invalid) return
    setPreparing(true)
    setError(null)
    setProgress('Preparing Word document…')
    try {
      await onSubmit(configuration, (update) =>
        setProgress(progressMessage(update)),
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
        const focusable = focusableWithin(dialog.current)
        const first = focusable[0]
        const last = focusable.at(-1)
        if (!first || !last) return
        const active = document.activeElement
        if (
          event.shiftKey &&
          (active === first || !dialog.current.contains(active))
        ) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && active === last) {
          event.preventDefault()
          first.focus()
        }
      }}
    >
      <section
        className="export-dialog export-dialog--publication"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        ref={dialog}
      >
        <header className="dialog-header">
          <h2 id={`${id}-title`}>Export DOCX</h2>
        </header>

        <div className="export-publication-body">
          <div className="export-preview" aria-label="Export Preview">
            {previewPlans.map((plan, index) => (
              <ExportPreview
                key={`${plan.pages[0]?.stream ?? 'empty'}-${index}`}
                plan={plan}
              />
            ))}
          </div>

          <div className="export-controls">
            {resolution && (
              <p
                className="export-version-state"
                role="status"
                aria-live="polite"
              >
                {resolution.kind === 'existing'
                  ? 'Re-export existing Version'
                  : 'New Version'}
                <strong>{resolution.version.name}</strong>
              </p>
            )}

            <fieldset
              className="export-field"
              aria-describedby={
                selectionError ? `${id}-content-error` : undefined
              }
              disabled={preparing}
            >
              <legend>Content selection</legend>
              <label>
                <input
                  type="checkbox"
                  checked={selection.test}
                  onChange={(event) =>
                    changeSelection({
                      ...selection,
                      test: event.target.checked,
                    })
                  }
                />
                Student test
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={selection.answerKey}
                  onChange={(event) =>
                    changeSelection({
                      ...selection,
                      answerKey: event.target.checked,
                    })
                  }
                />
                Answer key
              </label>
            </fieldset>

            <p className="export-durability-note">
              Version History is stored only in this browser. It is useful for
              local recovery and re-export, but it is not an archival backup.
            </p>
            {(selectionError || emptyError) && (
              <p
                className="export-error"
                id={`${id}-content-error`}
                role="alert"
              >
                {selectionError ?? emptyError}
              </p>
            )}
          </div>
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
            {preparing ? 'Preparing…' : 'Download DOCX'}
          </button>
        </footer>
      </section>
    </div>
  )
}
