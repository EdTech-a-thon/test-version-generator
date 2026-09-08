// One-Version publication preparation.
//
// This is the pure application boundary for publishing the current Exam Draft.
// It always resolves the canonical student test and answer-key Layout Plans,
// derives a name-independent Export Fingerprint from both, reuses an immutable
// Version when that fingerprint already exists, and returns the exact records a
// durable adapter must commit. Artifact packaging and persistence deliberately
// remain downstream so neither can partially publish history.

import {
  orderedQuestions,
  type Exam,
  type Question,
  type Version,
} from './exam'
import { layoutFingerprint } from './export-fingerprint'
import {
  planExport,
  type ExportContentSelection,
  type LayoutPlan,
  type Measure,
  type PageStream,
} from './export-plan'
import type { ProseMirrorJSON } from './question-doc'

export type ExportConfiguration = {
  selection: ExportContentSelection
}

/** A fresh export produces the complete assessment package. */
export const DEFAULT_EXPORT_CONFIGURATION: ExportConfiguration = {
  selection: { test: true, answerKey: true },
}

export type QuestionRevision = {
  id: string
  fingerprint: string
  sourceQuestionId: string
  question: Pick<Question, 'type' | 'doc' | 'columns'>
  metadata: Pick<Question, 'difficulty' | 'topics'>
  createdAt: string
}

export type PublishedVersion = {
  id: string
  name: string
  fingerprint: string
  createdAt: string
  historyPosition: number
  questionCount: number
  revisionIds: string[]
}

export type PublishedLayoutPlan = {
  id: string
  versionId: string
  stream: PageStream
  plan: LayoutPlan
}

export type PublicationHistory = {
  versions: PublishedVersion[]
  revisions: QuestionRevision[]
  plans: PublishedLayoutPlan[]
}

export const EMPTY_PUBLICATION_HISTORY: PublicationHistory = {
  versions: [],
  revisions: [],
  plans: [],
}

export type PublicationCommit = {
  /** The Version the live draft export resolved, including a re-export.
   * Historical exports omit it because they never become the current draft's
   * comparison point. */
  exportedVersionId?: string
  /** Null for a re-export: immutable history receives no duplicate Version. */
  version: PublishedVersion | null
  revisions: QuestionRevision[]
  plans: PublishedLayoutPlan[]
  /** Required assets already owned by the shared Media Store. */
  mediaHashes: string[]
}

export type PreparationProgress = {
  stage: 'planning' | 'resolving'
  completed: number
  total: number
}

export type PreparedExport = {
  resolution:
    | { kind: 'new'; version: PublishedVersion }
    | { kind: 'existing'; version: PublishedVersion }
  canonicalPlans: { test: LayoutPlan; answerKey: LayoutPlan }
  /** Selected plans in artifact order: the test is always before its key. */
  documents: LayoutPlan[]
  filename: string
  fingerprint: string
  publication: PublicationCommit
}

export type PreparationRequest = {
  exam: Exam
  version: Version
  configuration: ExportConfiguration
  history: PublicationHistory
  measure: Measure
  /** Injected time is first-creation metadata and never part of identity. */
  createdAt: string
  onProgress?: (progress: PreparationProgress) => void
}

const TEST_ONLY: ExportContentSelection = { test: true, answerKey: false }
const KEY_ONLY: ExportContentSelection = { test: false, answerKey: true }
const FINGERPRINT_LABEL = ''
const OWNED_MEDIA = /^\/local-images\/([a-f0-9]{64})$/

const ADJECTIVES = [
  'Amber',
  'Brisk',
  'Calm',
  'Curly',
  'Daring',
  'Gentle',
  'Merry',
  'Nimble',
  'Quiet',
  'Sunny',
  'Swift',
  'Wise',
] as const
const NOUNS = [
  'Badger',
  'Falcon',
  'Fox',
  'Heron',
  'Lynx',
  'Otter',
  'Panda',
  'Raven',
  'Robin',
  'Seal',
  'Tiger',
  'Wren',
] as const

