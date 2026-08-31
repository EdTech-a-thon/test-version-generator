// Export preparation: the one place Generated Versions come from.
//
// Everything an export operation needs is decided here, once, for both output
// formats: which Versions the teacher is publishing, what arrangement each of
// them puts the shared Question Content in, and which self-contained Layout
// Plans that resolves into. `planExport` still owns what one document says and
// where its pages fall; this module owns how many documents there are, in what
// order, and under which labels.
//
// It is pure. An `Exam`, the Version being edited, the dialog's configuration,
// an injected `RandomSource` and an injected `Measure` in; ordered
// `PreparedDocument`s and the artifact metadata the chosen workflow needs out.
// Nothing here reads the DOM, a clock or `Math.random`, and nothing here writes
// to the exam store: a Generated Version exists for the length of one export
// and is then gone.
//
// The Export Adapters sit downstream of this. Print mounts the prepared plans
// and DOCX packages them; neither generates a Version, reorders one, or decides
// what the collection contains.

import {
  SECTION_ORDER,
  orderedChoices,
  questionsInSection,
  type Exam,
  type QuestionType,
  type RandomSource,
  type Version,
} from './exam'
import {
  planExport,
  type ExportContentSelection,
  type LayoutPlan,
  type Measure,
  type PageStream,
} from './export-plan'

/** Which output format one export operation publishes in. Exactly one. */
export type OutputFormat = 'print' | 'docx'

/** How many Versions one export may contain: A through Z and no further. */
export const VERSION_LIMIT = 26

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** The export-local label of the Version at `index`: A, B, C, …. Export labels
 *  start at A whatever the edited Version happens to be called, so every
 *  exported set is self-contained. */
export function versionLabelAt(index: number): string {
  return LETTERS[index] ?? LETTERS[LETTERS.length - 1]!
}

/** Which order dimensions Randomization may touch. Both off means every
 *  additional Version would be a duplicate, so only Version A is possible. */
export type Randomization = {
  questions: boolean
  answers: boolean
}

/** What the export dialog decides, and the whole of what preparation is told. */
export type ExportConfiguration = {
  format: OutputFormat
  selection: ExportContentSelection
  /** Total Versions including Version A: at least 1, at most `VERSION_LIMIT`. */
  versionCount: number
  randomization: Randomization
}

/** What a freshly opened dialog offers: print, the student test alone, one
 *  Version, no Randomization. Export configuration is never persisted. */
export const DEFAULT_EXPORT_CONFIGURATION: ExportConfiguration = {
  format: 'print',
  selection: { test: true, answerKey: false },
  versionCount: 1,
  randomization: { questions: false, answers: false },
}

// ---------------------------------------------------------------------------
// Arrangements
//
// An arrangement is one Version's ordering, expressed as a permutation of each
// order group the enabled dimensions make available: one group per Question
// Section for question Randomization, one group per Multiple Choice question
// for answer Randomization. Groups with fewer than two members are dropped —
// they cannot vary, so they are neither shuffled nor counted.
//
// Working in permutations of indices rather than in ids is what makes both
// halves of the uniqueness problem easy: a random draw is a shuffle, and the
// systematic fallback is the next permutation in lexicographic order.

type Group = {
  /** `questions:<section>` or `answers:<question id>`. */
  key: string
  /** The members, in Version A's order. */
  ids: string[]
}

/** Version A's reconciled ordering, group by group — the order every other
 *  Version is a permutation of, and the order Version A itself prints in. */
type OrderSource = {
  sections: { section: QuestionType; ids: string[] }[]
  choices: { questionId: string; ids: string[] }[]
}

function orderSourceOf(exam: Exam, version: Version): OrderSource {
  const sections = SECTION_ORDER.map((section) => ({
    section,
    ids: questionsInSection(exam, version, section).map((question) => question.id),
  }))
  const choices = exam.questions.map((question) => ({
    questionId: question.id,
    ids: orderedChoices(question, version).map((choice) => choice.id),
  }))
  return { sections, choices }
}

/** The groups Randomization may permute. Only these decide both how many
 *  distinct Versions exist and whether two Versions count as different. */
function groupsOf(source: OrderSource, randomization: Randomization): Group[] {
  const groups: Group[] = []
  if (randomization.questions) {
    for (const { section, ids } of source.sections) {
      if (ids.length > 1) groups.push({ key: `questions:${section}`, ids })
    }
  }
  if (randomization.answers) {
    for (const { questionId, ids } of source.choices) {
      if (ids.length > 1) groups.push({ key: `answers:${questionId}`, ids })
    }
  }
  return groups
}

/** One arrangement: a permutation of indices per group, in `groups` order. */
type Arrangement = number[][]

function identityArrangement(groups: readonly Group[]): Arrangement {
  return groups.map((group) => group.ids.map((_id, index) => index))
}

/** Distinctness, evaluated only across the enabled dimensions: two arrangements
 *  are the same Version exactly when every enabled group orders its members the
 *  same way. */
