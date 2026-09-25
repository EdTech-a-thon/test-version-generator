// Export planning: one Export Document, one Layout Plan.
//
// This is the single module that decides what an exam arrangement *says* and how it
// *falls onto pages*. Both Export Adapters — the React/HTML print path and the
// DOCX writer — consume the Layout Plan it returns. Neither walks an `Exam`
// itself, so a content or pagination rule is implemented and fixed once.
//
// The interface callers and tests use is `planExport`: an exam, one arrangement,
// the requested content selection and a `Measure` in; a complete `LayoutPlan`
// out. The two stages behind it are internal:
//
//   1. Semantic derivation into an `ExportDocument` — sections, continuous
//      question numbering, this arrangement's choice order and the letters it
//      earns, choice-grid topology, the answer key.
//   2. Layout resolution into a `LayoutPlan` — page assignment, page furniture,
//      footer numbering, and the explicit break decisions a serializer needs.
//
// Measurement is injected rather than taken from the DOM, so the whole pipeline
// is testable without a browser: nothing here reads a layout property itself,
// it asks `Measure` for one. Export Adapters never measure and never repaginate.
//
// Packing is atomic by default: a question that fits stays whole, and one that
// does not fit moves to the next page whole. Only a question that alone exceeds
// a full content box is ever split, and then only at the boundaries between its
// top-level stem blocks — never through a choice grid or a matching set, and
// never leaving a bare question number at the foot of a page.

import {
  columnsOf,
  orderedChoices,
  orderedPartChoices,
  partsOf,
  promptsOf,
  questionsInSection,
  sectionsOf,
  takesWorkSpace,
  topicsOf,
  WORK_SPACE_LINE_PITCH,
  workSpaceOf,
  type Difficulty,
  type Exam,
  type Question,
  type QuestionType,
  type Arrangement,
  type PartType,
  type WorkSpace,
  type WorkSpaceStyle,
} from './exam'
import { stemNodesOf, type ProseMirrorJSON } from './question-doc'
import { headerLineOf, type ExamHeader, type HeaderLine } from './page-header'

// The default section wording lives with the rest of what an Exam may say
// about its sections; re-exported for the adapters and tests that print it.
export { SECTION_INSTRUCTIONS, SECTION_TITLE } from './section-headings'
import {
  DEFAULT_HEADING_SIZE,
  DEFAULT_TEXT_SIZE,
  SECTION_INSTRUCTIONS,
  SECTION_TITLE,
  type HeadingSize,
  type TextSize,
} from './section-headings'

// How many columns a choice grid is drawn in — the same set a question's
// `columns` setting comes from, named here because the plan is what the
// renderers read.
export type ColumnCount = 1 | 2 | 4

// Everything the render needs to know about how big things come out. The app
// supplies a DOM-backed implementation; tests supply stubs.
export type Measure = {
  /** Height in px of one page item, laid out at the content box's width and
   *  at the Exam's text size. */
  itemHeight(item: PageItem, textSize?: TextSize): number
}

// A stub that reports nothing: every item is zero-height, so an exam packs onto
// one page. Tests that are not about geometry inject this; the app injects
// `domMeasure`.
export const unmeasured: Measure = {
  itemHeight: () => 0,
}

// A choice as it prints: its letter is its position in this arrangement's ordering,
// so it is what the student writes on their paper and what the answer key
// records.
export type PlannedChoice = {
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
  cells: (PlannedChoice | null)[][]
}

// One item of a matching set as it prints: its own number on the test, the
// letter of the Word Bank answer it matches under this arrangement's bank
// order — `null` when the teacher has not matched it — and the node to render.
export type PlannedPrompt = {
  id: string
  number: number
  letter: string | null
  node: ProseMirrorJSON
}

// A Word Bank answer as it prints: its letter is its position in this
// arrangement's ordering, which is what a student writes in a prompt's blank
// and what the answer key records for that prompt.
export type PlannedBankAnswer = {
  id: string
  letter: string
  node: ProseMirrorJSON
}

// A long Word Bank laid out in columns above the items, column-major like a
// choice grid: reading a column top to bottom gives consecutive letters.
// `cells[row][column]` is `null` where the last column runs out of answers.
export type BankGrid = {
  columns: number
  rows: number
  cells: (PlannedBankAnswer | null)[][]
}

// A matching set as it prints. A bank on a different page from its prompts is
// no use to a student, so a set too long for one page breaks only between its
// prompts, and every piece prints the whole bank. A short bank prints beside the numbered prompts, in a column of its own to
// their right; a long one prints above them in `bankGrid`, as the source tests
// lay it out once it no longer fits down the side.
export type MatchingSet = {
  prompts: PlannedPrompt[]
  /** The Word Bank in this arrangement's order, lettered. */
  bank: PlannedBankAnswer[]
  /** The bank in columns, when it prints above the prompts; `null` when it
   *  prints beside them. */
  bankGrid: BankGrid | null
}

/** The longest Word Bank that prints beside its items. Past this, the bank
 *  moves above them into `MATCHING_BANK_COLUMNS` columns. */
export const MATCHING_BESIDE_LIMIT = 5
export const MATCHING_BANK_COLUMNS = 2

// The room a Short Answer piece leaves below itself, resolved onto a page.
// `height` is final: for a space that fills the rest of its page, packing has
// already grown it to reach the foot of that page, so an adapter draws exactly
// this much and never measures. `lines` is how many ruled lines fit in it —
// none for a blank space — counted here so every adapter rules the same number.
export type PlannedWorkSpace = {
  height: number
  style: WorkSpaceStyle
  lines: number
  fill: boolean
}

/** Room a filled work space leaves at the foot of its page, so fractional
 *  measurement can never round it onto another sheet. */
const WORK_SPACE_FILL_SLACK = 1

function plannedWorkSpace(space: WorkSpace, height = space.height): PlannedWorkSpace {
  return {
    height,
    style: space.style,
    lines: space.style === 'lines' ? Math.floor(height / WORK_SPACE_LINE_PITCH) : 0,
    fill: space.fill,
  }
}

