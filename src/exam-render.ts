// The exam page, rendered.
//
// One pure function turns the canonical exam plus a version's ordering into
// pages: it derives the sections, numbers the questions continuously across
// them, assigns each choice the letter its position on this paper earns, lays
// the choices out column-major, and packs the result into pages.
//
// Measurement is injected rather than taken from the DOM, so the whole pipeline
// is testable without a browser: the render function never touches a layout
// property itself, it asks `Measure` for one.
//
// Packing is atomic by default: a question that fits stays whole, and one that
// does not fit moves to the next page whole. Only a question that alone exceeds
// a full content box is ever split, and then only at the boundaries between its
// top-level stem blocks — never through a choice grid, and never leaving a bare
// question number at the foot of a page.

import {
  SECTION_ORDER,
  orderedChoices,
  questionsInSection,
  type Choice,
  type Exam,
  type Question,
  type QuestionType,
  type Version,
} from './exam'
import { multipleChoiceNodeOf, type ProseMirrorJSON } from './question-doc'

// The section headings and instruction lines a school test carries. Hardcoded
// per section kind, never stored, never editable. The `'open'` question type
// prints under "Short Answer".
export const SECTION_TITLE: Record<QuestionType, string> = {
  'multiple-choice': 'Multiple Choice',
  open: 'Short Answer',
}

export const SECTION_INSTRUCTIONS: Record<QuestionType, string> = {
  'multiple-choice':
    'Identify the choice that best completes the statement or answers the question.',
  open: 'Answer the following questions in the space provided. Show all work.',
}

// How many columns a choice grid is actually drawn in, once `'auto'` has been
// resolved.
export type ColumnCount = 1 | 2 | 4

// Everything the render needs to know about how big things come out. The app
// supplies a DOM-backed implementation; tests supply stubs.
export type Measure = {
  /**
   * Width in px the choice needs to sit on one unwrapped line. Consulted only
   * when a question's `columns` is `'auto'`.
   */
  choiceWidth(choice: Choice): number
  /** Height in px of one page item, laid out at the content box's width. */
  itemHeight(item: PageItem): number
}

// A stub that reports nothing: every item is zero-height and every choice
// zero-width, so an exam packs onto one page and `'auto'` resolves to the
// widest column count. Tests that are not about geometry inject this; the app
// injects `domMeasure`.
export const unmeasured: Measure = {
  choiceWidth: () => 0,
  itemHeight: () => 0,
}

// A choice as it prints: its letter is its position in this version's ordering,
// so it is what the student writes on their paper and what the answer key
// records.
export type RenderedChoice = {
  id: string
  letter: string
  correct: boolean
  node: ProseMirrorJSON
}

// The choice grid, row by row. `cells[row][column]` is `null` where the last
// column runs out of choices. Filled column-major: reading a column top to
// bottom gives consecutive letters.
export type ChoiceGrid = {
  columns: ColumnCount
  rows: number
  cells: (RenderedChoice | null)[][]
}

export type RenderedQuestion = {
  id: string
  type: QuestionType
  /** Position on the printed test, counted continuously across sections. */
  number: number
  /** Multiple-choice questions print a blank for the student's letter. */
  answerBlank: boolean
  /** The question document's top-level blocks, without the choice list. */
  stem: ProseMirrorJSON[]
  /** The answers in this version's order, lettered. Empty for short answer. */
  choices: RenderedChoice[]
  /** How those answers lay out, or `null` when there are none. */
  grid: ChoiceGrid | null
}

export type SectionHeadingItem = {
  kind: 'section-heading'
  section: QuestionType
  title: string
  instructions: string
}

// A question, or as much of one as this page has room for.
//
// The common case is one item carrying the whole question: `stem` is the
// question's own stem, `numbered` is true, and `grid` is the question's own
// grid. A question too tall for any page comes out as consecutive pieces of the
// same `question` instead — the first carrying the number line, the last
// carrying the grid, and each carrying a run of top-level stem blocks. Views
// draw the item, never the question behind it, so a split needs no special case
// on screen or on paper.
export type QuestionItem = {
  kind: 'question'
  /** The whole question, for identity, numbering, selection and the answer key. */
  question: RenderedQuestion
  /** The top-level stem blocks this piece prints, in order. */
  stem: ProseMirrorJSON[]
  /** Whether this piece prints the number line and answer blank. Only the first
   *  piece does, and never alone: it always carries stem or grid with it. */
  numbered: boolean
  /** The choice grid, on the single piece that prints it. Never split. */
  grid: ChoiceGrid | null
}

// Closes a section: adding from here makes a question of that section's type,
// so the teacher never picks a type from a menu.
export type AddQuestionItem = {
  kind: 'add-question'
  section: QuestionType
}

// One thing that occupies vertical space on a page, in print order.
export type PageItem = SectionHeadingItem | QuestionItem | AddQuestionItem

// Which furniture a page carries. The first page takes the Name/Class/Date
// line and the title; later pages take a Name blank alone.
export type PageHeader = 'first' | 'later'