export function sanitizeExamTitle(title: string): string {
  const safe = title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
  return safe || 'Untitled exam'
}

/** Kept beside the adapters because their package metadata also describes a
 * collection. Publication now supplies exactly one friendly name. */
export function versionRange(labels: readonly string[]): string {
  const first = labels[0] ?? ''
  const last = labels.at(-1) ?? first
  return labels.length > 1 ? `${first}-${last}` : first
}

export function docxFilename(title: string, versionName: string): string {
  return `${sanitizeExamTitle(title)}-${versionName}.docx`
}

function nextFriendlyName(history: PublicationHistory): string {
  const taken = new Set(history.versions.map((version) => version.name))
  for (const adjective of ADJECTIVES) {
    for (const noun of NOUNS) {
      const candidate = `${adjective} ${noun}`
      if (!taken.has(candidate)) return candidate
    }
  }
  throw new Error('No friendly Version names remain. Please contact support.')
}

function nextId(prefix: string, taken: Iterable<string>): string {
  const ids = new Set(taken)
  for (let index = 1; ; index += 1) {
    const candidate = `${prefix}-${index}`
    if (!ids.has(candidate)) return candidate
  }
}

function withoutGeneratedIds(node: ProseMirrorJSON): ProseMirrorJSON {
  const attrs =
    typeof node.attrs === 'object' && node.attrs !== null
      ? { ...(node.attrs as Record<string, unknown>) }
      : undefined
  if (node.type === 'multipleChoiceChoice' && attrs) delete attrs.id
  return {
    ...node,
    ...(attrs ? { attrs } : {}),
    ...(Array.isArray(node.content)
      ? {
          content: node.content.map((child) =>
            withoutGeneratedIds(child as ProseMirrorJSON),
          ),
        }
      : {}),
  }
}

/** Presentation identity only: Question Metadata and source/generated ids are
 * provenance, not something a student sees. */
export function questionRevisionFingerprint(question: Question): string {
  return JSON.stringify({
    type: question.type,
    columns: question.columns,
    doc: withoutGeneratedIds(question.doc),
  })
}

function mediaSourceOccurrencesOf(plans: readonly LayoutPlan[]): string[] {
  const sources: string[] = []
  const visit = (node: ProseMirrorJSON) => {
    const attrs = node.attrs as Record<string, unknown> | undefined
    if (node.type === 'image' || node.type === 'image-block') {
      const source = typeof attrs?.src === 'string' ? attrs.src : ''
      if (source) sources.push(source)
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) visit(child as ProseMirrorJSON)
    }
  }
  for (const plan of plans) {
    for (const page of plan.pages) {
      for (const item of page.items) {
        if (item.kind !== 'question') continue
        for (const block of item.stem) visit(block)
        for (const row of item.grid?.cells ?? []) {
          for (const cell of row) if (cell) visit(cell.node)
        }
      }
    }
  }
  return sources
}

function mediaSourcesOf(plans: readonly LayoutPlan[]): string[] {
  return [...new Set(mediaSourceOccurrencesOf(plans))]
}

function mediaIdentityOf(source: string): string {
  return OWNED_MEDIA.exec(source)?.[1] ?? source
}

/** The Version identity vocabulary is the public Layout Plan fingerprint for
 * both canonical streams plus immutable media identities. The blank planning
 * label makes friendly naming incapable of manufacturing a new Version. */
export function versionFingerprintOf(
  test: LayoutPlan,
  answerKey: LayoutPlan,
): string {
  const unnamed = [test, answerKey].map((plan) => ({
    ...plan,
    version: { ...plan.version, letter: '' },
    pages: plan.pages.map((page) => ({
      ...page,
      furniture: { ...page.furniture, versionLabel: versionLabel() },
    })),
  }))
  const fingerprint = layoutFingerprint(unnamed)
  return JSON.stringify({
    title: fingerprint.title,
    pages: fingerprint.pages,
    // Image ordinals in the Layout Plan retain position, so bind every ordinal
    // to its content hash rather than collapsing repeated media into a set.
    media: mediaSourceOccurrencesOf([test, answerKey]).map(mediaIdentityOf),
    breaks: [test, answerKey].flatMap((plan) =>
      plan.pages.map((page) => page.breakBefore),
    ),
  })
}