// One Part of a Multipart question as it prints: lettered `a`, `b`, … in authored order
// beneath the Multipart question's one number, with its own stem and — for a Multiple
// Choice Part — its answers in this arrangement's order and the grid they lay
// out in, or — for a Short Answer Part — the room it leaves for work. A Part
// prints the way a question of its kind does, one level in.
export type PlannedPart = {
  id: string
  /** Its position under the Multipart question: `a`, `b`, …. */
  letter: string
  type: PartType
  stem: ProseMirrorJSON[]
  /** The answers in this arrangement's order, lettered `A`, `B`, …; empty for
   *  a Short Answer Part. */
  choices: PlannedChoice[]
  grid: ChoiceGrid | null
  /** The room a Short Answer Part leaves for work, resolved as a question's is
   *  — zero-height when it leaves none, so the sheet can offer a handle to
   *  drag some open. `null` for a Multiple Choice Part. */
  workSpace: PlannedWorkSpace | null
  /** A Short Answer Part's Suggested Answer, for the Answer Key only. */
  suggestedAnswer?: ProseMirrorJSON[]
}

export type PlannedQuestion = {
  id: string
  type: QuestionType
  /** Position on the printed test, counted continuously across sections. A
   *  matching set's number is its first prompt's: its prompts take the run of
   *  numbers from there, one each, and the set's stem prints unnumbered. */
  number: number
  /** What a student circles in the number column, before the number: T and F
   *  on a True/False question, and nothing on any other. A Multiple Choice
   *  question's letter is circled on its answer, so it prints no mark here. */
  marks: readonly string[]
  /** The question document's top-level blocks, without the choice list. */
  stem: ProseMirrorJSON[]
  /** The answers in this arrangement's order, lettered. Empty for short answer
   *  and for a matching set, whose Word Bank is in `matching`. A True/False
   *  question carries its pair here — lettered `T` and `F`, which is what the
   *  Answer Key reports — even though the test prints only its `marks`. */
  choices: PlannedChoice[]
  /** How those answers lay out, or `null` when the test does not print them —
   *  a short answer question has none, and a True/False question's pair is
   *  stated by the section's directions instead. */
  grid: ChoiceGrid | null
  /** The prompts and Word Bank of a matching set; `null` for every other
   *  Question Type. */
  matching: MatchingSet | null
  /** The room this Exam leaves below a Short Answer question for a student's
   *  work, as the teacher set it; `null` for every other Question Type. A
   *  Short Answer question with no room still carries one, zero-height, so
   *  the sheet can offer a handle to drag some open. */
  workSpace: WorkSpace | null
  /** Optional organizational metadata, retained so the Answer Key can help a
   *  teacher identify and review the Questions without exposing it to students. */
  difficulty?: Difficulty
  topics?: string[]
  /** A Short Answer question's Suggested Answer, as top-level blocks. Never
   *  printed on the test; the Answer Key prints it under the question's line. */
  suggestedAnswer?: ProseMirrorJSON[]
  /** A Multipart question's Parts, lettered, in authored order; `null` for every other
   *  Question Type. A Multipart question's `stem` is the shared material its Parts are asked about. */
  parts: PlannedPart[] | null
}

/** How many numbers a question takes on the test: one, or one per prompt for
 *  a matching set. What continuous numbering advances by. */
export function numbersTakenBy(question: PlannedQuestion): number {
  return question.matching ? question.matching.prompts.length : 1
}

/** The question's number as a teacher would say it — `22`, or `22–25` for a
 *  matching set whose prompts run over several. */
export function numberLabelOf(question: PlannedQuestion): string {
  const span = numbersTakenBy(question)
  return span > 1
    ? `${question.number}–${question.number + span - 1}`
    : String(question.number)
}

export type SectionHeadingItem = {
  kind: 'section-heading'
  /** Which of the Exam's Sections this heads. */
  sectionId: string
  /** That Section's Question Type — what its default wording is for. */
  section: QuestionType
  title: string
  instructions: string
  /** A heading is never left at the foot of a page without its first question.
   *  Packing enforces it; adapters carry it into their own keep-with-next. */
  keepWithNext: true
  /** The Exam's heading size, present only when it is not `'normal'` — so an
   *  Exam that never chose one plans exactly as it always did. */
  size?: HeadingSize
  /** A Section with no questions, planned only for the exam sheet, where it is
   *  a place to put some. Exported output never carries one. */
  empty?: true
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
  question: PlannedQuestion
  /** The top-level stem blocks this piece prints, in order. */
  stem: ProseMirrorJSON[]
  /** Whether this piece is the question's first: the one that prints the
   *  number line and answer blank (see `printsNumberLine`) and carries its
   *  editing handles. Never alone: it always carries stem, grid or set with it. */
  numbered: boolean
  /** The choice grid, on the single piece that prints it. Never split. */
  grid: ChoiceGrid | null
  /** The matching set: this piece's run of prompts, with the whole Word Bank
   *  on every piece of a set split across pages. */
  matching: MatchingSet | null
  /** A Short Answer question's work space, on its last piece — so the room
   *  for an answer always follows the whole question. `null` on every other
   *  piece and for every other Question Type. */
  workSpace: PlannedWorkSpace | null
  /** The Parts of a Multipart question this piece prints, whole; `null` for every other
   *  Question Type. A Multipart question breaks only between its Parts, or — when the
   *  stem and its first Part cannot share a page — between its stem's blocks. */
  parts: PlannedPart[] | null
}

/** Whether this piece prints the question's number line: the first piece of
 *  any question but a matching set, whose numbers print on its prompts. */
export function printsNumberLine(item: QuestionItem): boolean {
  return item.numbered && item.question.matching === null
}

// The answer key's own content items. The repeated title lives in the page's
// furniture (see `PageHeader`'s `'answer-key'` variant) rather than packing
// as an item — it is drawn the same way the test's own title is, on every
// key page, since the key carries only one header variant. What does pack is
// the "Answer Section" heading, one grouping heading per section that holds a
// question, and one line per question.
export type AnswerKeyHeadingItem = { kind: 'answer-key-heading' }

export type AnswerKeySectionItem = {
  kind: 'answer-key-section'
  sectionId: string
  section: QuestionType
  title: string
}

