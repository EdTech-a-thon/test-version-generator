import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ExportPreview } from "./exam-page";
import type { Question } from "./exam";
import type { PublishedVersion, QuestionRevision } from "./export-preparation";
import type {
  HistoricalQuestionDifference,
  HistoricalQuestionResolution,
  HistoricalQuestionReview,
} from "./historical-draft";
import type { LayoutPlan } from "./export-plan";
import { choiceNodesOf, stemNodesOf, type ProseMirrorJSON } from "./question-doc";

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
          <p>Viewing immutable Version</p>
          <h2>{version.name}</h2>
        </div>
        <div className="historical-document-actions">
          <button
            ref={useAsDraftButton}
            type="button"
            className="primary-button"
            disabled={!canUseAsDraft}
            title={canUseAsDraft ? undefined : 'This Version no longer matches its current Question Bank records.'}
            onClick={onUseAsDraft}
          >
            Use as draft
          </button>
          <button ref={back} type="button" className="secondary-button" onClick={onBack}>
            Return to Exam Draft
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

const DIFFERENCE_LABELS: Record<HistoricalQuestionDifference, string> = {
  content: "content",
  answers: "answers",
  correctness: "correctness",
  media: "media",
  columns: "answer-column layout",
};

function revisionQuestion(revision: QuestionRevision): Question {
  return {
    id: revision.sourceQuestionId,
    type: revision.question.type,
    doc: revision.question.doc,
    columns: revision.question.columns,
    ...revision.metadata,
  };
}

function attrsOf(node: ProseMirrorJSON): Record<string, unknown> {
  return typeof node.attrs === "object" && node.attrs !== null
    ? (node.attrs as Record<string, unknown>)
    : {};
}

function attributesDescription(attrs: Record<string, unknown>): string {
  const attributes = Object.entries(attrs)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(", ");
  return attributes ? ` (${attributes})` : "";
}

function marksDescription(node: ProseMirrorJSON): string {
  if (!Array.isArray(node.marks) || node.marks.length === 0) return "";
  const marks = (node.marks as ProseMirrorJSON[])
    .map((mark) => `${String(mark.type ?? "mark")}${attributesDescription(attrsOf(mark))}`)
    .join(", ");
  return ` [${marks}]`;
}

/** A lossless, accessible textual projection of a supported authored node.
 * This deliberately walks the complete tree rather than flattening prose:
 * marks (including link targets) live on inline descendants, and images may
 * occur inline inside a paragraph. Attributes are included so authored image
 * size and every other presentation distinction can be reconciled. */
function describeRichNode(node: ProseMirrorJSON): string {
  const type = String(node.type ?? "content");
  const attrs = attributesDescription(attrsOf(node));
  const marks = marksDescription(node);
  if (type === "text") return `text${marks}: ${JSON.stringify(String(node.text ?? ""))}`;
  if (type === "image" || type === "image-block") return `${type}${attrs}${marks}`;
  const children = Array.isArray(node.content)
    ? (node.content as ProseMirrorJSON[]).map(describeRichNode).join("; ")
    : "";
  return `${type}${attrs}${marks}${children ? ` { ${children} }` : ""}`;
}

/** The browser-facing comparison says every authored node, mark, and
 * presentation attribute. */
function questionComparisonSummary(question: Question): string {
  const stem = stemNodesOf(question.doc)
    .map(describeRichNode)
    .join("; ");
  const choices = choiceNodesOf(question.doc);
  const answers = choices.length === 0
    ? "Short answer"
    : choices.map((choice, index) => {
        const attrs = attrsOf(choice);
        const content = Array.isArray(choice.content)
          ? choice.content.map((node) => describeRichNode(node as ProseMirrorJSON)).join("; ")
          : "";
        return `Answer ${index + 1}${attrs.correct === true ? " (correct)" : ""}: ${content || "Blank"}`;
      }).join(". ");
  return `Content: ${stem || "Untitled question"}. ${answers}. Answer-column layout: ${question.columns} column${question.columns === 1 ? "" : "s"}.`;
}
/** Review is deliberately a separate modal from the replace warning: it gives
 * every divergent Question Revision an explicit disposition before the store
 * receives one all-or-nothing reconciliation command. */
export function ReviewHistoricalQuestions({
  rows,
  onCancel,
  onConfirm,
}: {
  rows: readonly HistoricalQuestionReview[];
  onCancel: () => void;
  onConfirm: (resolutions: Record<string, HistoricalQuestionResolution>) => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const [resolutions, setResolutions] = useState<
    Record<string, HistoricalQuestionResolution>
  >(() =>
    Object.fromEntries(
      rows.map((row) => [row.revision.id, row.defaultResolution]),
    ),
  );

  useLayoutEffect(() => {
    dialog.current?.querySelector<HTMLButtonElement>(".secondary-button")?.focus();
  }, []);

  const setResolution = (
    revisionId: string,
    resolution: HistoricalQuestionResolution,
  ) => setResolutions((current) => ({ ...current, [revisionId]: resolution }));

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
          return;
        }
        if (event.key !== "Tab" || !dialog.current) return;
        const focusable = focusableWithin(dialog.current);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) {
          event.preventDefault();
          dialog.current.focus();
        } else if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <section
        className="use-as-draft-dialog historical-review-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-historical-questions-title"
        ref={dialog}
        tabIndex={-1}
      >
        <header className="dialog-header">
          <h2 id="review-historical-questions-title">Review questions</h2>
        </header>
        <div className="use-as-draft-body historical-review-body">
          <p>
            Choose how to reconcile the historical questions before using this
            Version as the draft. Your Question Bank and draft will change only
            when you confirm.
          </p>
          <ol className="historical-review-rows">
            {rows.map((row, index) => {
              const oldQuestion = revisionQuestion(row.revision);
              const currentQuestion = row.current;
              const options: readonly [HistoricalQuestionResolution, string][] =
                row.status === "updated"
                  ? [
                      ["use-latest", "Use latest"],
                      ["keep-historical", "Keep historical as new question"],
                    ]
                  : [
                      ["add-to-question-bank", "Add to Question Bank"],
                      ["leave-out", "Leave out"],
                    ];
              return (
                <li key={row.revision.id} className="historical-review-row">
                  <h3>
                    Question {index + 1}: {row.status === "updated" ? "Updated" : "Not in Question Bank"}
                  </h3>
                  {row.status === "updated" && (
                    <p className="historical-review-differences">
                      Changed: {row.differences.map((difference) => DIFFERENCE_LABELS[difference]).join(", ")}.
                    </p>
                  )}
                  <fieldset>
                    <legend className="sr-only">Resolution for question {index + 1}</legend>
                    {options.map(([value, label]) => (
                      <label key={value} className="historical-review-option">
                        <input
                          type="radio"
                          name={`historical-resolution-${row.revision.id}`}
                          value={value}
                          checked={resolutions[row.revision.id] === value}
                          onChange={() => setResolution(row.revision.id, value)}
                        />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                  <details>
                    <summary>Compare historical and current question</summary>
                    <dl className="historical-comparison">
                      <div>
                        <dt>Historical</dt>
                        <dd>{questionComparisonSummary(oldQuestion)}</dd>
                      </div>
                      <div>
                        <dt>{currentQuestion ? "Current" : "Current"}</dt>
                        <dd>{currentQuestion ? questionComparisonSummary(currentQuestion) : "Not in Question Bank"}</dd>
                      </div>
                    </dl>
                  </details>
                </li>
              );
            })}
          </ol>
        </div>
        <footer className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary-button" onClick={() => onConfirm(resolutions)}>Use as draft</button>
        </footer>
      </section>
    </div>
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
