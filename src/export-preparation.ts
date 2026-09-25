// Pure preparation for one Export Record event.
//
// The Working Copy is resolved into the selected Layout Plans exactly once.
// Those plans are the self-contained historical presentation: later viewing
// and re-export never consult canonical Questions or run the layout engine.

import type { Exam, Arrangement, RandomSource } from './exam'
import {
  planExport,
  type ExportContentSelection,
  type LayoutPlan,
  type Measure,
} from './export-plan'
import { imageSourcesOf } from './export-media'
import {
  maxVersionCount,
  shuffledArrangements,
  shufflesAnything,
  versionNames,
  type ShuffleOptions,
} from './export-versions'

export type ExportFormat = 'pdf' | 'docx'

export type ExportConfiguration = {
  format: ExportFormat
  selection: ExportContentSelection
  /** What to shuffle into Versions. Absent, or nothing on, prints the
   *  Working Copy's own arrangement. */
  shuffle?: ShuffleOptions
  /** How many shuffled Versions to print; read only when shuffling. */
  versionCount?: number
}

export const DEFAULT_EXPORT_CONFIGURATION: ExportConfiguration = {
  format: 'pdf',
  selection: { test: true, answerKey: true },
}

const EXPORT_PREFERENCES_KEY = 'test-parrot-export-preferences-v1'

/** Export preferences are global UI settings, not authoring persistence. */
export function readExportPreferences(): ExportConfiguration {
  if (typeof localStorage === 'undefined') return DEFAULT_EXPORT_CONFIGURATION
  try {
    const value = JSON.parse(localStorage.getItem(EXPORT_PREFERENCES_KEY) ?? '') as Partial<ExportConfiguration>
    if (
      (value.format === 'pdf' || value.format === 'docx')
      && typeof value.selection?.test === 'boolean'
      && typeof value.selection.answerKey === 'boolean'
      && (value.selection.test || value.selection.answerKey)
    ) {
      return { format: value.format, selection: { ...value.selection } }
    }
  } catch {
    // Missing or malformed preferences fall back to the product defaults.
  }
  return DEFAULT_EXPORT_CONFIGURATION
}

export function writeExportPreferences(configuration: ExportConfiguration): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(EXPORT_PREFERENCES_KEY, JSON.stringify(configuration))
}

export type ShufflePreferences = { shuffle: ShuffleOptions; versionCount: number }

const DEFAULT_SHUFFLE_PREFERENCES: ShufflePreferences = {
  shuffle: { questions: false, answers: false },
  versionCount: 2,
}

const SHUFFLE_PREFERENCES_KEY = 'test-parrot-export-shuffle-v1'

function storedShufflePreferences(): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SHUFFLE_PREFERENCES_KEY) ?? '')
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** How an Exam was last shuffled for export. A UI preference kept per Exam,
 *  never authoring state: it neither dirties nor saves the Exam. */
export function readShufflePreferences(examId: string): ShufflePreferences {
  if (typeof localStorage === 'undefined') return DEFAULT_SHUFFLE_PREFERENCES
  const value = storedShufflePreferences()[examId] as Partial<ShufflePreferences> | undefined
  if (
    typeof value?.shuffle?.questions === 'boolean'
    && typeof value.shuffle.answers === 'boolean'
    && Number.isInteger(value.versionCount)
    && value.versionCount! >= 1
  ) {
    return {
      shuffle: { questions: value.shuffle.questions, answers: value.shuffle.answers },
      versionCount: value.versionCount!,
    }
  }
  return DEFAULT_SHUFFLE_PREFERENCES
}

export function writeShufflePreferences(examId: string, preferences: ShufflePreferences): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(
    SHUFFLE_PREFERENCES_KEY,
    JSON.stringify({ ...storedShufflePreferences(), [examId]: preferences }),
  )
}

export type ExportRecord = {
  id: string
  examId: string
  capturedName: string
  createdAt: string
  format: ExportFormat
  selection: ExportContentSelection
  questionCount: number
  plans: LayoutPlan[]
  mediaHashes: string[]
  sourceRecordId?: string
  /** The Test Parrot Package this export's PDF carries, serialized exactly as
   *  attached, so a re-export attaches the same bytes. Only a PDF including
   *  the answer key has one. It sits beside the plans, not in them: nothing
   *  about the pages depends on it. */
  examPackage?: string
  /** The names of the shuffled Versions this export printed, in order. Absent
   *  when it shuffled nothing, as on every record made before Versions
   *  existed. Each plan names its Version in `arrangement.version`. */
  versions?: string[]
}

