// Reconstructing a historical Version as an Exam Draft.
//
// A Version is immutable. This module compares its complete Question Revisions
// with today's Question Bank, describes the teacher decisions necessary to use
// it as a draft, and creates a single replacement authoring state only when all
// of those decisions are known.

import {
  choiceIdOf,
  choiceIsCorrect,
  choiceNodesOf,
  type ProseMirrorJSON,
} from './question-doc'
import {
  questionRevisionFingerprint,
  type PublishedVersion,
  type PublicationHistory,
  type QuestionRevision,
} from './export-preparation'
import type { Question } from './exam'
import {
  bankQuestionById,
  type ExamDraft,
  type QuestionBank,
} from './question-bank'
import type { LayoutPlan } from './export-plan'

export type HistoricalQuestionResolution =
  | 'use-latest'
  | 'keep-historical'
  | 'add-to-question-bank'
  | 'leave-out'

export type HistoricalQuestionDifference =
  | 'content'
  | 'answers'
  | 'correctness'
  | 'media'
  | 'columns'

export type HistoricalQuestionReview = {
  revision: QuestionRevision
  /** A current record with this source identity, when it still exists. */
  current: Question | null
  status: 'updated' | 'not-in-question-bank'
  differences: HistoricalQuestionDifference[]
  defaultResolution: HistoricalQuestionResolution
}

export type HistoricalReconciliation = {
  rows: HistoricalQuestionReview[]
}

export type ReconciledHistoricalDraft = {
  questionBank: QuestionBank
  examDraft: ExamDraft
}

function withoutChoiceId(node: ProseMirrorJSON): ProseMirrorJSON {
  const attrs = node.attrs as Record<string, unknown> | undefined
  const nextAttrs = attrs ? { ...attrs } : undefined
  delete nextAttrs?.id
  return {
    ...node,
    ...(nextAttrs ? { attrs: nextAttrs } : {}),
  }
}

function sameArrangement(left: ExamDraft, right: ExamDraft): boolean {
  if (
    left.questionIds.length !== right.questionIds.length ||
    !left.questionIds.every((id, index) => id === right.questionIds[index])
  ) return false
  const leftOrder = left.choiceOrder ?? {}
  const rightOrder = right.choiceOrder ?? {}
  const ids = new Set([...Object.keys(leftOrder), ...Object.keys(rightOrder)])
  return [...ids].every((id) => {
    const leftChoices = leftOrder[id] ?? []
    const rightChoices = rightOrder[id] ?? []
    return leftChoices.length === rightChoices.length
      && leftChoices.every((choiceId, index) => choiceId === rightChoices[index])
  })
}

function historicalPlan(
  history: PublicationHistory,
  version: PublishedVersion,
): LayoutPlan | null {
  return history.plans.find(
    (plan) => plan.versionId === version.id && plan.stream === 'test',
  )?.plan ?? null
}

function historicalChoices(
  plan: LayoutPlan,
): Map<string, readonly { id: string; node: ProseMirrorJSON }[]> {
  const choices = new Map<string, readonly { id: string; node: ProseMirrorJSON }[]>()
  for (const page of plan.pages) {
    for (const item of page.items) {
      if (item.kind !== 'question' || choices.has(item.question.id)) continue
      choices.set(item.question.id, item.question.choices)
    }
  }
  return choices
}

function historicalQuestion(revision: QuestionRevision, id: string): Question {
  return {
    id,
    type: revision.question.type,
    doc: structuredClone(revision.question.doc),
    columns: revision.question.columns,
    ...(revision.metadata.difficulty
      ? { difficulty: revision.metadata.difficulty }
      : {}),
    ...(revision.metadata.topics
      ? { topics: [...revision.metadata.topics] }
      : {}),
  }
}

function mediaOf(doc: ProseMirrorJSON): ProseMirrorJSON[] {
  const media: ProseMirrorJSON[] = []
  const visit = (node: ProseMirrorJSON) => {
    if (node.type === 'image' || node.type === 'image-block') {
      // Every image attribute is presentation state: source, authored size,
      // caption, alt text, and future image attributes all need review under
      // the media label rather than silently falling back to generic content.
      media.push(structuredClone(node))
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) visit(child as ProseMirrorJSON)
    }
  }
  visit(doc)
  return media
}