function keyOf(arrangement: Arrangement): string {
  return arrangement.map((permutation) => permutation.join(',')).join('|')
}

function shuffledIndices(length: number, random: RandomSource): number[] {
  const indices = Array.from({ length }, (_unused, index) => index)
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const tmp = indices[i]!
    indices[i] = indices[j]!
    indices[j] = tmp
  }
  return indices
}

function randomArrangement(
  groups: readonly Group[],
  random: RandomSource,
): Arrangement {
  return groups.map((group) => shuffledIndices(group.ids.length, random))
}

/** The next permutation in lexicographic order, in place, wrapping round to the
 *  first. `true` means it wrapped, which is the carry the odometer below needs. */
function nextPermutation(permutation: number[]): boolean {
  let pivot = permutation.length - 2
  while (pivot >= 0 && permutation[pivot]! >= permutation[pivot + 1]!) pivot -= 1
  if (pivot < 0) {
    permutation.reverse()
    return true
  }
  let successor = permutation.length - 1
  while (permutation[successor]! <= permutation[pivot]!) successor -= 1
  const tmp = permutation[pivot]!
  permutation[pivot] = permutation[successor]!
  permutation[successor] = tmp
  for (
    let left = pivot + 1, right = permutation.length - 1;
    left < right;
    left += 1, right -= 1
  ) {
    const swap = permutation[left]!
    permutation[left] = permutation[right]!
    permutation[right] = swap
  }
  return false
}

/**
 * The arrangement after this one, as an odometer over the groups: advance the
 * first group's permutation, carry into the next when it wraps.
 *
 * This is what makes generation terminate. The walk is a cycle over every
 * arrangement in the space and each step lands on one that has not been visited
 * on this walk, so an unused arrangement is always within as many steps as there
 * are Versions already taken — even when the space holds barely more
 * arrangements than the teacher asked for.
 */
function advance(arrangement: Arrangement): Arrangement {
  const next = arrangement.map((permutation) => permutation.slice())
  for (const permutation of next) {
    if (!nextPermutation(permutation)) break
  }
  return next
}

/** `n!`, saturating at `limit` rather than growing without bound: nothing here
 *  needs to know that twenty questions arrange 2.4 quintillion ways, only that
 *  it is more than the twenty-six the dialog can offer. */
function factorial(n: number, limit: number): number {
  let result = 1
  for (let factor = 2; factor <= n; factor += 1) {
    result *= factor
    if (result >= limit) return limit
  }
  return result
}

/**
 * How many distinct Versions this exam can produce under these dimensions,
 * capped at `VERSION_LIMIT`.
 *
 * Version A counts: it participates in the uniqueness set, so an exam whose
 * only shuffleable material is one two-choice question can produce exactly two
 * Versions. Neither dimension enabled — or nothing to shuffle — means one.
 */
export function maxDistinctVersions(
  exam: Exam,
  version: Version,
  randomization: Randomization,
): number {
  const groups = groupsOf(orderSourceOf(exam, version), randomization)
  let total = 1
  for (const group of groups) {
    total *= factorial(group.ids.length, VERSION_LIMIT)
    if (total >= VERSION_LIMIT) return VERSION_LIMIT
  }
  return total
}

// ---------------------------------------------------------------------------
// Generated Versions

/** An arrangement as a Version the planner can take. Export-local: the id and
 *  the label belong to this export, and neither is ever written to the store. */
function versionOf(
  source: OrderSource,
  groups: readonly Group[],
  arrangement: Arrangement,
  label: string,
): Version {
  const arranged = new Map<string, string[]>(
    groups.map((group, index) => [
      group.key,
      arrangement[index]!.map((position) => group.ids[position]!),
    ]),
  )
  return {
    id: `export-version-${label}`,
    letter: label,
    questionOrder: source.sections.flatMap(
      ({ section, ids }) => arranged.get(`questions:${section}`) ?? ids,
    ),
    choiceOrder: Object.fromEntries(
      source.choices.map(({ questionId, ids }) => [
        questionId,
        arranged.get(`answers:${questionId}`) ?? ids,
      ]),
    ),
  }
}

/**
 * The export's Versions, in label order.
 *
 * Version A is the current arrangement, relabelled A. Every Version after it is
 * a fresh draw from the enabled dimensions, walked forward systematically if the
 * draw collides with a Version already in the set — so the collection is always
 * distinct across the dimensions the teacher enabled, and generation always
 * finishes.
 */
export function generateVersions(
  exam: Exam,
  version: Version,
  count: number,
  randomization: Randomization,
  random: RandomSource,
  onVersion?: (index: number) => void,
): Version[] {
  const source = orderSourceOf(exam, version)
  const groups = groupsOf(source, randomization)
  const base = identityArrangement(groups)
  const taken = new Set([keyOf(base)])
  const versions = [versionOf(source, groups, base, versionLabelAt(0))]
  onVersion?.(0)

  for (let index = 1; index < count; index += 1) {
    let candidate = randomArrangement(groups, random)
    while (taken.has(keyOf(candidate))) candidate = advance(candidate)
    taken.add(keyOf(candidate))
    versions.push(versionOf(source, groups, candidate, versionLabelAt(index)))
    onVersion?.(index)
  }
  return versions
}