export type Page = {
  /** Printed in the footer, 1-based. */
  number: number
  header: PageHeader
  items: PageItem[]
}

// ---------------------------------------------------------------------------
// Page geometry
//
// US Letter at 96dpi: an 816×1056px sheet with 1" (96px) margins on every side,
// leaving a 624×864px box. The header and footer come out of that box's height,
// so how much packing may fill depends on which header the page carries — the
// first page's Name/Class/Date line plus the title is taller than a later
// page's Name line alone.
//
// These are the numbers the screen uses as well: `exam-page.tsx` publishes them
// as CSS custom properties so the rendered page is laid out at exactly the size
// packed against, and the print `@page` is the same sheet. A mismatch here is
// what makes content creep onto an extra sheet on paper.
export const PAGE_WIDTH = 816
export const PAGE_HEIGHT = 1056
export const PAGE_MARGIN = 96

/** The width a page item is laid out at — what `Measure` measures against. */
export const PAGE_CONTENT_WIDTH = PAGE_WIDTH - 2 * PAGE_MARGIN

const PAGE_BOX_HEIGHT = PAGE_HEIGHT - 2 * PAGE_MARGIN

// Exhaustive over `PageHeader` on purpose: a new variant cannot be added
// without deciding how tall its furniture is.
export const HEADER_HEIGHT: Record<PageHeader, number> = { first: 84, later: 30 }

export const FOOTER_HEIGHT = 36

/** How much vertical space packing may fill on a page carrying `header`. */
export function pageContentHeight(header: PageHeader): number {
  return PAGE_BOX_HEIGHT - HEADER_HEIGHT[header] - FOOTER_HEIGHT
}

// Auto tries these, widest first, and settles on the first whose column a
// choice fits without wrapping.
const AUTO_CANDIDATES: readonly ColumnCount[] = [4, 2, 1]

function columnWidth(columns: ColumnCount): number {
  return PAGE_CONTENT_WIDTH / columns
}