function sameJSON(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function answerPresentationNode(choice: ProseMirrorJSON): ProseMirrorJSON {
  const attrs = choice.attrs as Record<string, unknown> | undefined
  const nextAttrs = attrs ? { ...attrs } : undefined
  delete nextAttrs?.id
  delete nextAttrs?.correct
  return { ...choice, ...(nextAttrs ? { attrs: nextAttrs } : {}) }
}

function answerPresentation(question: Question): ProseMirrorJSON[] {
  return choiceNodesOf(question.doc).map(answerPresentationNode)
}

function contentWithoutMediaOrAnswers(node: ProseMirrorJSON): ProseMirrorJSON | null {
  if (node.type === 'multipleChoice' || node.type === 'image' || node.type === 'image-block') {
    return null
  }
  return {
    ...node,
    ...(Array.isArray(node.content)
      ? {
          content: node.content
            .map((child) => contentWithoutMediaOrAnswers(child as ProseMirrorJSON))
            .filter((child): child is ProseMirrorJSON => child !== null),
        }
      : {}),
  }
}

/** Labels for an updated-row summary and comparison. Metadata intentionally
 * never appears here: it is not Question Revision presentation state. */
export function historicalQuestionDifferences(
  revision: QuestionRevision,
  current: Question,
): HistoricalQuestionDifference[] {
  const oldQuestion = historicalQuestion(revision, revision.sourceQuestionId)
  const differences: HistoricalQuestionDifference[] = []
  const oldContent = contentWithoutMediaOrAnswers(oldQuestion.doc)
  const currentContent = contentWithoutMediaOrAnswers(current.doc)
  if (oldQuestion.type !== current.type || !sameJSON(oldContent, currentContent)) {
    differences.push('content')
  }
  if (!sameJSON(answerPresentation(oldQuestion), answerPresentation(current))) {
    differences.push('answers')
  }
  // Choice ids are stable when a question is edited. Compare correctness by
  // identity, not position, so reordering does not manufacture a correctness
  // change and moving correctness to a different answer cannot be hidden. For
  // old documents with regenerated ids, answer presentation is the fallback.
  const choicesOf = (question: Question) => choiceNodesOf(question.doc)
  const oldIds = choicesOf(oldQuestion).map(choiceIdOf)
  const currentIds = choicesOf(current).map(choiceIdOf)
  const useChoiceIds = oldIds.length === currentIds.length
    && oldIds.every((id) => id !== '' && currentIds.includes(id))
    && new Set(oldIds).size === oldIds.length
  const correctnessByIdentity = (question: Question): Record<string, boolean> =>
    Object.fromEntries(
      choicesOf(question).map((choice): [string, boolean] => [
        useChoiceIds ? choiceIdOf(choice) : JSON.stringify(answerPresentationNode(choice)),
        choiceIsCorrect(choice),
      ]).sort(([left], [right]) => left.localeCompare(right)),
    )
  if (!sameJSON(correctnessByIdentity(oldQuestion), correctnessByIdentity(current))) {
    differences.push('correctness')
  }
  if (!sameJSON(mediaOf(oldQuestion.doc), mediaOf(current.doc))) {
    differences.push('media')
  }
  if (oldQuestion.columns !== current.columns) differences.push('columns')
  // A presentation fingerprint says the records differ. Be defensive about a
  // future presentation field: it must still produce a visible review row.
  if (
    differences.length === 0
    && questionRevisionFingerprint(oldQuestion) !== questionRevisionFingerprint(current)
  ) differences.push('content')
  return differences
}

/** The rows requiring a teacher choice. Unchanged and metadata-only records
 * deliberately do not become review work. Null means the stored Version is
 * incomplete and therefore cannot safely be made into a draft. */
export function historicalReconciliation(
  history: PublicationHistory,
  version: PublishedVersion,
  bank: QuestionBank,
): HistoricalReconciliation | null {
  if (!historicalPlan(history, version)) return null
  const revisions = new Map(history.revisions.map((revision) => [revision.id, revision]))
  const rows: HistoricalQuestionReview[] = []
  for (const revisionId of version.revisionIds) {
    const revision = revisions.get(revisionId)
    if (!revision) return null
    const current = bankQuestionById(bank, revision.sourceQuestionId) ?? null
    if (!current) {
      rows.push({
        revision,
        current: null,
        status: 'not-in-question-bank',
        differences: ['content', 'answers', 'correctness', 'media', 'columns'],
        defaultResolution: 'add-to-question-bank',
      })
    } else if (questionRevisionFingerprint(current) !== revision.fingerprint) {
      rows.push({
        revision,
        current,
        status: 'updated',
        differences: historicalQuestionDifferences(revision, current),
        defaultResolution: 'use-latest',
      })
    }
  }
  return { rows }
}

function orderForSamePresentation(
  current: Question,
  historical: readonly { id: string; node: ProseMirrorJSON }[],
): string[] | null {
  if (current.type !== 'multiple-choice') return []
  const available = choiceNodesOf(current.doc)
  const ordered: string[] = []
  for (const oldChoice of historical) {
    const presentation = JSON.stringify(withoutChoiceId(oldChoice.node))
    const matches = available
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) =>
        JSON.stringify(withoutChoiceId(candidate)) === presentation,
      )
    const index =
      matches.find(({ candidate }) => choiceIdOf(candidate) === oldChoice.id)?.index
      ?? matches[0]?.index
      ?? -1
    if (index < 0) return null
    const [matched] = available.splice(index, 1)
    const id = matched ? choiceIdOf(matched) : undefined
    if (!id) return null
    ordered.push(id)
  }
  return available.length === 0 ? ordered : null
}