function versionLabel(name?: string): string {
  return name ? `Version: ${name}` : 'Version:'
}

function namedPlan(plan: LayoutPlan, version: PublishedVersion): LayoutPlan {
  return {
    ...plan,
    version: { id: version.id, letter: version.name },
    pages: plan.pages.map((page) => ({
      ...page,
      furniture: {
        ...page.furniture,
        versionLabel: versionLabel(version.name),
      },
    })),
  }
}

function documentsOf(
  plans: { test: LayoutPlan; answerKey: LayoutPlan },
  selection: ExportContentSelection,
): LayoutPlan[] {
  return [
    ...(selection.test ? [plans.test] : []),
    ...(selection.answerKey ? [plans.answerKey] : []),
  ]
}

function mediaHashesOf(plans: readonly LayoutPlan[]): string[] {
  return mediaSourcesOf(plans).flatMap((source) => {
    const match = OWNED_MEDIA.exec(source)
    if (!match) {
      throw new Error(
        `Required media ${source} is not owned by this exam. Re-add the affected image and try again.`,
      )
    }
    return [match[1]!]
  })
}

function storedPlansOf(
  history: PublicationHistory,
  version: PublishedVersion,
): { test: LayoutPlan; answerKey: LayoutPlan } {
  const records = history.plans.filter((plan) => plan.versionId === version.id)
  const test = records.find((plan) => plan.stream === 'test')?.plan
  const answerKey = records.find((plan) => plan.stream === 'answer-key')?.plan
  if (!test || !answerKey) {
    throw new Error(
      `Version ${version.name} is missing a canonical Layout Plan.`,
    )
  }
  return { test, answerKey }
}

function newRevisionRecords(
  questions: readonly Question[],
  history: PublicationHistory,
  createdAt: string,
): { ids: string[]; revisions: QuestionRevision[] } {
  const bySourceAndFingerprint = new Map(
    history.revisions.map((revision) => [
      JSON.stringify([revision.sourceQuestionId, revision.fingerprint]),
      revision,
    ]),
  )
  const revisions: QuestionRevision[] = []
  const takenIds = history.revisions.map((revision) => revision.id)
  const ids = questions.map((question) => {
    const fingerprint = questionRevisionFingerprint(question)
    const identity = JSON.stringify([question.id, fingerprint])
    const existing = bySourceAndFingerprint.get(identity)
    if (existing) return existing.id
    const revision: QuestionRevision = {
      id: nextId('revision', [
        ...takenIds,
        ...revisions.map((item) => item.id),
      ]),
      fingerprint,
      sourceQuestionId: question.id,
      question: {
        type: question.type,
        columns: question.columns,
        doc: structuredClone(question.doc),
      },
      metadata: {
        ...(question.difficulty ? { difficulty: question.difficulty } : {}),
        ...(question.topics ? { topics: [...question.topics] } : {}),
      },
      createdAt,
    }
    revisions.push(revision)
    bySourceAndFingerprint.set(identity, revision)
    return revision.id
  })
  return { ids, revisions }
}

/**
 * Select documents from a stored Version without consulting an Exam Draft or
 * running layout again. This is deliberately separate from `prepareExport`:
 * history browsing stays valid after authoring content or layout code changes.
 */
