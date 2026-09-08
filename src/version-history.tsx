import { useLayoutEffect, useRef, type RefObject } from "react";
import { ExportPreview } from "./exam-page";
import type { PublishedVersion } from "./export-preparation";
import type { LayoutPlan } from "./export-plan";

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.matches(':disabled'))
}

function creationTime(createdAt: string): string {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime())
    ? createdAt
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

/** The browser-local catalogue of immutable output. It deliberately exposes
 * selection and re-export only: Versions are artifacts, not editable drafts. */
export function VersionHistoryDrawer({
  versions,
  selectedVersionId,
  open,
  onOpenChange,
  onSelect,
}: {
  versions: readonly PublishedVersion[];
  selectedVersionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (version: PublishedVersion) => void;
}) {
  const drawer = useRef<HTMLElement>(null);

  // The opener is outside the drawer. Move focus into its first actionable
  // record so keyboard users are not left in authoring chrome behind it.
  useLayoutEffect(() => {
    if (!open) return;
    const firstVersion = drawer.current?.querySelector<HTMLElement>(
      ".version-history-item",
    );
    if (firstVersion) firstVersion.focus();
    else drawer.current?.querySelector<HTMLElement>("button")?.focus();
  }, [open]);

  return (
    <aside
      className="version-history-drawer"
      id="version-history"
      aria-label="Version History"
      aria-hidden={!open}
      hidden={!open}
      ref={drawer}
      tabIndex={-1}
    >
      <header className="version-history-header">
        <div>
          <h2>Version History</h2>
          <p>
            Stored in this browser only; it is not compliance-grade archival
            storage.
          </p>
        </div>
        <button
          type="button"
          className="toolbar-icon-button"
          aria-label="Close Version History"
          onClick={() => onOpenChange(false)}
        >
          ×
        </button>
      </header>
      {versions.length === 0 ? (
        <p className="version-history-empty">
          Export a Version to keep it available here.
        </p>
      ) : (
        <ol className="version-history-list">
          {[...versions].reverse().map((version) => (
            <li key={version.id}>
              <button
                type="button"
                className="version-history-item"
                aria-current={
                  selectedVersionId === version.id ? "page" : undefined
                }
                onClick={() => onSelect(version)}
              >
                <strong>{version.name}</strong>
                <time dateTime={version.createdAt}>
                  {creationTime(version.createdAt)}
                </time>
                <span>
                  {version.questionCount}{" "}
                  {version.questionCount === 1 ? "question" : "questions"}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

/** A stored plan is already the resolved document. Unlike `ExamPage`, this
 * makes no measurements and contains no authoring interaction. */
export function HistoricalDocument({
  version,
  plans,
  onBack,
  onUseAsDraft,
  canUseAsDraft,
  useAsDraftButton,
  focusKey,
}: {
  version: PublishedVersion;
  plans: readonly LayoutPlan[];
  onBack: () => void;
  onUseAsDraft: () => void;
  canUseAsDraft: boolean;
  useAsDraftButton: RefObject<HTMLButtonElement | null>;
  /** Bumped for reselection of the same Version from its drawer. */
  focusKey: number;
}) {
  const back = useRef<HTMLButtonElement>(null);

  // Selecting a Version hides its drawer button. Put focus on the historical
  // document's one navigation action instead of leaving it on hidden content.
  useLayoutEffect(() => {
    back.current?.focus();
  }, [focusKey, version.id]);

  return (
    <section
      className="historical-document"
      aria-label={`${version.name} Version`}
    >
      <header className="historical-document-bar">
        <div>
          <p>Viewing Version</p>
          <h2>{version.name}</h2>
        </div>
        <div className="historical-document-actions">
          <button
            ref={useAsDraftButton}
            type="button"
            className="secondary-button"
            disabled={!canUseAsDraft}
            title={canUseAsDraft ? undefined : 'This Version no longer matches its current Question Bank records.'}
            onClick={onUseAsDraft}
          >
            Use as draft
          </button>
          <button ref={back} type="button" className="secondary-button" onClick={onBack}>
            Back to draft
          </button>
        </div>
      </header>
      <div className="historical-document-pages">
        {plans.map((plan, index) => (
          <ExportPreview
            key={`${plan.version.id}-${plan.pages[0]?.stream}-${index}`}
            plan={plan}
          />
        ))}
      </div>
    </section>
  );
}

export function UseAsDraftConfirmation({
  onCancel,
  onExportCurrent,
  onReplace,
}: {
  onCancel: () => void;
  onExportCurrent: () => void;
  onReplace: () => void;
}) {
  const dialog = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    dialog.current?.querySelector<HTMLButtonElement>('.secondary-button')?.focus()
  }, [])

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onCancel()
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
        } else if (event.shiftKey && (active === first || !dialog.current.contains(active))) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && active === last) {
          event.preventDefault()
          first.focus()
        }
      }}
    >
      <section
        className="use-as-draft-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="use-as-draft-title"
        ref={dialog}
        tabIndex={-1}
      >
        <header className="dialog-header"><h2 id="use-as-draft-title">Replace current draft?</h2></header>
        <div className="use-as-draft-body">
          <p>Your current draft differs from the last exported Version. Export it first, cancel, or replace it with this historical arrangement.</p>
        </div>
        <footer className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
          <button type="button" className="secondary-button" onClick={onExportCurrent}>Export current draft</button>
          <button type="button" className="primary-button" onClick={onReplace}>Replace anyway</button>
        </footer>
      </section>
    </div>
  )
}
