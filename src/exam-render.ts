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
// What is deliberately not here yet: the page content box is unbounded, so
// everything lands on one page — a single point in this file rather than an
// assumption spread through it, see `PAGE_CONTENT_HEIGHT`. Column resolution
// (`resolveColumns`) is real: it picks the widest of 4, 2, 1 columns whose
// longest choice fits without wrapping, using the injected `Measure`.

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

// A stub that reports nothing. Enough while the page is unbounded and columns
// are fixed; the app replaces it with real measurement once pagination and
// automatic columns need it.
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

export type QuestionItem = {
  kind: 'question'
  question: RenderedQuestion
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

// Page geometry: US Letter at 96dpi with 1" margins on every side (per the
// spec, 816×1056px). The content box is 624px wide. Height is unbounded for
// now, so packing produces a single page — #7's job to bound. Width is real
// today: it is what a choice's column is measured against under `'auto'`.
const PAGE_CONTENT_WIDTH = 816 - 2 * 96
const PAGE_CONTENT_HEIGHT = Number.POSITIVE_INFINITY

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
      items.push({
        kind: 'question',
        question: renderQuestion(question, version, number, measure),
      })
      number += 1
    }
    items.push({ kind: 'add-question', section })
  }
  return items
}

// Packing: fill a page until the next item does not fit, then start another.
// With an unbounded content box that is one page — the shape #7 grows into.
function paginate(items: PageItem[], measure: Measure): Page[] {
  const pages: Page[] = []
  let current: PageItem[] = []
  let used = 0

  const flush = () => {
    pages.push({
      number: pages.length + 1,
      header: pages.length === 0 ? 'first' : 'later',
      items: current,
    })
    current = []
    used = 0
  }

  for (const item of items) {
    const height = measure.itemHeight(item)
    if (current.length > 0 && used + height > PAGE_CONTENT_HEIGHT) flush()
    current.push(item)
    used += height
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