export type ExportHistory = { records: ExportRecord[] }

export const EMPTY_EXPORT_HISTORY: ExportHistory = { records: [] }

export type PreparationProgress = {
  stage: 'planning' | 'resolving'
  completed: number
  total: number
}

export type PreparedExport = {
  documents: LayoutPlan[]
  filename: string
  record: ExportRecord
}

export type PreparationRequest = {
  examId: string
  exam: Exam
  arrangement: Arrangement
  configuration: ExportConfiguration
  history: ExportHistory
  measure: Measure
  createdAt: string
  createId?: () => string
  /** What shuffled Versions are drawn from. The same source reproduces the
   *  same Versions and names, which is how the Export Preview and the export
   *  it previews agree. */
  random?: RandomSource
  onProgress?: (progress: PreparationProgress) => void
}

const TEST_ONLY: ExportContentSelection = { test: true, answerKey: false }
const KEY_ONLY: ExportContentSelection = { test: false, answerKey: true }
const OWNED_MEDIA = /^\/local-images\/([a-f0-9]{64})$/

export function sanitizeExamTitle(title: string): string {
  const safe = title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
  return safe || 'Untitled Exam'
}

export function exportFilename(title: string, format: ExportFormat): string {
  return `${sanitizeExamTitle(title)}.${format}`
}

export function docxFilename(title: string): string {
  return exportFilename(title, 'docx')
}

export function pdfFilename(title: string): string {
  return exportFilename(title, 'pdf')
}

/** Kept for adapter fingerprint compatibility; this is not domain identity. */
export function arrangementRange(labels: readonly string[]): string {
  const first = labels[0] ?? ''
  const last = labels.at(-1) ?? first
  return labels.length > 1 ? `${first}-${last}` : first
}

function mediaHashesOf(plans: readonly LayoutPlan[]): string[] {
  return [...new Set(imageSourcesOf(plans).map((source) => {
    const hash = OWNED_MEDIA.exec(source)?.[1]
    if (!hash) {
      throw new Error(
        `Required media ${source} is not owned by this exam. Re-add the affected image and try again.`,
      )
    }
    return hash
  }))]
}

function historicalRecord(
  source: ExportRecord,
  createdAt: string,
  createId: () => string,
): ExportRecord {
  return {
    ...structuredClone(source),
    id: createId(),
    createdAt,
    sourceRecordId: source.id,
  }
}

/** A record narrowed to some of what it printed: only stored plans are kept,
 *  in their recorded order, and nothing is planned, shuffled or named. */
function narrowedRecord(
  record: ExportRecord,
  versions: readonly string[] | undefined,
  selection: ExportContentSelection | undefined,
): ExportRecord {
  const chosen = selection ?? record.selection
  if (chosen.test && !record.selection.test) {
    throw new Error('This export did not include the student test.')
  }
  if (chosen.answerKey && !record.selection.answerKey) {
    throw new Error('This export did not include the answer key.')
  }
  if (!chosen.test && !chosen.answerKey) {
    throw new Error('Choose the student test, the answer key, or both.')
  }
  const names = versions === undefined
    ? record.versions
    : (record.versions ?? []).filter((name) => versions.includes(name))
  if (versions !== undefined && names!.length === 0) {
    throw new Error('Choose at least one Version this export printed.')
  }
  const plans = record.plans.filter((plan) =>
    (plan.selection.answerKey ? chosen.answerKey : chosen.test)
    && (names === undefined || names.includes(plan.arrangement.version ?? '')))
  const { examPackage, ...rest } = record
  return {
    ...rest,
    selection: { ...chosen },
    plans,
    mediaHashes: mediaHashesOf(plans),
    ...(names !== undefined ? { versions: [...names] } : {}),
    // Only a PDF that includes the answer key carries the Exam for import.
    ...(examPackage !== undefined && chosen.answerKey ? { examPackage } : {}),
  }
}

/**
 * Select a historical artifact without current authoring or layout input:
 * all of it, or some of its Versions and documents. Either way it is a new
 * Export Record of stored plans, and never a new Version.
 */