// One line of the key: a question's number, its organizational metadata and,
// for multiple choice, the correct letter under this arrangement's ordering.
// `letter` is `null` for a free-response question — the key still gives it a
// blank so the numbering lines up with the test — and a Short Answer question
// with a Suggested Answer prints that answer on the lines below its blank.
export type AnswerKeyEntryItem = {
  kind: 'answer-key-entry'
  number: number
  letter: string | null
  difficulty?: Difficulty
  topics?: string[]
  suggestedAnswer?: ProseMirrorJSON[]
  /** A Multipart question's one line per Part, under its one number. */
  parts?: AnswerKeyPartLine[]
}

/** What the Answer Key records for one Part: the correct letter for a
 *  Multiple Choice Part (`null` when none is marked), or the Suggested Answer
 *  for a Short Answer Part. */
export type AnswerKeyPartLine = {
  letter: string
  answer: string | null
  suggestedAnswer?: ProseMirrorJSON[]
}

// One thing that occupies vertical space on a page, in print order.
export type PageItem =
  | SectionHeadingItem
  | QuestionItem
  | AnswerKeyHeadingItem
  | AnswerKeySectionItem
  | AnswerKeyEntryItem

// Which furniture a page carries. The first page takes the Name/Class/Date
// line and the title; later pages take a Name blank alone; the answer key —
// begun fresh after the last test page, footer restarted at 1 — takes the
// arrangement ID alone plus the repeated title, and carries no Name line at all.
export type PageHeader = 'first' | 'later' | 'answer-key' | 'answer-key-later'

export function isAnswerKeyHeader(header: PageHeader): boolean {
  return header === 'answer-key' || header === 'answer-key-later'
}

// Which document stream a page belongs to. The answer key begins fresh after
// the last test page with its own restarted footer, so a plan can carry both.
export type PageStream = 'test' | 'answer-key'

// One planned sheet. Everything an Export Adapter needs to reproduce it without
// measuring or repaginating: which furniture it carries, what number its footer
// prints, the ordered items on it, and whether an explicit page break precedes
// it in a serialized stream.
export type PlannedPage = {
  /** Printed in the footer, 1-based within its stream. */
  number: number
  header: PageHeader
  stream: PageStream
  /** What this page's header and footer say. Furniture is a planning decision,
   *  so the two adapters print the same identity fields and the same footer
   *  number rather than each deciding what a header variant means. */
  furniture: PageFurniture
  /** True for every page but the first of a serialized document: a DOCX or any
   *  other linear format must break here rather than rediscover pagination. */
  breakBefore: boolean
  items: PageItem[]
}

/** The blanks a page's header offers the student, in printed order. */
export type IdentityField = 'Name' | 'Class' | 'Date'

export type PageFurniture = {
  identityFields: readonly IdentityField[]
  /** What this test page's header line prints beside the ID: the Exam's own
   *  words, or the default blanks written as text. Absent on answer-key pages,
   *  and on plans recorded before a header could be reworded, which print
   *  `identityFields` as they always did. Empty means the ID alone. */
  identityLine?: string
  /** The exam title, on the pages that repeat it; `null` on the rest. */
  title: string | null
  /** The heading size the title prints at, when the Exam chose one other than
   *  normal. The heading size sets every heading, the title included. */
  titleSize?: HeadingSize
  /** Which Version's paper this is — printed on every page, both streams, and
   *  empty for the Working Copy's own arrangement. Plans recorded before
   *  Versions existed carry the `ID: A` they printed. */
  arrangementLabel: string
  /** What the footer prints. The same number as the page, named separately
   *  because a footer is furniture rather than an item that packs. */
  pageNumber: number
}

const IDENTITY_FIELDS: Record<PageHeader, readonly IdentityField[]> = {
  first: ['Name', 'Class', 'Date'],
  later: ['Name'],
  // The key is the teacher's copy: it carries the arrangement it belongs to and
  // nothing for a student to fill in.
  'answer-key': [],
  'answer-key-later': [],
}

// Which variants repeat the exam title. The key repeats it on its first page
// the way the test does, and drops it on continuation pages.
const REPEATS_TITLE: Record<PageHeader, boolean> = {
  first: true,
  later: false,
  'answer-key': true,
  'answer-key-later': false,
}

// Which of an Exam's header lines a test page prints. The key has none.
const HEADER_LINE: Record<PageHeader, HeaderLine | null> = {
  first: 'first',
  later: 'later',
  'answer-key': null,
  'answer-key-later': null,
}

