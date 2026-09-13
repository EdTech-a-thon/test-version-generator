import type { QuestionBankImportProposal } from './question-bank-import'

/**
 * Reading a file a teacher has handed over, wherever they handed it over: the
 * import dialog and the conversion page both take the same PDF or JSON and
 * ask the same question of it — is this a Question Bank yet?
 */

/** A JSON file carries the canonical record directly; a PDF carries it as an
 *  attachment. Nothing downstream can tell the two apart, because what is
 *  inspected, verified and imported is the same record either way. */
export function isRecordFile(file: File): boolean {
  return file.type === 'application/json' || /\.json$/i.test(file.name)
}

export async function inspectUploadedQuestionBank(file: File): Promise<QuestionBankImportProposal> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const importer = await import('./question-bank-import')
  if (isRecordFile(file)) return importer.inspectQuestionBankRecord(bytes)
  const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdf.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
    import.meta.url,
  ).href
  return importer.inspectQuestionBankFile(bytes)
}

/**
 * A file this app cannot read at all — a scan, a screenshot, a PDF that did
 * not come from here — is not a broken import, it is a test that has not been
 * converted yet. That failure is answered with the way to convert it rather
 * than with a reading of what went wrong.
 */
export function needsConversion(reason: unknown): boolean {
  const code = reason instanceof Error && 'code' in reason ? reason.code : null
  return code === 'invalid-pdf' || code === 'missing-attachment'
}