export function prepareHistoricalExport({
  history,
  version,
  configuration,
}: {
  history: PublicationHistory
  version: PublishedVersion
  configuration: ExportConfiguration
}): PreparedExport {
  if (!configuration.selection.test && !configuration.selection.answerKey) {
    throw new Error('Choose the student test, the answer key, or both.')
  }
  const canonicalPlans = storedPlansOf(history, version)
  return {
    resolution: { kind: 'existing', version },
    canonicalPlans,
    documents: documentsOf(canonicalPlans, configuration.selection),
    // The title belongs to the stored Layout Plan, never the live Exam Draft.
    filename: docxFilename(canonicalPlans.test.title, version.name),
    fingerprint: version.fingerprint,
    publication: {
      version: null,
      revisions: [],
      plans: [],
      mediaHashes: mediaHashesOf([canonicalPlans.test, canonicalPlans.answerKey]),
    },
  }
}

/** Prepare one immutable Version or an exact re-export. */
export function prepareExport({
  exam,
  version,
  configuration,
  history,
  measure,
  createdAt,
  onProgress,
}: PreparationRequest): PreparedExport {
  if (exam.questions.length === 0) {
    throw new Error(
      'Add at least one question to the Exam Draft before exporting.',
    )
  }
  if (!configuration.selection.test && !configuration.selection.answerKey) {
    throw new Error('Choose the student test, the answer key, or both.')
  }

  const fingerprintVersion = { ...version, letter: FINGERPRINT_LABEL }
  const neutralTest = planExport({
    exam,
    version: fingerprintVersion,
    selection: TEST_ONLY,
    measure,
  })
  onProgress?.({ stage: 'planning', completed: 1, total: 2 })
  const neutralAnswerKey = planExport({
    exam,
    version: fingerprintVersion,
    selection: KEY_ONLY,
    measure,
  })
  onProgress?.({ stage: 'planning', completed: 2, total: 2 })
  const fingerprint = versionFingerprintOf(neutralTest, neutralAnswerKey)
  const existing = history.versions.find(
    (item) => item.fingerprint === fingerprint,
  )

  if (existing) {
    const canonicalPlans = storedPlansOf(history, existing)
    onProgress?.({ stage: 'resolving', completed: 1, total: 1 })
    return {
      resolution: { kind: 'existing', version: existing },
      canonicalPlans,
      documents: documentsOf(canonicalPlans, configuration.selection),
      filename: docxFilename(exam.title, existing.name),
      fingerprint,
      publication: {
        exportedVersionId: existing.id,
        version: null,
        revisions: [],
        plans: [],
        mediaHashes: mediaHashesOf([
          canonicalPlans.test,
          canonicalPlans.answerKey,
        ]),
      },
    }
  }

  const revisions = newRevisionRecords(
    orderedQuestions(exam, version),
    history,
    createdAt,
  )
  const published: PublishedVersion = {
    id: nextId(
      'version',
      history.versions.map((item) => item.id),
    ),
    name: nextFriendlyName(history),
    fingerprint,
    createdAt,
    historyPosition: history.versions.length,
    questionCount: exam.questions.length,
    revisionIds: revisions.ids,
  }
  const canonicalPlans = {
    test: namedPlan(neutralTest, published),
    answerKey: namedPlan(neutralAnswerKey, published),
  }
  const plans: PublishedLayoutPlan[] = [
    {
      id: `${published.id}:test`,
      versionId: published.id,
      stream: 'test',
      plan: canonicalPlans.test,
    },
    {
      id: `${published.id}:answer-key`,
      versionId: published.id,
      stream: 'answer-key',
      plan: canonicalPlans.answerKey,
    },
  ]
  onProgress?.({ stage: 'resolving', completed: 1, total: 1 })
  return {
    resolution: { kind: 'new', version: published },
    canonicalPlans,
    documents: documentsOf(canonicalPlans, configuration.selection),
    filename: docxFilename(exam.title, published.name),
    fingerprint,
    publication: {
      exportedVersionId: published.id,
      version: published,
      revisions: revisions.revisions,
      plans,
      mediaHashes: mediaHashesOf([
        canonicalPlans.test,
        canonicalPlans.answerKey,
      ]),
    },
  }
}

export function plansOf(prepared: PreparedExport): LayoutPlan[] {
  return prepared.documents
}
