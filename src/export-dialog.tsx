import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useModalScrollLock } from './use-modal-scroll-lock'
import { ExportPreview } from './exam-page'
import type { LayoutPlan } from './export-plan'
import type {
  ExportConfiguration,
  PreparationProgress,
} from './export-preparation'
import { DEFAULT_VERSION_COUNT, NO_SHUFFLE, shufflesAnything, versionCountError } from './export-versions'

function progressMessage(progress: PreparationProgress): string {
  return progress.stage === 'planning'
    ? `Laying out document ${progress.completed} of ${progress.total}…`
    : 'Recording export…'
}

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) =>
      !element.matches(':disabled') && element.closest('[inert]') === null,
  )
}

export function ExportDialog({
  configuration,
  onConfigurationChange,
  previewPlans,
  maxVersions,
  empty,
  blocked = null,
  initialError,
  onSubmit,
  onCancel,
}: {
  configuration: ExportConfiguration
  onConfigurationChange: (configuration: ExportConfiguration) => void
  previewPlans: readonly LayoutPlan[]
  /** How many shuffled Versions the current shuffle options allow. */
  maxVersions: number
  empty: boolean
  /** Why this Exam cannot be exported as it is — a Question still needing a
   *  picture — shown in place of the preview's paper. */
  blocked?: string | null
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
    ? 'Add at least one question to the Working Copy before exporting.'
    : null
  const shuffle = configuration.shuffle ?? NO_SHUFFLE
  const shuffling = shufflesAnything(shuffle)
  const versionCount = configuration.versionCount ?? DEFAULT_VERSION_COUNT
  const versionError = !shuffling || empty ? null : versionCountError(versionCount, maxVersions)
  const invalid =
    selectionError !== null || emptyError !== null || blocked !== null || versionError !== null

  const changeShuffle = (next: Partial<typeof shuffle>) =>
    onConfigurationChange({
      ...configuration,
      shuffle: { ...shuffle, ...next },
      versionCount,
    })

  const changeSelection = (selection: ExportConfiguration['selection']) =>
    onConfigurationChange({ ...configuration, selection })

  const changeFormat = (format: ExportConfiguration['format']) =>
    onConfigurationChange({ ...configuration, format })

  useEffect(() => {
    const [first] = focusableWithin(dialog.current!)
    first?.focus()
  }, [])

  useModalScrollLock()

  // Preparation disables every dialog control. Keep focus on the dialog itself
  // during that interval so Tab cannot escape into the authoring workspace.
  useLayoutEffect(() => {
    if (preparing) {
      dialog.current?.focus()
      return
    }
    // Restore a predictable in-dialog target after a recoverable failure.
    if (error) {
      const [first] = focusableWithin(dialog.current!)
      first?.focus()
    }
  }, [error, preparing])

  const close = () => {
    if (!preparing) onCancel()
  }

  const submit = async () => {
    if (preparing || invalid) return
    setPreparing(true)
    setError(null)
    setProgress(`Preparing ${configuration.format.toUpperCase()} document…`)
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
        if (!first || !last) {
          event.preventDefault()
          dialog.current.focus()
          return
        }
        const active = document.activeElement
        if (active === dialog.current) {
          event.preventDefault()
          ;(event.shiftKey ? last : first).focus()
        } else if (
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
        tabIndex={-1}
      >
        <header className="dialog-header">
          <h2 id={`${id}-title`}>Export</h2>
        </header>

        <div className="export-publication-body">
          {/* The preview is output-faithful, not an alternate reading or
              navigation surface. `inert` prevents authored links and any
              future focusable document content from escaping this dialog. */}
          <div className="export-preview" aria-label="Export Preview">
            {/* Keep paper content inert while leaving its scroll container live:
                browsing a long preview must not pass wheel input through to
                the document under this modal. */}
            <div inert>
              {previewPlans.map((plan, index) => (
                <ExportPreview
                  key={`${plan.pages[0]?.stream ?? 'empty'}-${index}`}
                  plan={plan}
                />
              ))}
            </div>
          </div>

          <div className="export-controls">
            <fieldset className="export-field" disabled={preparing}>
              <legend>Format</legend>
              <label>
                <input
                  type="radio"
                  name={`${id}-format`}
                  value="pdf"
                  checked={configuration.format === 'pdf'}
                  onChange={() => changeFormat('pdf')}
                />
                PDF
              </label>
              <label>
                <input
                  type="radio"
                  name={`${id}-format`}
                  value="docx"
                  checked={configuration.format === 'docx'}
                  onChange={() => changeFormat('docx')}
                />
                DOCX
              </label>
            </fieldset>

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

            <fieldset
              className="export-field"
              aria-describedby={versionError ? `${id}-version-error` : `${id}-version-hint`}
              disabled={preparing}
            >
              <legend>Shuffled Versions</legend>
              <label>
                <input
                  type="checkbox"
                  checked={shuffle.questions}
                  onChange={(event) => changeShuffle({ questions: event.target.checked })}
                />
                Shuffle question order
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={shuffle.answers}
                  onChange={(event) => changeShuffle({ answers: event.target.checked })}
                />
                Shuffle answer order
              </label>
              <label className="export-count">
                Versions
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, maxVersions)}
                  step={1}
                  inputMode="numeric"
                  value={Number.isNaN(versionCount) ? '' : versionCount}
                  disabled={!shuffling}
                  onChange={(event) =>
                    onConfigurationChange({
                      ...configuration,
                      shuffle,
                      versionCount: event.target.valueAsNumber,
                    })
                  }
                />
              </label>
              <p className="export-hint" id={`${id}-version-hint`}>
                {shuffling
                  ? `Each Version gets its own name, printed at the top right. Up to ${Math.max(0, maxVersions)} for this Exam.`
                  : 'Turn on a shuffle to print named Versions. Otherwise the Exam prints as you see it.'}
              </p>
            </fieldset>

            <p className="export-durability-note">
              Export History is stored only in this browser. It is useful for
              local re-export, but it is not an archival backup.
            </p>
            {(selectionError || emptyError || blocked) && (
              <p
                className="export-error"
                id={`${id}-content-error`}
                role="alert"
              >
                {selectionError ?? emptyError ?? blocked}
              </p>
            )}
            {versionError && (
              <p className="export-error" id={`${id}-version-error`} role="alert">
                {versionError}
              </p>
            )}
          </div>
        </div>

        <footer className="dialog-actions export-actions">
          <p
            className="export-status"
            role="status"
            aria-live="polite"
            aria-label="Export preparation status"
          >
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
            {preparing
              ? 'Preparing…'
              : `Download ${configuration.format.toUpperCase()}`}
          </button>
        </footer>
      </section>
    </div>
  )
}