// ---------------------------------------------------------------------------
// Preparation

/** One standalone published document: a student test or an answer key, for one
 *  Generated Version, already resolved onto its own sheets. */
export type PreparedDocument = {
  /** The export-local Version label the document carries on every page. */
  label: string
  stream: PageStream
  plan: LayoutPlan
}

/** What preparation reports while it works. `total` is what the stage will
 *  finish at, so a caller can show real progress rather than an invented one. */
export type PreparationProgress = {
  stage: 'versions' | 'planning'
  completed: number
  total: number
}

export type PreparedExport = {
  format: OutputFormat
  /** The export-local labels, A through the last, in order. */
  labels: string[]
  /** Every standalone document, in published order: all student tests A through
   *  the last, then all answer keys A through the last. */
  documents: PreparedDocument[]
  /** What a DOCX download is called. Print has no file, and ignores it. */
  filename: string
}

export type PreparationRequest = {
  exam: Exam
  /** The Version being edited. Read for its ordering; never written to. */
  version: Version
  configuration: ExportConfiguration
  /** Injected: `Math.random` in the app, a fixed sequence in tests. */
  random: RandomSource
  measure: Measure
  onProgress?: (progress: PreparationProgress) => void
}

const TEST_ONLY: ExportContentSelection = { test: true, answerKey: false }
const KEY_ONLY: ExportContentSelection = { test: false, answerKey: true }

/** The exam title as a filename may hold it — the same rule whatever the file
 *  turns out to be called. */
export function sanitizeExamTitle(title: string): string {
  const safe = title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
  return safe || 'Untitled exam'
}

/** How a set of export-local labels names itself: `A` alone, or `A-D` for a
 *  range. One rule, so the filename and the package's own description cannot
 *  describe the same export differently. */
export function versionRange(labels: readonly string[]): string {
  const first = labels[0] ?? 'A'
  const last = labels[labels.length - 1] ?? first
  return labels.length > 1 ? `${first}-${last}` : first
}

/** `{exam-title}-version-A.docx` for one Version, `{exam-title}-versions-A-D`
 *  for a set: the artifact says which papers it holds without being opened. */
export function docxFilename(title: string, labels: readonly string[]): string {
  const range = labels.length > 1
    ? `versions-${versionRange(labels)}`
    : `version-${versionRange(labels)}`
  return `${sanitizeExamTitle(title)}-${range}.docx`
}

/**
 * The whole preparation interface, in one pure call.
 *
 * Refuses a count it cannot honour rather than quietly producing fewer papers
 * than the dialog promised: the UI keeps an impossible count visible and
 * disables Export, and this is the same rule at the seam behind it.
 */
export function prepareExport({
  exam,
  version,
  configuration,
  random,
  measure,
  onProgress,
}: PreparationRequest): PreparedExport {
  const { format, selection, versionCount, randomization } = configuration
  if (!selection.test && !selection.answerKey) {
    throw new Error('An export must include the student test, the answer key, or both.')
  }
  const maximum = maxDistinctVersions(exam, version, randomization)
  if (versionCount < 1 || !Number.isInteger(versionCount)) {
    throw new Error('An export needs at least one version.')
  }
  if (versionCount > maximum) {
    throw new Error(
      `This exam can produce ${maximum} distinct version${maximum === 1 ? '' : 's'} `
      + `with the selected randomization, not ${versionCount}.`,
    )
  }

  const versions = generateVersions(
    exam,
    version,
    versionCount,
    randomization,
    random,
    (index) =>
      onProgress?.({ stage: 'versions', completed: index + 1, total: versionCount }),
  )
  const labels = versions.map((generated) => generated.letter)

  // Tests before keys, so answer material stays behind every paper being
  // handed out — and one plan per standalone document, which is what restarts
  // page numbering at one for each of them.
  const streams: { stream: PageStream; selection: ExportContentSelection }[] = [
    ...(selection.test ? [{ stream: 'test' as const, selection: TEST_ONLY }] : []),
    ...(selection.answerKey ? [{ stream: 'answer-key' as const, selection: KEY_ONLY }] : []),
  ]
  const total = streams.length * versions.length
  const documents: PreparedDocument[] = []
  for (const { stream, selection: streamSelection } of streams) {
    for (const generated of versions) {
      documents.push({
        label: generated.letter,
        stream,
        plan: planExport({
          exam,
          version: generated,
          selection: streamSelection,
          measure,
        }),
      })
      onProgress?.({ stage: 'planning', completed: documents.length, total })
    }
  }

  return {
    format,
    labels,
    documents,
    filename: docxFilename(exam.title, labels),
  }
}

/** The prepared plans alone, in published order — what an Export Adapter takes. */
export function plansOf(prepared: PreparedExport): LayoutPlan[] {
  return prepared.documents.map((document) => document.plan)
}
