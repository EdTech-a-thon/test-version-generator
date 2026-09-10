// Pure preparation for one Export Record event.
//
// The Working Copy is resolved into the selected Layout Plans exactly once.
// Those plans are the self-contained historical presentation: later viewing
// and re-export never consult canonical Questions or run the layout engine.

import type { Exam, Arrangement } from './exam'
import {
  planExport,
  type ExportContentSelection,
  type LayoutPlan,
  type Measure,
} from './export-plan'
import { imageSourcesOf } from './export-media'

export type ExportFormat = 'pdf' | 'docx'

export type ExportConfiguration = {
  format: ExportFormat
  selection: ExportContentSelection
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

function selectedPlans(
  test: LayoutPlan,
  answerKey: LayoutPlan,
  selection: ExportContentSelection,
): LayoutPlan[] {
  return [
    ...(selection.test ? [test] : []),
    ...(selection.answerKey ? [answerKey] : []),
  ]
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

/** Select a historical artifact without current authoring or layout input. */
export function prepareHistoricalExport({
  record,
  createdAt,
  createId = () => crypto.randomUUID(),
}: {
  record: ExportRecord
  createdAt: string
  createId?: () => string
}): PreparedExport {
  const copied = historicalRecord(record, createdAt, createId)
  return {
    documents: copied.plans,
    filename: exportFilename(copied.capturedName, copied.format),
    record: copied,
  }
}

/** Resolve the visible Working Copy into one immutable export event. */
export function prepareExport({
  examId,
  exam,
  arrangement,
  configuration,
  measure,
  createdAt,
  createId = () => crypto.randomUUID(),
  onProgress,
}: PreparationRequest): PreparedExport {
  if (exam.questions.length === 0) {
    throw new Error('Add at least one question to the Exam before exporting.')
  }
  if (!configuration.selection.test && !configuration.selection.answerKey) {
    throw new Error('Choose the student test, the answer key, or both.')
  }

  const test = planExport({ exam, arrangement, selection: TEST_ONLY, measure })
  onProgress?.({ stage: 'planning', completed: 1, total: 2 })
  const answerKey = planExport({ exam, arrangement, selection: KEY_ONLY, measure })
  onProgress?.({ stage: 'planning', completed: 2, total: 2 })
  const documents = selectedPlans(test, answerKey, configuration.selection)
  onProgress?.({ stage: 'resolving', completed: 1, total: 1 })

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