export function prepareHistoricalExport({
  record,
  versions,
  selection,
  createdAt,
  createId = () => crypto.randomUUID(),
}: {
  record: ExportRecord
  /** The Versions to reprint; every one the record printed when absent. */
  versions?: readonly string[]
  /** What to reprint of each; the record's own Content Selection when absent. */
  selection?: ExportContentSelection
  createdAt: string
  createId?: () => string
}): PreparedExport {
  const source = versions === undefined && selection === undefined
    ? record
    : narrowedRecord(record, versions, selection)
  const copied = historicalRecord(source, createdAt, createId)
  return {
    documents: copied.plans,
    filename: exportFilename(copied.capturedName, copied.format),
    record: copied,
  }
}

/** Every Version name an Exam's Export History has already printed. */
function usedVersionNames(history: ExportHistory): Set<string> {
  return new Set(history.records.flatMap((record) => record.versions ?? []))
}

/** The papers one export prints: the Working Copy's own arrangement, unnamed,
 *  or — when it shuffles — only shuffled Versions, each newly named. */
function versionsToPrint({
  exam,
  arrangement,
  configuration,
  history,
  random,
  createId,
}: {
  exam: Exam
  arrangement: Arrangement
  configuration: ExportConfiguration
  history: ExportHistory
  random: RandomSource
  createId: () => string
}): { arrangement: Arrangement; name?: string }[] {
  const { shuffle } = configuration
  if (!shuffle || !shufflesAnything(shuffle)) return [{ arrangement }]
  const count = configuration.versionCount ?? 1
  const max = maxVersionCount(exam, arrangement, shuffle)
  if (max < 1) {
    throw new Error('Nothing on this Exam can be shuffled with these options.')
  }
  if (!Number.isInteger(count) || count < 1 || count > max) {
    throw new Error(
      `Choose from 1 to ${max} ${max === 1 ? 'Version' : 'Versions'} for this Exam.`,
    )
  }
  const arrangements = shuffledArrangements({ exam, arrangement, shuffle, count, random, createId })
  const names = versionNames(count, usedVersionNames(history), random)
  return arrangements.map((paper, index) => ({ arrangement: paper, name: names[index]! }))
}

/** Resolve the visible Working Copy into one immutable export event. */
export function prepareExport({
  examId,
  exam,
  arrangement,
  configuration,
  history,
  measure,
  createdAt,
  createId = () => crypto.randomUUID(),
  random = Math.random,
  onProgress,
}: PreparationRequest): PreparedExport {
  if (exam.questions.length === 0) {
    throw new Error('Add at least one question to the Exam before exporting.')
  }
  if (!configuration.selection.test && !configuration.selection.answerKey) {
    throw new Error('Choose the student test, the answer key, or both.')
  }

  const papers = versionsToPrint({ exam, arrangement, configuration, history, random, createId })
  const total = papers.length * 2
  let completed = 0
  const planned = papers.map(({ arrangement: paper, name }) => {
    const plan = (selection: ExportContentSelection) => {
      const result = planExport({
        exam,
        arrangement: paper,
        selection,
        measure,
        ...(name !== undefined ? { version: name } : {}),
      })
      onProgress?.({ stage: 'planning', completed: ++completed, total })
      return result
    }
    return { test: plan(TEST_ONLY), answerKey: plan(KEY_ONLY) }
  })
  // Every Version's test, then every Version's key: tests go out in stacks,
  // and the keys stay with the teacher.
  const documents = [
    ...(configuration.selection.test ? planned.map(({ test }) => test) : []),
    ...(configuration.selection.answerKey ? planned.map(({ answerKey }) => answerKey) : []),
  ]
  onProgress?.({ stage: 'resolving', completed: 1, total: 1 })
  const versions = papers.flatMap(({ name }) => (name !== undefined ? [name] : []))

  const record: ExportRecord = {
    id: createId(),
    examId,
    capturedName: exam.title,
    createdAt,
    format: configuration.format,
    selection: { ...configuration.selection },
    questionCount: exam.questions.length,
    plans: structuredClone(documents),
    mediaHashes: mediaHashesOf(documents),
    ...(versions.length > 0 ? { versions } : {}),
  }
  return {
    documents,
    filename: exportFilename(exam.title, configuration.format),
    record,
  }
}

export function plansOf(prepared: PreparedExport): LayoutPlan[] {
  return prepared.documents
}