// True when `node` or anything nested inside it is an image, inline or
// block. A question with an image in any choice measures as unboundedly
// wide — this is an explicit rule, not a width the injected `Measure` has to
// know to inflate, so it holds even for a stub that reports 0 everywhere.
function hasImage(node: ProseMirrorJSON): boolean {
  if (node.type === 'image' || node.type === 'image-block') return true
  return Array.isArray(node.content)
    ? (node.content as ProseMirrorJSON[]).some(hasImage)
    : false
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** The letter of the choice at `index` — 'A', 'B', … then 'AA', 'AB', …. */
function letterAt(index: number): string {
  let letter = ''
  let remaining = index
  do {
    letter = LETTERS[remaining % 26]! + letter
    remaining = Math.floor(remaining / 26) - 1
  } while (remaining >= 0)
  return letter
}

// The single place a question's column count is decided. An explicit setting
// wins permanently — including surviving a later content edit, since this
// reads the stored setting and nothing else when it isn't `'auto'`. Under
// `'auto'`, an image in any choice forces 1 column outright; otherwise the
// widest of 4, 2, 1 whose longest choice fits its column without wrapping is
// chosen, using the injected `Measure`.
function resolveColumns(
  question: Question,
  choices: readonly Choice[],
  measure: Measure,
): ColumnCount {
  if (question.columns !== 'auto') return question.columns
  if (choices.some((choice) => hasImage(choice.node))) return 1
  const widest = choices.reduce(
    (max, choice) => Math.max(max, measure.choiceWidth(choice)),
    0,
  )
  return AUTO_CANDIDATES.find((columns) => widest <= columnWidth(columns)) ?? 1
}

// Column-major: `rows = ceil(n / columns)`, and the choices fill down the first
// column before starting the second.
function layOutGrid(
  choices: RenderedChoice[],
  columns: ColumnCount,
): ChoiceGrid | null {
  if (choices.length === 0) return null
  const rows = Math.ceil(choices.length / columns)
  const cells = Array.from({ length: rows }, (_unused, row) =>
    Array.from(
      { length: columns },
      (_empty, column) => choices[column * rows + row] ?? null,
    ),
  )
  return { columns, rows, cells }
}

/** The question's blocks with the choice list taken out. */
function stemOf(question: Question): ProseMirrorJSON[] {
  const blocks = Array.isArray(question.doc.content)
    ? (question.doc.content as ProseMirrorJSON[])
    : []
  const choiceList = multipleChoiceNodeOf(question.doc)
  return blocks.filter((block) => block !== choiceList)
}

function renderQuestion(
  question: Question,
  version: Version,
  number: number,
  measure: Measure,
): RenderedQuestion {
  const ordered = orderedChoices(question, version)
  const choices: RenderedChoice[] = ordered.map((choice, index) => ({
    id: choice.id,
    letter: letterAt(index),
    correct: choice.correct,
    node: choice.node,
  }))
  return {
    id: question.id,
    type: question.type,
    number,
    answerBlank: question.type === 'multiple-choice',
    stem: stemOf(question),
    choices,
    grid: layOutGrid(choices, resolveColumns(question, ordered, measure)),
  }
}

// Sections in fixed order, each omitted entirely when it holds no questions —
// except that an exam with no questions at all still offers both ways in.
function renderItems(exam: Exam, version: Version, measure: Measure): PageItem[] {
  const items: PageItem[] = []
  const empty = exam.questions.length === 0
  let number = 1
  for (const section of SECTION_ORDER) {
    const questions = questionsInSection(exam, version, section)
    if (questions.length === 0 && !empty) continue
    if (questions.length > 0) {
      items.push({
        kind: 'section-heading',
        section,
        title: SECTION_TITLE[section],
        instructions: SECTION_INSTRUCTIONS[section],
      })
    }
    for (const question of questions) {
      items.push(wholeQuestion(renderQuestion(question, version, number, measure)))
      number += 1
    }
    items.push({ kind: 'add-question', section })
  }
  return items
}

/** The question, whole, as one page item — packing's starting point. */
function wholeQuestion(question: RenderedQuestion): QuestionItem {
  return {
    kind: 'question',
    question,
    stem: question.stem,
    numbered: true,
    grid: question.grid,
  }
}

// The indivisible parts a question may be broken between: its number line glued
// to the first stem block, so a split can never strand a bare number at the foot
// of a page; then one part per remaining top-level block; then the choice grid
// whole, since a grid is never split. A question with no stem at all is a single
// part, so it moves rather than coming apart.
type QuestionPart = {
  stem: ProseMirrorJSON[]
  numbered: boolean
  grid: ChoiceGrid | null
}

function partsOf(question: RenderedQuestion): QuestionPart[] {
  const [first, ...rest] = question.stem
  if (first === undefined) {
    return [{ stem: [], numbered: true, grid: question.grid }]
  }
  const parts: QuestionPart[] = [{ stem: [first], numbered: true, grid: null }]
  for (const block of rest) parts.push({ stem: [block], numbered: false, grid: null })
  if (question.grid) parts.push({ stem: [], numbered: false, grid: question.grid })
  return parts
}

/** Consecutive parts, gathered back into the one item that prints them. */
function pieceOf(
  question: RenderedQuestion,
  parts: readonly QuestionPart[],
): QuestionItem {
  return {
    kind: 'question',
    question,
    stem: parts.flatMap((part) => part.stem),
    numbered: parts.some((part) => part.numbered),
    grid: parts.find((part) => part.grid !== null)?.grid ?? null,
  }
}

// Packing: fill a page until the next item does not fit, then start another.
//
// A question is atomic by default — it moves to the next page whole whenever it
// would fit there. Only a question that exceeds a full content box on its own is
// broken up, and then at the part boundaries above, as late as each page allows.
function paginate(items: PageItem[], measure: Measure): Page[] {
  const pages: Page[] = []
  let header: PageHeader = 'first'
  let box = pageContentHeight(header)
  let current: PageItem[] = []
  let used = 0

  const flush = () => {
    pages.push({ number: pages.length + 1, header, items: current })
    current = []
    used = 0
    header = 'later'
    box = pageContentHeight(header)
  }

  const place = (item: PageItem, height: number) => {
    current.push(item)
    used += height
  }

  // Breaks one question across as many pages as it needs, each page taking as
  // many consecutive parts as still fit. A part taller than a whole page is
  // placed alone and overflows rather than looping forever — there is nothing
  // smaller to break it into.
  const split = (question: RenderedQuestion) => {
    const parts = partsOf(question)
    let start = 0
    while (start < parts.length) {
      let end = start + 1
      let piece = pieceOf(question, parts.slice(start, end))
      let height = measure.itemHeight(piece)
      if (height > box - used && current.length > 0) {
        flush()
        continue
      }
      while (end < parts.length) {
        const grown = pieceOf(question, parts.slice(start, end + 1))
        const grownHeight = measure.itemHeight(grown)
        if (grownHeight > box - used) break
        piece = grown
        height = grownHeight
        end += 1
      }
      place(piece, height)
      start = end
    }
  }

  for (const item of items) {
    const height = measure.itemHeight(item)
    if (height <= box - used) {
      place(item, height)
      continue
    }
    if (item.kind !== 'question') {
      if (current.length > 0) flush()
      place(item, height)
      continue
    }
    // It does not fit here. Move it forward whole if a page of its own would
    // hold it; otherwise it is genuinely oversized, and splitting starts in
    // whatever room is left rather than wasting the rest of this page.
    if (current.length > 0 && height <= pageContentHeight('later')) {
      flush()
      place(item, height)
      continue
    }
    split(item.question)
  }
  flush()
  return pages
}

// The whole render, in one pure call: the exam, the ordering to print it in,
// and how to measure. Nothing here reads the DOM, a clock, or a random source.
export function renderExam(
  exam: Exam,
  version: Version,
  measure: Measure,
): Page[] {
  return paginate(renderItems(exam, version, measure), measure)
}