function furnitureOf(
  page: { header: PageHeader; number: number },
  title: string,
  version: string | undefined,
  header: ExamHeader | undefined,
  titleSize: HeadingSize | undefined,
): PageFurniture {
  const line = HEADER_LINE[page.header]
  const identityLine = line ? headerLineOf(header, line) : undefined
  return {
    identityFields: IDENTITY_FIELDS[page.header],
    ...(identityLine !== undefined ? { identityLine } : {}),
    title: REPEATS_TITLE[page.header] ? title : null,
    ...(REPEATS_TITLE[page.header] && titleSize ? { titleSize } : {}),
    arrangementLabel: version ?? '',
    pageNumber: page.number,
  }
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
export const PAGE_MARGIN = 72

/** The width a page item is laid out at — what `Measure` measures against. */
export const PAGE_CONTENT_WIDTH = PAGE_WIDTH - 2 * PAGE_MARGIN

const PAGE_BOX_HEIGHT = PAGE_HEIGHT - 2 * PAGE_MARGIN

// Exhaustive over `PageHeader` on purpose: a new variant cannot be added
// without deciding how tall its furniture is. The answer key's header carries
// The first answer-key page repeats the title; continuation pages carry only
// the ID and therefore use the shorter header height.
export const HEADER_HEIGHT: Record<PageHeader, number> = {
  first: 84,
  later: 42,
  'answer-key': 84,
  'answer-key-later': 42,
}

export const FOOTER_HEIGHT = 36

/** How much vertical space packing may fill on a page carrying `header`. */
export function pageContentHeight(header: PageHeader): number {
  return PAGE_BOX_HEIGHT - HEADER_HEIGHT[header] - FOOTER_HEIGHT
}

/** The most room a teacher can drag a work space to: a whole later page less
 *  an inch for the question itself, so a question and its space still fit on
 *  one sheet. Filling the rest of a page is the way to ask for more. */
export const MAX_WORK_SPACE_HEIGHT =
  Math.floor((pageContentHeight('later') - 96) / WORK_SPACE_LINE_PITCH) * WORK_SPACE_LINE_PITCH

// A question's body does not span the page's full content width: it renders
// inside `.question-body`, the second column of `.exam-question`'s grid in
// styles.css (`grid-template-columns: 34px 1fr; gap: 6px;`) — the number
// column sits to its left. These numbers are copied from that rule because
// CSS can't be read from here at build time; if that rule's column width or
// gap ever changes, this must change with it.
//
// The column holds the number alone, and is as wide as a three-digit number:
// no question prints an answer blank beside its number. A True/False question
// also prints the T and F a student circles, so its column is wider —
// `.question-number--marks` in styles.css.
const QUESTION_NUMBER_COLUMN_WIDTH = 34
const MARKS_QUESTION_NUMBER_COLUMN_WIDTH = 64
const QUESTION_NUMBER_COLUMN_GAP = 6

/** Where a question's body starts, in pixels from the content edge: past the
 *  number column and its gap. Every adapter indents a question by this. */
export function questionIndentOf(question: Pick<PlannedQuestion, 'type'>): number {
  return (
    (hasMarks(question.type)
      ? MARKS_QUESTION_NUMBER_COLUMN_WIDTH
      : QUESTION_NUMBER_COLUMN_WIDTH) + QUESTION_NUMBER_COLUMN_GAP
  )
}

/** Whether a question's number column carries marks a student circles before
 *  its number: only True/False, whose answer is one of two fixed letters. */
export function hasMarks(type: QuestionType): boolean {
  return type === 'true-false'
}

/** The letters a True/False question's student circles, in the order they print. */
export const TRUE_FALSE_MARKS: readonly string[] = ['T', 'F']

// A matching set's prompts keep their own column: a blank for the letter a
// student writes, then the number (`.matching-prompt` in styles.css,
// `grid-template-columns: 92px 1fr; gap: 6px;`). A long Word Bank prints above
// the prompts, set in by the same step.
const MATCHING_NUMBER_COLUMN_WIDTH = 92

/** Where a matching prompt's body starts, and how far a long Word Bank is set in. */
export const MATCHING_INDENT = MATCHING_NUMBER_COLUMN_WIDTH + QUESTION_NUMBER_COLUMN_GAP

/** The width a long Word Bank's grid is laid out in. */
export const MATCHING_AREA_WIDTH = PAGE_CONTENT_WIDTH - MATCHING_INDENT

/** Where a Part's body starts within its Multipart question's body: past its own letter
 *  column, which holds the letter alone. A Part prints no answer blank, of
 *  either kind — a Multiple Choice Part's answer is circled, not written in a
 *  margin — so every Part is set in by the same short step. */
export const PART_INDENT = QUESTION_NUMBER_COLUMN_WIDTH + QUESTION_NUMBER_COLUMN_GAP

/** The width a Multiple Choice Part's choice grid is laid out in: the page
 *  less its Multipart question's number column and its own letter column. */
export const PART_CHOICE_AREA_WIDTH = PAGE_CONTENT_WIDTH - 2 * PART_INDENT

/** The width a Multiple Choice question's choice grid is laid out in — derived from
 *  `PAGE_CONTENT_WIDTH` so the two numbers cannot drift apart on their own. */
export const CHOICE_AREA_WIDTH =
  PAGE_CONTENT_WIDTH - QUESTION_NUMBER_COLUMN_WIDTH - QUESTION_NUMBER_COLUMN_GAP

// A matching set spans the whole content width — its prompts carry their own
// number column — and gives its Word Bank this much of it, on the right. The
// print stylesheet's `.matching-bank` width is this number; the DOCX adapter
// reads it from here.
export const MATCHING_BANK_WIDTH = 240

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** What a student circles for a True/False question, by the position of the
 *  answer in the authored pair. A longer pair cannot happen — the editor fixes
 *  it at two — so anything past it falls back to a choice letter rather than
 *  printing nothing. */
const TRUE_FALSE_LETTERS = ['T', 'F']

/** The letter a Part prints under its Multipart question — 'a', 'b', … — told apart
 *  from a choice's capital letter at a glance. */
function partLetterAt(index: number): string {
  return letterAt(index).toLowerCase()
}

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

// Column-major: `rows = ceil(n / columns)`, and the items fill down the first
// column before starting the second.
function layOutColumns<T>(
  items: T[],
  columns: number,
): { rows: number; cells: (T | null)[][] } {
  const rows = Math.ceil(items.length / columns)
  const cells = Array.from({ length: rows }, (_unused, row) =>
    Array.from(
      { length: columns },
      (_empty, column) => items[column * rows + row] ?? null,
    ),
  )
  return { rows, cells }
}

function layOutGrid(
  choices: PlannedChoice[],
  columns: ColumnCount,
): ChoiceGrid | null {
  if (choices.length === 0) return null
  return { columns, ...layOutColumns(choices, columns) }
}

// A matching set under this arrangement: the Word Bank in the arrangement's
// order, lettered by position, and each prompt numbered from `number` on and
// given the letter its answer now carries. A prompt that names no answer, or
// one the bank no longer holds, is unmatched and gets no letter.
function deriveMatching(
  question: Question,
  arrangement: Arrangement,
  number: number,
): MatchingSet {
  const bank: PlannedBankAnswer[] = orderedChoices(question, arrangement).map(
    (answer, index) => ({ id: answer.id, letter: letterAt(index), node: answer.node }),
  )
  const letters = new Map(bank.map((answer) => [answer.id, answer.letter]))
  return {
    prompts: promptsOf(question).map((prompt, index) => ({
      id: prompt.id,
      number: number + index,
      letter: letters.get(prompt.answerId) ?? null,
      node: prompt.node,
    })),
    bank,
    bankGrid:
      bank.length > MATCHING_BESIDE_LIMIT
        ? { columns: MATCHING_BANK_COLUMNS, ...layOutColumns(bank, MATCHING_BANK_COLUMNS) }
        : null,
  }
}

/** A question's Suggested Answer as top-level blocks, copied; none when it has
 *  no answer or the answer holds only blank paragraphs. */
function suggestedAnswerOf(question: Question): ProseMirrorJSON[] {
  const content = question.suggestedAnswer?.content
  if (!Array.isArray(content)) return []
  const blocks = content as ProseMirrorJSON[]
  const blank = (node: ProseMirrorJSON) =>
    node.type === 'paragraph' && !(Array.isArray(node.content) && node.content.length > 0)
  return blocks.every(blank) ? [] : structuredClone(blocks)
}

function blankBlocks(blocks: readonly ProseMirrorJSON[]): boolean {
  return blocks.every(
    (node) =>
      node.type === 'paragraph' && !(Array.isArray(node.content) && node.content.length > 0),
  )
}

// A Multipart question's Parts under this arrangement: each lettered by position, each
// Multiple Choice Part's answers in the order recorded under its own id, and
// each Short Answer Part's work space as this Exam sets it for that Part.
function deriveParts(
  exam: Exam,
  question: Question,
  arrangement: Arrangement,
): PlannedPart[] {
  return partsOf(question).map((part, index) => {
    const choices: PlannedChoice[] = orderedPartChoices(part, arrangement).map(
      (choice, choiceIndex) => ({
        id: choice.id,
        letter: letterAt(choiceIndex),
        correct: choice.correct,
        node: choice.node,
      }),
    )
    const multipleChoice = part.type === 'multiple-choice'
    const suggested = part.suggestedAnswer?.content
    const suggestedBlocks = Array.isArray(suggested) ? (suggested as ProseMirrorJSON[]) : []
    return {
      id: part.id,
      letter: partLetterAt(index),
      type: part.type,
      stem: part.stem,
      choices,
      grid: multipleChoice ? layOutGrid(choices, part.columns) : null,
      workSpace: multipleChoice ? null : plannedWorkSpace(workSpaceOf(exam, part.id)),
      ...(!multipleChoice && suggestedBlocks.length > 0 && !blankBlocks(suggestedBlocks)
        ? { suggestedAnswer: structuredClone(suggestedBlocks) }
        : {}),
    }
  })
}

function deriveQuestion(
  exam: Exam,
  question: Question,
  arrangement: Arrangement,
  number: number,
): PlannedQuestion {
  const trueFalse = question.type === 'true-false'
  const matching = question.type === 'matching'
  const multipart = question.type === 'multipart'
  const ordered = matching || multipart ? [] : orderedChoices(question, arrangement)
  const choices: PlannedChoice[] = ordered.map((choice, index) => ({
    id: choice.id,
    // A True/False answer is written the way the student circles it, so the
    // Answer Key reads T or F rather than A or B.
    letter: trueFalse ? TRUE_FALSE_LETTERS[index] ?? letterAt(index) : letterAt(index),
    correct: choice.correct,
    node: choice.node,
  }))
  return {
    id: question.id,
    type: question.type,
    number,
    marks: trueFalse ? TRUE_FALSE_MARKS : [],
    stem: stemNodesOf(question.doc),
    choices,
    // A True/False question never prints its pair as lettered answers: its
    // marks are the T and F a student circles beside its number.
    grid: trueFalse || matching || multipart ? null : layOutGrid(choices, columnsOf(question)),
    matching: matching ? deriveMatching(question, arrangement, number) : null,
    workSpace: takesWorkSpace(question.type) ? workSpaceOf(exam, question.id) : null,
    ...(question.difficulty ? { difficulty: question.difficulty } : {}),
    ...(topicsOf(question).length > 0 ? { topics: [...topicsOf(question)] } : {}),
    ...(question.type === 'open' && suggestedAnswerOf(question).length > 0
      ? { suggestedAnswer: suggestedAnswerOf(question) }
      : {}),
    parts: multipart ? deriveParts(exam, question, arrangement) : null,
  }
}

// The Exam's Sections in their own order. A Section with no questions is
// omitted entirely from exported output — heading, directions and all — and is
// planned only for the exam sheet, which asks for it, as somewhere to put
// questions.
function deriveItems(
  exam: Exam,
  arrangement: Arrangement,
  emptySections = false,
): PageItem[] {
  const items: PageItem[] = []
  let number = 1
  for (const section of sectionsOf(exam)) {
    const questions = questionsInSection(exam, arrangement, section.id)
    if (questions.length > 0 || emptySections) {
      // A part the teacher cleared is an empty string: it prints nothing, and
      // a heading cleared of both still holds its place in the plan — at no
      // height — so the sheet can offer to bring it back.
      items.push({
        kind: 'section-heading',
        sectionId: section.id,
        section: section.type,
        title: section.title ?? SECTION_TITLE[section.type],
        instructions: section.instructions ?? SECTION_INSTRUCTIONS[section.type],
        keepWithNext: true,
        ...(questions.length === 0 ? { empty: true as const } : {}),
        ...(exam.headingSize && exam.headingSize !== DEFAULT_HEADING_SIZE
          ? { size: exam.headingSize }
          : {}),
      })
    }
    for (const question of questions) {
      const planned = deriveQuestion(exam, question, arrangement, number)
      items.push(wholeQuestion(planned))
      number += numbersTakenBy(planned)
    }
  }
  return items
}

/** The question, whole, as one page item — packing's starting point. */
function wholeQuestion(question: PlannedQuestion): QuestionItem {
  return {
    kind: 'question',
    question,
    stem: question.stem,
    numbered: true,
    grid: question.grid,
    matching: question.matching,
    workSpace: question.workSpace ? plannedWorkSpace(question.workSpace) : null,
    parts: question.parts,
  }
}

// The indivisible segments a question may be broken between: its number line
// glued to the first stem block, so a split can never strand a bare number at
// the foot of a page; then one segment per remaining top-level block; then the
// choice grid whole, since a grid is never split. A question with no stem at
// all is a single segment, so it moves rather than coming apart. A matching set
// and a Multipart question have segments of their own (see `matchingSegmentsOf` and
// `multipartSegmentsOf`).
type Segment = {
  stem: ProseMirrorJSON[]
  numbered: boolean
  grid: ChoiceGrid | null
  matching: MatchingSet | null
  workSpace: PlannedWorkSpace | null
  /** A Multipart question's Parts carried by this segment, whole. */
  parts: PlannedPart[]
}

// A work space is glued to the last segment rather than being one of its own:
// room for an answer at the top of a page, with its question at the foot of
// the one before, is room nobody would think to use.
function segmentsOf(question: PlannedQuestion, measure: Measure, fullPage: number): Segment[] {
  const workSpace = question.workSpace ? plannedWorkSpace(question.workSpace) : null
  if (question.matching) return matchingSegmentsOf(question, question.matching, workSpace)
  if (question.parts) return multipartSegmentsOf(question, question.parts, measure, fullPage)
  const [first, ...rest] = question.stem
  if (first === undefined) {
    return [
      {
        stem: question.stem,
        numbered: true,
        grid: question.grid,
        matching: null,
        workSpace,
        parts: [],
      },
    ]
  }
  const segments: Segment[] = [
    { stem: [first], numbered: true, grid: null, matching: null, workSpace: null, parts: [] },
  ]
  for (const block of rest) {
    segments.push({
      stem: [block], numbered: false, grid: null, matching: null, workSpace: null, parts: [],
    })
  }
  if (question.grid) {
    segments.push({
      stem: [], numbered: false, grid: question.grid, matching: null, workSpace: null, parts: [],
    })
  }
  segments[segments.length - 1]!.workSpace = workSpace
  return segments
}

// A Multipart question breaks only between its Parts: its number and its stem
// glued to Part a, then one segment per Part after it, so a student never
// turns a page to find the first question about what they have just read.
// Only when the stem and Part a together are taller than a whole page does the
// stem itself come apart between its blocks, as any oversized stem does —
// there is then no page that could hold them together.
function multipartSegmentsOf(
  question: PlannedQuestion,
  parts: readonly PlannedPart[],
  measure: Measure,
  fullPage: number,
): Segment[] {
  const partSegment = (part: PlannedPart): Segment => ({
    stem: [], numbered: false, grid: null, matching: null, workSpace: null, parts: [part],
  })
  const [firstPart, ...laterParts] = parts
  const lead: Segment = {
    stem: question.stem,
    numbered: true,
    grid: null,
    matching: null,
    workSpace: null,
    parts: firstPart ? [firstPart] : [],
  }
  if (measure.itemHeight(pieceOf(question, [lead])) <= fullPage || question.stem.length < 2) {
    return [lead, ...laterParts.map(partSegment)]
  }
  const [first, ...rest] = question.stem
  return [
    { stem: [first!], numbered: true, grid: null, matching: null, workSpace: null, parts: [] },
    ...rest.map((block): Segment => ({
      stem: [block], numbered: false, grid: null, matching: null, workSpace: null, parts: [],
    })),
    ...parts.map(partSegment),
  ]
}

/** Whether a Part short of a Multipart question's last fills the rest of its page. The
 *  Parts after it cannot then share that page, so the Multipart question cannot move
 *  whole and has to be broken up after it. */
function fillsBeforeItsEnd(question: PlannedQuestion): boolean {
  return (question.parts ?? []).slice(0, -1).some((part) => part.workSpace?.fill === true)
}

// A matching set breaks only between its items: the directions glued to the
// first, then one part per item after it. Each part carries the whole Word
// Bank, so a set too long for one page continues on the next with its bank
// printed again beside (or above) the items that page holds — items on a page
// with no answers to match them against would be no matching set at all.
function matchingSegmentsOf(
  question: PlannedQuestion,
  set: MatchingSet,
  workSpace: PlannedWorkSpace | null,
): Segment[] {
  const withPrompts = (prompts: PlannedPrompt[]): MatchingSet => ({ ...set, prompts })
  if (set.prompts.length === 0) {
    return [{
      stem: question.stem, numbered: true, grid: question.grid, matching: set, workSpace, parts: [],
    }]
  }
  const segments = set.prompts.map((prompt, index): Segment => ({
    stem: index === 0 ? question.stem : [],
    numbered: index === 0,
    grid: index === 0 ? question.grid : null,
    matching: withPrompts([prompt]),
    workSpace: null,
    parts: [],
  }))
  segments[segments.length - 1]!.workSpace = workSpace
  return segments
}

/** Consecutive segments, gathered back into the one item that prints them. */
function pieceOf(
  question: PlannedQuestion,
  segments: readonly Segment[],
): QuestionItem {
  const sets = segments.flatMap((segment) => (segment.matching ? [segment.matching] : []))
  return {
    kind: 'question',
    question,
    stem: segments.flatMap((segment) => segment.stem),
    numbered: segments.some((segment) => segment.numbered),
    grid: segments.find((segment) => segment.grid !== null)?.grid ?? null,
    // A matching set's segments each hold some of its items and all of its bank.
    matching:
      sets.length === 0 ? null : { ...sets[0]!, prompts: sets.flatMap((set) => set.prompts) },
    workSpace: segments.find((segment) => segment.workSpace !== null)?.workSpace ?? null,
    parts: question.parts ? segments.flatMap((segment) => segment.parts) : null,
  }
}

/** The work space that fills the rest of the page this piece lands on, if
 *  any: a Short Answer question's own, or — for a Multipart question — its last Part's,
 *  since a piece of a Multipart question ends at any Part that fills. */
function fillingSpaceOf(item: QuestionItem): PlannedWorkSpace | null {
  if (item.workSpace?.fill) return item.workSpace
  const last = item.parts?.at(-1)
  return last?.workSpace?.fill ? last.workSpace : null
}

/** The piece with its filling work space grown to `height`. */
function withFillHeight(item: QuestionItem, height: number): QuestionItem {
  const grow = (space: PlannedWorkSpace): PlannedWorkSpace => ({
    ...space,
    height,
    lines: space.style === 'lines' ? Math.floor(height / WORK_SPACE_LINE_PITCH) : 0,
  })
  if (item.workSpace?.fill) return { ...item, workSpace: grow(item.workSpace) }
  const parts = item.parts ?? []
  const last = parts.at(-1)
  if (!last?.workSpace) return item
  return { ...item, parts: [...parts.slice(0, -1), { ...last, workSpace: grow(last.workSpace) }] }
}

// Packing: fill a page until the next item does not fit, then start another.
//
// A question is atomic by default — it moves to the next page whole whenever it
// would fit there. Only a question that exceeds a full content box on its own is
// broken up, and then at the part boundaries above, as late as each page allows.
//
// `initialHeader` and `continuedHeader` are what makes this the same function
// for both the test (`'first'` then `'later'`) and the answer key (`'answer-key'`
// on every page it takes — the key carries only one header variant). Page
// numbers always start at 1 within one call, which is what gives the key its
// own restarted footer: it is simply a second, independent call.
// What packing produces: which items landed on which sheet, under which header
// variant. Furniture needs the document's title and arrangement, which packing has
// no business knowing, so `resolveLayout` is what turns these into
// `PlannedPage`s.
type PackedPage = Pick<PlannedPage, 'number' | 'header' | 'stream' | 'items'>

function paginate(
  items: PageItem[],
  measure: Measure,
  stream: PageStream,
  initialHeader: PageHeader,
  continuedHeader: PageHeader,
): PackedPage[] {
  const pages: PackedPage[] = []
  let header: PageHeader = initialHeader
  let box = pageContentHeight(header)
  let current: PageItem[] = []
  let used = 0
  // Set once a work space has taken the rest of this page: nothing else may
  // follow it here, whatever height the next item happens to measure at.
  let full = false

  const flush = () => {
    pages.push({ number: pages.length + 1, header, stream, items: current })
    current = []
    used = 0
    full = false
    header = continuedHeader
    box = pageContentHeight(header)
  }

  // A work space that fills its page is measured at its least height, which is
  // what decided that it fits here; placing it is what grows it to the foot of
  // the page. The growth is recorded on the item itself, so adapters draw the
  // grown height rather than rediscovering it.
  const place = (item: PageItem, height: number) => {
    let placed = item
    let placedHeight = height
    const space = item.kind === 'question' ? fillingSpaceOf(item) : null
    if (item.kind === 'question' && space) {
      const extra = Math.max(0, Math.floor(box - used - height - WORK_SPACE_FILL_SLACK))
      placed = withFillHeight(item, space.height + extra)
      placedHeight = height + extra
      full = true
    }
    current.push(placed)
    used += placedHeight
  }

  // Breaks one question across as many pages as it needs, each page taking as
  // many consecutive parts as still fit. A part taller than a whole page is
  // placed alone and overflows rather than looping forever — there is nothing
  // smaller to break it into. A section heading is kept with its first
  // question whatever that question does: when the first piece does not fit
  // under a heading that shares its page with earlier content, the heading
  // moves to the next page along with the piece rather than staying behind.
  // A heading alone on its page has nothing to move away from: the piece goes
  // on ahead of it only when a fresh page would actually hold it, and an
  // oversized piece overflows under the heading instead.
  const fullPage = pageContentHeight(continuedHeader)
  // A Part that fills its page ends the piece it is in: nothing may follow it
  // on that page.
  const endsPiece = (segment: Segment) =>
    segment.parts.at(-1)?.workSpace?.fill === true
  const split = (question: PlannedQuestion) => {
    const segments = segmentsOf(question, measure, fullPage)
    let start = 0
    while (start < segments.length) {
      if (full) flush()
      let end = start + 1
      let piece = pieceOf(question, segments.slice(start, end))
      let height = measure.itemHeight(piece)
      if (height > box - used && current.length > 0) {
        const last = current.at(-1)
        if (last?.kind !== 'section-heading') {
          flush()
          continue
        }
        if (current.length > 1) {
          current.pop()
          flush()
          place(last, measure.itemHeight(last))
        } else if (height <= pageContentHeight(continuedHeader)) {
          flush()
          continue
        }
      }
      while (end < segments.length && !endsPiece(segments[end - 1]!)) {
        const grown = pieceOf(question, segments.slice(start, end + 1))
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

  for (const [index, item] of items.entries()) {
    if (full) flush()
    const height = measure.itemHeight(item)
    // A section heading must share a page with at least the first indivisible
    // piece of its first question — the whole question, when it is one piece.
    // Reserve that space before committing the heading; otherwise a heading
    // can fit in the last few lines of a page after every question in its
    // section has moved forward.
    if (item.kind === 'section-heading') {
      const firstQuestion = items[index + 1]
      if (firstQuestion?.kind === 'question') {
        const [firstSegment] = segmentsOf(firstQuestion.question, measure, fullPage)
        const firstPieceHeight = firstSegment
          ? measure.itemHeight(pieceOf(firstQuestion.question, [firstSegment]))
          : 0
        if (current.length > 0 && height + firstPieceHeight > box - used) {
          flush()
        }
      }
    }
    // A Multipart question with a Part that fills its page before the last Part cannot
    // be placed whole: the Parts after the filling one go on the next page.
    if (item.kind === 'question' && fillsBeforeItsEnd(item.question)) {
      split(item.question)
      continue
    }
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
    const followsSectionHeading = current.at(-1)?.kind === 'section-heading'
    if (
      current.length > 0
      && !followsSectionHeading
      && height <= pageContentHeight(continuedHeader)
    ) {
      flush()
      place(item, height)
      continue
    }
    split(item.question)
  }
  flush()
  return pages
}

// Derive the key from the exact rendered questions that students see, so its
// numbering and arrangement-relative choice letters cannot drift from the test. A
// question that later splits across pages still contributes exactly one answer
// line — or, for a matching set, exactly one line per prompt, since each prompt
// is a number on the test — because the key is derived before layout and the
// id set guards repeats.
function deriveAnswerKey(testItems: readonly PageItem[]): PageItem[] {
  // The key groups its lines by the test's Sections, under the test's own
  // titles, as the Exam words them. A heading cleared from the test still
  // names its group here: the key is a teacher's reference, and a run of
  // answers with no label is not one. A Section with no questions has no
  // group.
  const items: PageItem[] = [{ kind: 'answer-key-heading' }]
  const seen = new Set<string>()
  let heading: SectionHeadingItem | null = null
  let grouped: string | null = null

  for (const item of testItems) {
    if (item.kind === 'section-heading') heading = item
    if (item.kind !== 'question' || seen.has(item.question.id)) continue
    seen.add(item.question.id)
    if (heading && heading.sectionId !== grouped) {
      grouped = heading.sectionId
      items.push({
        kind: 'answer-key-section',
        sectionId: heading.sectionId,
        section: heading.section,
        title: heading.title || SECTION_TITLE[heading.section],
      })
    }
    const metadata = {
      ...(item.question.difficulty ? { difficulty: item.question.difficulty } : {}),
      ...(item.question.topics?.length ? { topics: [...item.question.topics] } : {}),
    }
    if (item.question.parts) {
      items.push({
        kind: 'answer-key-entry',
        number: item.question.number,
        letter: null,
        ...metadata,
        parts: item.question.parts.map((part) => ({
          letter: part.letter,
          answer:
            part.type === 'multiple-choice'
              ? part.choices.find((choice) => choice.correct)?.letter ?? null
              : null,
          ...(part.suggestedAnswer ? { suggestedAnswer: part.suggestedAnswer } : {}),
        })),
      })
      continue
    }
    if (item.question.matching) {
      for (const prompt of item.question.matching.prompts) {
        items.push({
          kind: 'answer-key-entry',
          number: prompt.number,
          letter: prompt.letter,
          ...metadata,
        })
      }
      continue
    }
    items.push({
      kind: 'answer-key-entry',
      number: item.question.number,
      letter: item.question.choices.find((choice) => choice.correct)?.letter ?? null,
      ...metadata,
      ...(item.question.suggestedAnswer
        ? { suggestedAnswer: item.question.suggestedAnswer }
        : {}),
    })
  }
  return items
}

// ---------------------------------------------------------------------------
// Stage 1: the Export Document
//
// Format-neutral content and presentation intent for one exam arrangement: what the
// paper says, in what order, under which numbers and letters — and nothing at
// all about pages. Both streams are always derived; the selection decides which
// of them the Layout Plan goes on to lay out.

/** Which of an exam arrangement's documents an export covers. */
export type ExportContentSelection = {
  test: boolean
  answerKey: boolean
}

/** The selection DOCX export uses: the student's paper, without the key. */
export const STUDENT_TEST: ExportContentSelection = { test: true, answerKey: false }

/** Which paper a plan is. `version` is the shuffled Version's name, present
 *  only when the export shuffled; it is what the page's label prints. */
export type PlannedArrangement = { id: string; letter: string; version?: string }

export type ExportDocument = {
  title: string
  arrangement: PlannedArrangement
  selection: ExportContentSelection
  /** The student test's content items, in order, before page assignment. */
  test: PageItem[]
  /** The answer key's content items, in order, before page assignment. */
  answerKey: PageItem[]
  /** The Exam's own header lines, where it has reworded them. */
  header?: ExamHeader
  /** The Exam's heading size, where not normal: the title's size. */
  headingSize?: HeadingSize
  /** The Exam's text size, where not normal. */
  textSize?: TextSize
}

/** Semantic derivation, on its own. Exposed so tests and fingerprints can read
 *  the semantic stage: it is page-free, and takes no `Measure` at all. */
export function buildExportDocument(
  exam: Exam,
  arrangement: Arrangement,
  selection: ExportContentSelection,
  version?: string,
  emptySections = false,
): ExportDocument {
  const test = deriveItems(exam, arrangement, emptySections)
  return {
    title: exam.title,
    arrangement: {
      id: arrangement.id,
      letter: arrangement.letter,
      ...(version !== undefined ? { version } : {}),
    },
    selection,
    test,
    answerKey: deriveAnswerKey(test),
    ...(exam.header ? { header: exam.header } : {}),
    ...(exam.headingSize && exam.headingSize !== DEFAULT_HEADING_SIZE
      ? { headingSize: exam.headingSize }
      : {}),
    ...(exam.textSize && exam.textSize !== DEFAULT_TEXT_SIZE ? { textSize: exam.textSize } : {}),
  }
}

// ---------------------------------------------------------------------------
// Stage 2: the Layout Plan
//
// The Export Document resolved onto real sheets. Self-contained on purpose: an
// adapter that has a plan needs neither the exam, the arrangement, nor a `Measure`.

export type PageSize = {
  /** CSS pixels at 96dpi — US Letter, the geometry both outputs are cut to. */
  width: number
  height: number
  margin: number
  contentWidth: number
}

export const US_LETTER: PageSize = {
  width: PAGE_WIDTH,
  height: PAGE_HEIGHT,
  margin: PAGE_MARGIN,
  contentWidth: PAGE_CONTENT_WIDTH,
}

export type LayoutPlan = {
  title: string
  arrangement: PlannedArrangement
  selection: ExportContentSelection
  pageSize: PageSize
  /** How large the pages' content prints, when not normal. Every adapter sets
   *  its body type from this; it is what the items were measured at. */
  textSize?: TextSize
  pages: PlannedPage[]
}

export type PlanRequest = {
  exam: Exam
  arrangement: Arrangement
  selection: ExportContentSelection
  measure: Measure
  /** The shuffled Version this paper is, named on every page; absent for the
   *  Working Copy's own arrangement, which prints no label. */
  version?: string
  /** Plan empty Sections too, as the exam sheet does, where each is a place to
   *  put questions. Never set for anything exported. */
  emptySections?: boolean
}

/** Layout resolution, on its own: an Export Document onto sheets. Keeping the
 *  two `paginate` calls independent is what restarts the answer key's footer. */
function resolveLayout(
  document: ExportDocument,
  measure: Measure,
): LayoutPlan {
  const { textSize } = document
  const sized: Measure = textSize
    ? { itemHeight: (item) => measure.itemHeight(item, textSize) }
    : measure
  const pages: PackedPage[] = []
  if (document.selection.test) {
    pages.push(...paginate(document.test, sized, 'test', 'first', 'later'))
  }
  if (document.selection.answerKey) {
    pages.push(
      ...paginate(
        document.answerKey,
        sized,
        'answer-key',
        'answer-key',
        'answer-key-later',
      ),
    )
  }
  return {
    title: document.title,
    arrangement: document.arrangement,
    selection: document.selection,
    pageSize: US_LETTER,
    ...(textSize ? { textSize } : {}),
    // Every page but the first of the serialized document is preceded by an
    // explicit break. A linear format must reproduce the plan's pagination
    // rather than rediscover one of its own.
    pages: pages.map((page, index) => ({
      ...page,
      furniture: furnitureOf(
        page,
        document.title,
        document.arrangement.version,
        document.header,
        document.headingSize,
      ),
      breakBefore: index > 0,
    })),
  }
}

/**
 * The whole planning interface, in one pure call: an exam, the arrangement to
 * export, which of its documents to include, and how to measure. Nothing here
 * reads the DOM, a clock, or a random source.
 */
export function planExport({
  exam,
  arrangement,
  selection,
  measure,
  version,
  emptySections,
}: PlanRequest): LayoutPlan {
  return resolveLayout(
    buildExportDocument(exam, arrangement, selection, version, emptySections),
    measure,
  )
}
