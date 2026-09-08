// Reconstructing a compatible historical Version as an Exam Draft.
//
// A Version remains an immutable export artifact. This module only decides
// whether current Question Bank records can occupy its old positions without
// introducing a historical Question Revision into authoring, then expresses
// that arrangement as ordinary Exam Draft references.

import {
  choiceIdOf,
  choiceNodesOf,
  type ProseMirrorJSON,
} from "./question-doc";
import {
  questionRevisionFingerprint,
  type PublishedVersion,
  type PublicationHistory,
} from "./export-preparation";
import {
  bankQuestionById,
  type ExamDraft,
  type QuestionBank,
} from "./question-bank";

function withoutChoiceId(node: ProseMirrorJSON): ProseMirrorJSON {
  const attrs = node.attrs as Record<string, unknown> | undefined;
  const nextAttrs = attrs ? { ...attrs } : undefined;
  delete nextAttrs?.id;
  return {
    ...node,
    ...(nextAttrs ? { attrs: nextAttrs } : {}),
  };
}

function sameArrangement(left: ExamDraft, right: ExamDraft): boolean {
  if (
    left.questionIds.length !== right.questionIds.length ||
    !left.questionIds.every((id, index) => id === right.questionIds[index])
  )
    return false;
  const leftOrder = left.choiceOrder ?? {};
  const rightOrder = right.choiceOrder ?? {};
  const ids = new Set([...Object.keys(leftOrder), ...Object.keys(rightOrder)]);
  return [...ids].every((id) => {
    const leftChoices = leftOrder[id] ?? [];
    const rightChoices = rightOrder[id] ?? [];
    return (
      leftChoices.length === rightChoices.length &&
      leftChoices.every((choiceId, index) => choiceId === rightChoices[index])
    );
  });
}

/**
 * The current Exam Draft arrangement represented by a historical Version, or
 * null when even one historical Question Revision no longer has an identical
 * current source record. Difficulty and Topics deliberately do not participate
 * in Question Revision identity, so metadata-only edits take this path.
 */
export function compatibleHistoricalDraft(
  history: PublicationHistory,
  version: PublishedVersion,
  currentDraft: ExamDraft,
  bank: QuestionBank,
): ExamDraft | null {
  const revisions = new Map(
    history.revisions.map((revision) => [revision.id, revision]),
  );
  const historical = version.revisionIds.map((id) => revisions.get(id));
  if (historical.some((revision) => !revision)) return null;

  const questionIds: string[] = [];
  for (const revision of historical) {
    const current = bankQuestionById(bank, revision!.sourceQuestionId);
    if (
      !current ||
      questionRevisionFingerprint(current) !== revision!.fingerprint
    ) {
      return null;
    }
    questionIds.push(current.id);
  }
  if (new Set(questionIds).size !== questionIds.length) return null;

  // The stored student-test plan is the authoritative historical answer
  // arrangement. A revision's source id is also the planned question id; split
  // questions repeat it, so retain only the first whole planned question.
  const testPlan = history.plans.find(
    (plan) => plan.versionId === version.id && plan.stream === "test",
  )?.plan;
  if (!testPlan) return null;
  const historicalChoices = new Map<
    string,
    readonly { id: string; node: ProseMirrorJSON }[]
  >();
  for (const page of testPlan.pages) {
    for (const item of page.items) {
      if (item.kind !== "question" || historicalChoices.has(item.question.id))
        continue;
      historicalChoices.set(item.question.id, item.question.choices);
    }
  }

  const choiceOrder: Record<string, string[]> = {};
  for (const questionId of questionIds) {
    const current = bankQuestionById(bank, questionId)!;
    if (current.type !== "multiple-choice") continue;
    const oldChoices = historicalChoices.get(questionId);
    if (!oldChoices) return null;
    const available = choiceNodesOf(current.doc);
    const ordered: string[] = [];
    for (const oldChoice of oldChoices) {
      // Generated choice ids are deliberately outside presentation identity.
      // Match what the student sees first: regenerated ids may have been
      // assigned to different choices. An unchanged id only disambiguates
      // otherwise indistinguishable duplicate choices.
      const presentation = JSON.stringify(withoutChoiceId(oldChoice.node));
      const matches = available
        .map((candidate, index) => ({ candidate, index }))
        .filter(
          ({ candidate }) =>
            JSON.stringify(withoutChoiceId(candidate)) === presentation,
        );
      const index =
        matches.find(({ candidate }) => choiceIdOf(candidate) === oldChoice.id)
          ?.index ??
        matches[0]?.index ??
        -1;
      if (index < 0) return null;
      const [matched] = available.splice(index, 1);
      const id = matched ? choiceIdOf(matched) : undefined;
      if (!id) return null;
      ordered.push(id);
    }
    if (available.length !== 0) return null;
    const authoredOrder = choiceNodesOf(current.doc).map(choiceIdOf);
    if (
      !ordered.every((choiceId, index) => choiceId === authoredOrder[index])
    ) {
      choiceOrder[questionId] = ordered;
    }
  }

  const next = { ...currentDraft, questionIds, choiceOrder };
  return sameArrangement(currentDraft, next) ? currentDraft : next;
}

/** Whether the live draft already has the complete arrangement of a Version. */
export function draftMatchesHistoricalVersion(
  history: PublicationHistory,
  version: PublishedVersion,
  draft: ExamDraft,
  bank: QuestionBank,
): boolean {
  // A title is semantic export content, not editor chrome. The canonical test
  // plan retains the title a Version was exported with, so a title-only change
  // is as much a divergent draft as a reordered question.
  const title = history.plans.find(
    (plan) => plan.versionId === version.id && plan.stream === "test",
  )?.plan.title;
  return (
    title === draft.title &&
    compatibleHistoricalDraft(history, version, draft, bank) === draft
  );
}
