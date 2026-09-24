// What an Exam prints at the top of its test pages.
//
// By default every test page carries Test Parrot's own header: Name, Class and
// Date blanks on the first page and a Name blank on later ones, with the paper's
// ID on each. An Exam may replace it with its own — rich text, tables and images,
// typed where it prints — and give its first page a different header from the
// rest, the way a word processor does. That header is this Exam's presentation,
// like its section wording (ADR-0026).
//
// An Exam that has never edited its header stores nothing and prints exactly
// what it always has. The first edit starts from the default, written out as the
// same content a teacher could have typed: a borderless table of blanks with the
// ID in its last cell.
//
// The ID is the one live value a header can hold: an inline `exam_id` node that
// prints the paper's ID ("ID: A"). It is resolved here, before any adapter sees
// the header, so print, PDF and DOCX draw plain text and never need to know it.

import type { ProseMirrorJSON } from './question-doc'

/** An inline atom that prints the paper's ID. */
export const EXAM_ID_NODE = 'exam_id'

/** An Exam's own header. `later` is on every test page after the first, and on
 *  the first as well unless `differentFirstPage` gives it `first`. Either may
 *  be empty: a header that says nothing takes no room. */
export type ExamHeader = {
  differentFirstPage: boolean
  first: ProseMirrorJSON[]
  later: ProseMirrorJSON[]
}

/** Which of an Exam's headers a teacher is editing. */
export type HeaderSlot = 'first' | 'later'

/** The most room a header may take, as a share of the page's content box. A
 *  header past it is clipped to it, and the editor says so. */
export const MAX_HEADER_SHARE = 0.25

const text = (value: string): ProseMirrorJSON => ({ type: 'text', text: value })
const paragraph = (...content: ProseMirrorJSON[]): ProseMirrorJSON =>
  ({ type: 'paragraph', content })
// The editor's tables always open with a heading row, so the default's one
// row is one; a borderless table prints it as an ordinary row.
const cell = (...content: ProseMirrorJSON[]): ProseMirrorJSON =>
  ({ type: 'table_header', content: [paragraph(...content)] })
const blank = (label: string) => cell(text(`${label}: ____________`))
const idCell = () => cell({ type: EXAM_ID_NODE })

/** A header table prints without borders unless the teacher turns them on:
 *  a table in a header is almost always layout — blanks spread across the
 *  line — rather than data. `borders` is the header editor's own attribute. */
export const TABLE_BORDERS_ATTR = 'borders'

/** A row of cells with no borders: layout, not data. */
function layoutTable(...cells: ProseMirrorJSON[]): ProseMirrorJSON {
  return {
    type: 'table',
    content: [{ type: 'table_header_row', content: cells }],
  }
}

/** The default header, written out as content — where a teacher's first edit
 *  starts from. */
export function defaultExamHeader(): ExamHeader {
  return {
    differentFirstPage: true,
    first: [layoutTable(blank('Name'), blank('Class'), blank('Date'), idCell())],
    later: [layoutTable(blank('Name'), idCell())],
  }
}

/** The content a page in `slot` prints. */
export function headerContentOf(header: ExamHeader, slot: HeaderSlot): ProseMirrorJSON[] {
  return slot === 'first' && header.differentFirstPage ? header.first : header.later
}

const isNode = (value: unknown): value is ProseMirrorJSON =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && typeof (value as { type?: unknown }).type === 'string'

/** Whether a stored value is a header this build can print. */
export function isExamHeader(value: unknown): value is ExamHeader {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const header = value as ExamHeader
  return (
    typeof header.differentFirstPage === 'boolean'
    && Array.isArray(header.first) && header.first.every(isNode)
    && Array.isArray(header.later) && header.later.every(isNode)
  )
}

/** Whether two headers print the same thing. Absent and default agree only
 *  when both are absent: a header written out as the default is still the
 *  teacher's own. */
export function sameExamHeader(left: ExamHeader | undefined, right: ExamHeader | undefined): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return JSON.stringify(left) === JSON.stringify(right)
}

/** Whether content prints nothing at all. */
export function isEmptyContent(blocks: readonly ProseMirrorJSON[]): boolean {
  const visible = (node: ProseMirrorJSON): boolean => {
    if (node.type === 'text') return typeof node.text === 'string' && node.text.trim() !== ''
    if (node.type === 'paragraph' || node.type === 'heading') {
      return ((node.content ?? []) as ProseMirrorJSON[]).some(visible)
    }
    if (node.type === 'hardbreak') return false
    return true
  }
  return !blocks.some(visible)
}

/**
 * Header content as it prints on one paper: every ID node replaced by the
 * paper's ID, and every table the teacher has not given borders marked
 * `borderless` — the one table attribute the adapters read — with its first row
 * made an ordinary row: the editor always gives a table a heading row, but a
 * table used for layout has no column headings, and its first row prints like
 * the rest.
 */
export function resolveHeaderContent(
  blocks: readonly ProseMirrorJSON[],
  arrangementLabel: string,
): ProseMirrorJSON[] {
  const resolve = (node: ProseMirrorJSON, layout: boolean): ProseMirrorJSON => {
    if (node.type === EXAM_ID_NODE) return { type: 'text', text: arrangementLabel }
    const attrs = (node.attrs ?? {}) as Record<string, unknown>
    const borderless = node.type === 'table' && attrs[TABLE_BORDERS_ATTR] !== true
    const inLayout = layout || borderless
    const type =
      inLayout && node.type === 'table_header_row' ? 'table_row'
        : inLayout && node.type === 'table_header' ? 'table_cell'
          : node.type
    return {
      ...node,
      type,
      ...(node.type === 'table' ? { attrs: { ...attrs, borderless } } : {}),
      ...(node.content
        ? { content: (node.content as ProseMirrorJSON[]).map((child) => resolve(child, inLayout)) }
        : {}),
    }
  }
  return blocks.map((block) => resolve(block, false))
}