function hasSameChoiceIdentities(
  current: Question,
  historical: readonly { id: string; node: ProseMirrorJSON }[],
): boolean {
  const currentIds = choiceNodesOf(current.doc).map(choiceIdOf)
  const historicalIds = historical.map((choice) => choice.id)
  return currentIds.length === historicalIds.length
    && currentIds.every((id) => id !== '' && historicalIds.includes(id))
    && new Set(currentIds).size === currentIds.length
    && new Set(historicalIds).size === historicalIds.length
}

function recordOrder(
  target: Record<string, string[]>,
  question: Question,
  historical: readonly { id: string; node: ProseMirrorJSON }[],
  order: readonly string[] | null,
) {
  if (question.type !== 'multiple-choice' || !order) return
  const authored = choiceNodesOf(question.doc).map(choiceIdOf)
  if (!order.every((id, index) => id === authored[index])) {
    target[question.id] = [...order]
  }
}

function freshQuestionId(taken: Set<string>): string {
  let id = crypto.randomUUID()
  while (taken.has(id)) id = crypto.randomUUID()
  taken.add(id)
  return id
}

/** Resolve all row choices into complete current records or complete historical
 * Question Revisions. It never edits a current record and it never revives a
 * historical source identity. The caller can install this result atomically. */
export function reconcileHistoricalDraft(
  history: PublicationHistory,
  version: PublishedVersion,
  currentDraft: ExamDraft,
  bank: QuestionBank,
  resolutions: Readonly<Record<string, HistoricalQuestionResolution>> = {},
): ReconciledHistoricalDraft | null {
  const reconciliation = historicalReconciliation(history, version, bank)
  const plan = historicalPlan(history, version)
  if (!reconciliation || !plan) return null
  const rows = new Map(reconciliation.rows.map((row) => [row.revision.id, row]))
  const revisions = new Map(history.revisions.map((revision) => [revision.id, revision]))
  const plannedChoices = historicalChoices(plan)
  const questionIds: string[] = []
  const choiceOrder: Record<string, string[]> = {}
  const additions: Question[] = []
  const takenIds = new Set(bank.questions.map((question) => question.id))

  for (const revisionId of version.revisionIds) {
    const revision = revisions.get(revisionId)
    if (!revision) return null
    const historical = plannedChoices.get(revision.sourceQuestionId)
    if (!historical) return null
    const row = rows.get(revision.id)
    const resolution = row
      ? (resolutions[revision.id] ?? row.defaultResolution)
      : null

    if (!row) {
      const current = bankQuestionById(bank, revision.sourceQuestionId)
      if (!current) return null
      const order = orderForSamePresentation(current, historical)
      if (order === null) return null
      questionIds.push(current.id)
      recordOrder(choiceOrder, current, historical, order)
      continue
    }

    if (row.status === 'not-in-question-bank' && resolution === 'leave-out') continue
    if (row.status === 'updated' && resolution === 'use-latest') {
      if (!row.current) return null
      questionIds.push(row.current.id)
      // A changed choice set has no safe historical permutation. In that case
      // use the complete current authored order, represented by no override.
      const order = hasSameChoiceIdentities(row.current, historical)
        ? historical.map((choice) => choice.id)
        : null
      recordOrder(choiceOrder, row.current, historical, order)
      continue
    }
    if (
      (row.status === 'updated' && resolution !== 'keep-historical')
      || (row.status === 'not-in-question-bank' && resolution !== 'add-to-question-bank')
    ) return null
    const recreated = historicalQuestion(revision, freshQuestionId(takenIds))
    additions.push(recreated)
    questionIds.push(recreated.id)
    recordOrder(choiceOrder, recreated, historical, historical.map((choice) => choice.id))
  }

  if (new Set(questionIds).size !== questionIds.length) return null
  const examDraft: ExamDraft = {
    ...currentDraft,
    questionIds,
    choiceOrder,
  }
  return {
    questionBank: additions.length === 0
      ? bank
      : { questions: [...bank.questions, ...additions] },
    examDraft: sameArrangement(currentDraft, examDraft) ? currentDraft : examDraft,
  }
}

/** The compatibility path retained for callers that only need an answer, not
 * the review UI. It succeeds exactly when no reconciliation choice is needed. */
export function compatibleHistoricalDraft(
  history: PublicationHistory,
  version: PublishedVersion,
  currentDraft: ExamDraft,
  bank: QuestionBank,
): ExamDraft | null {
  const reconciliation = historicalReconciliation(history, version, bank)
  if (!reconciliation || reconciliation.rows.length !== 0) return null
  return reconcileHistoricalDraft(history, version, currentDraft, bank)?.examDraft ?? null
}

/** Whether the live draft already has the complete arrangement of a Version. */
export function draftMatchesHistoricalVersion(
  history: PublicationHistory,
  version: PublishedVersion,
  draft: ExamDraft,
  bank: QuestionBank,
): boolean {
  const title = historicalPlan(history, version)?.title
  return title === draft.title
    && compatibleHistoricalDraft(history, version, draft, bank) === draft
}
