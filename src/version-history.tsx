import { useLayoutEffect, useRef } from "react";
import { ExportPreview } from "./exam-page";
import type { PublishedVersion } from "./export-preparation";
import type { LayoutPlan } from "./export-plan";

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
  focusKey,
}: {
  version: PublishedVersion;
  plans: readonly LayoutPlan[];
  onBack: () => void;
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
        <button ref={back} type="button" className="secondary-button" onClick={onBack}>
          Back to draft
        </button>
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
