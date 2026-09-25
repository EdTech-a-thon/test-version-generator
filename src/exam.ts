// The canonical exam model.
//
// There is exactly one copy of every question. An `Arrangement` holds an ordering
// and nothing else: which order the questions appear in, and which order each
// question's choices appear in. Fixing a typo therefore fixes it in every
// arrangement, and shuffling one arrangement never disturbs another.
//
// Orderings are tolerated rather than validated: a question or choice that the
// ordering has never heard of is appended to the end of its section, and an id
// in an ordering with nothing behind it is ignored. That is what keeps arrangements
// valid across content edits without a migration step.

import {
  choiceIdOf,
  choiceIsCorrect,
  choiceNodesOf,
  emptyDoc,
  matchingBankNodesOf,
  matchingPromptNodesOf,
  partAnswerNodeOf,
  partStemNodesOf,
  promptAnswerIdOf,
  multipartPartNodesOf,
  withFreshChoiceIds,
  type ProseMirrorJSON,
} from './question-doc'
import { newMultipleChoiceNode, newTrueFalseNode } from './multiple-choice'
import {
  SECTION_INSTRUCTIONS,
  SECTION_TITLE,
  type HeadingSize,
  type SectionHeadingChange,
  type SectionHeadings,
  type TextSize,
} from './section-headings'
import type { ExamHeader } from './page-header'
import { newMatchingNode } from './matching'
import { newMultipartPartsNode } from './multipart'

export type QuestionType =
  | 'multiple-choice'
  | 'true-false'
  | 'matching'
  | 'open'
  | 'multipart'

/** What a Part of a Multipart question can be: Multiple Choice, or Short Answer — the
 *  `'open'` type's internal name, as for a whole question. */
export type PartType = 'multiple-choice' | 'open'

/** Whether a question of this type answers with choices a teacher picks from.
 *  True/False answers with choices too — two fixed ones — so anything that
 *  cares about correctness living on a choice asks this rather than naming
 *  Multiple Choice and quietly leaving True/False out. A matching set is not
 *  one of these: its Word Bank answers are never correct on their own, only
 *  named by a prompt. */
export function hasChoices(type: QuestionType): boolean {
  return type === 'multiple-choice' || type === 'true-false'
}

/** Whether Vary may shuffle a question's answers. Multiple Choice answers
 *  reorder, and so does a matching set's Word Bank — each prompt's letter
 *  follows the answer it names, so the key changes while the matches do not.
 *  True/False is fixed, and a Short Answer question has nothing to shuffle. */
export function variesAnswers(type: QuestionType): boolean {
  return type === 'multiple-choice' || type === 'matching'
}

// How many columns a multiple-choice question's answers lay out in. A plain
// count, chosen by the teacher and never inferred: a layout that changed itself
// when an answer was edited was a layout nobody could rely on.
export type ColumnSetting = 1 | 2 | 4

/** What a question lays its answers out in when nothing else says otherwise.
 *  Two columns is what a printed test usually wants, and it is the count a
 *  question falls back to rather than a special value meaning "decide later". */
export const DEFAULT_COLUMNS: ColumnSetting = 2

/** How hard a question is. Optional everywhere: classification is a
 *  convenience, and an unclassified question is a complete one. */
export type Difficulty = 'easy' | 'medium' | 'hard'

/** The whole vocabulary, in the order a teacher reads it. There is no fourth
 *  value and no controlled Topic list to match it. */
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard']

/** How each Question Section is written wherever a teacher sees it, so the
 *  bank row, the filter and the Working Copy's own chrome can never disagree. */
export const SECTION_LABELS: Record<QuestionType, string> = {
  'multiple-choice': 'Multiple choice',
  'true-false': 'True/False',
  matching: 'Matching',
  open: 'Short answer',
  multipart: 'Multipart',
}

/** How each Difficulty is written wherever a teacher sees it, so the popup that
 *  sets one and the bank row that shows it can never disagree. */
export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
}

export type Question = {
  id: string
  type: QuestionType
  doc: ProseMirrorJSON
  /** Optional answer material for a Short Answer Question. It is canonical
   * Question Content, but is never shown on the student Exam stream. */
  suggestedAnswer?: ProseMirrorJSON
  columns: ColumnSetting
  // Optional classification. Both are absent rather than empty on a question
  // nobody has classified, so an untagged question costs no storage and a
  // record written before either existed still reads as a valid question.
  difficulty?: Difficulty
  topics?: string[]
}

export type Exam = {
  title: string
  questions: Question[]
  /** Room left below Short Answer questions for a student's working, keyed by
   *  question id. Exam presentation rather than Question Content: the same
   *  Question may want a quarter page on one test and none on another. Absent
   *  means no work space anywhere. */
  workSpace?: Record<string, WorkSpace>
  /** This Exam's Question Sections, in the order they print. Absent on an Exam
   *  written before Sections were stored: its Sections are then derived, one
   *  per Question Type (see `sectionsOf`). */
  sections?: ExamSection[]
  /** Which Section each question belongs to, by question id. A question with
   *  no entry, or one naming a Section that is gone or of another type, belongs
   *  to the last Section of its type. */
  sectionOf?: Record<string, string>
  /** The wording an Exam written before Sections were stored gave each type's
   *  one Section. Read only for derived Sections; a stored Section carries its
   *  own. See `section-headings.ts`. */
  sectionHeadings?: SectionHeadings
  /** How large every section heading prints. Absent means `'normal'`. */
  headingSize?: HeadingSize
  /** How large its questions and answers print. Absent means `'normal'`. */
  textSize?: TextSize
  /** This Exam's own test-page header lines, where they depart from the
   *  default blanks. See `page-header.ts`. */
  header?: ExamHeader
}

/** What a work space prints as: an empty area, or ruled writing lines. */
export type WorkSpaceStyle = 'blank' | 'lines'

/** The room a Short Answer question leaves below itself for a student's work.
 *
 *  `height` is in CSS pixels at 96dpi, the unit the Layout Plan packs in, and
 *  is always a whole number of `WORK_SPACE_LINE_PITCH`s so that switching
 *  between blank and lined never moves anything on the page. `fill` stretches
 *  the space to the foot of whatever page the question lands on — `height` is
 *  then the least room it takes, which is what decides whether the question
 *  still fits on the page it is on. */
export type WorkSpace = {
  height: number
  style: WorkSpaceStyle
  fill: boolean
}

/** The distance between two ruled lines: a third of an inch, the wide-ruled
 *  spacing a student's handwriting is comfortable in. Heights snap to it. */
export const WORK_SPACE_LINE_PITCH = 32

/** A question with no room for work: nothing prints below it. */
export const NO_WORK_SPACE: WorkSpace = { height: 0, style: 'blank', fill: false }

/** Whether a question of this type can leave room for work. Only Short Answer
 *  asks the student to write anything longer than a letter. */
export function takesWorkSpace(type: QuestionType): boolean {
  return type === 'open'
}

/** A height snapped to whole ruled lines and kept within `[0, max]`. */
export function snapWorkSpaceHeight(height: number, max = Infinity): number {
  const lines = Math.round(Math.max(0, height) / WORK_SPACE_LINE_PITCH)
  const limit = Math.floor(Math.max(0, max) / WORK_SPACE_LINE_PITCH)
  return Math.min(lines, limit) * WORK_SPACE_LINE_PITCH
}

/** Whether a stored value is a work space this build can print. The single
 *  guard, so storage and import agree on what a readable record is. */
export function isWorkSpace(value: unknown): value is WorkSpace {
  const space = value as WorkSpace | null
  return (
    typeof space === 'object'
    && space !== null
    && typeof space.height === 'number'
    && Number.isFinite(space.height)
    && space.height >= 0
    && (space.style === 'blank' || space.style === 'lines')
    && typeof space.fill === 'boolean'
  )
}

/** A question's work space on this Exam. The one reader, so an Exam written
 *  before work space existed, and a question no one has given any, both read
 *  as none. */
export function workSpaceOf(exam: Exam, questionId: string): WorkSpace {
  const space = exam.workSpace?.[questionId]
  return space && isWorkSpace(space) ? space : NO_WORK_SPACE
}

/** Whether a work space prints anything at all. */
export function hasWorkSpace(space: WorkSpace): boolean {
  return space.height > 0 || space.fill
}

export type Arrangement = {
  id: string
  letter: string
  questionOrder: string[]
  choiceOrder: Record<string, string[]>
}

// A choice as the page sees it: its stable id, whether it is the correct
// answer, and the document node to render. A matching set's Word Bank answers
// are choices in this sense too — they are what an arrangement orders — but
// none of them is correct on its own, so `correct` is always false for one.
export type Choice = {
  id: string
  correct: boolean
  node: ProseMirrorJSON
}

// One item of a matching set: its stable id, the id of the Word Bank answer it
// names ('' when the teacher has not matched it yet), and the node to render.
export type Prompt = {
  id: string
  answerId: string
  node: ProseMirrorJSON
}

// One Part of a Multipart question, read out of its document: its stable id, what it
// asks for, its own stem, and — for a Multiple Choice Part — its answers and
// the columns they lay out in, or — for a Short Answer Part — its Suggested
// Answer. Parts are never Questions of their own: they print lettered under
// their question's one number, and the Question Bank keeps them together.
export type Part = {
  id: string
  type: PartType
  stem: ProseMirrorJSON[]
  choices: Choice[]
  columns: ColumnSetting
  /** A Short Answer Part's Suggested Answer as a document, when it has one. */
  suggestedAnswer?: ProseMirrorJSON
}

// The order Question Types are listed in wherever a teacher picks one, and the
// order an Exam's Sections take when they are derived rather than stored.
// `'open'` is the type a school test calls "Short Answer". A Multipart comes
// last, in a Section of its own, because its Parts mix types and a Section
// holds one.
export const SECTION_ORDER: readonly QuestionType[] = [
  'multiple-choice',
  'true-false',
  'matching',
  'open',
  'multipart',
]

export const DEFAULT_EXAM_TITLE = 'Untitled Exam'

function newQuestionDoc(type: QuestionType): ProseMirrorJSON {
  if (type === 'open') return structuredClone(emptyDoc)
  if (type === 'multipart') {
    return { type: 'doc', content: [{ type: 'paragraph' }, newMultipartPartsNode()] }
  }
  const answers =
    type === 'true-false'
      ? newTrueFalseNode()
      : type === 'matching'
        ? newMatchingNode()
        : newMultipleChoiceNode()
  return { type: 'doc', content: [{ type: 'paragraph' }, answers] }
}

/** A question's Topics, always a list. The single reader, so an absent list and
 *  an empty one are the same thing everywhere — including for a stored question
 *  written before Topics existed. */
export function topicsOf(question: Question): readonly string[] {
  return Array.isArray(question.topics) ? question.topics : []
}

/**
 * The rule a committed Topic follows: surrounding whitespace trimmed, an empty
 * value ignored, and the exact string kept otherwise.
 *
 * Casing and spelling are the teacher's. Nothing here case-folds, stems,
 * autocompletes or consults a controlled vocabulary, so "Algebra" and "algebra"
 * are two Topics; only the identical string is already there.
 */
export function withTopicAdded(
  topics: readonly string[],
  value: string,
): string[] {
  const topic = value.trim()
  if (topic === '' || topics.includes(topic)) return [...topics]
  return [...topics, topic]
}

/** A question's answer columns, as a count the layout can use directly. The one
 *  reader of the stored setting, so a record written when the setting could
 *  also be `'auto'` — measured, rather than chosen — reads as the default
 *  instead of needing a migration pass. */
export function columnsOf(question: Question): ColumnSetting {
  const { columns } = question
  return columns === 1 || columns === 2 || columns === 4 ? columns : DEFAULT_COLUMNS
}

/** A blank question of `type`. `columns` is the layout it starts with, which
 *  the caller takes from the question it is being written beside, so a teacher
 *  sets an answer layout once rather than once per question. */
export function createQuestion(
  type: QuestionType,
  columns: ColumnSetting = DEFAULT_COLUMNS,
): Question {
  return {
    id: crypto.randomUUID(),
    type,
    doc: newQuestionDoc(type),
    columns,
  }
}

// A copy of the question, ready to be added as a question of its own. Its
// choices are given fresh ids: `choiceOrder` is keyed by choice id, so a copy
// that shared them would have its answers reordered along with the original's.
export function duplicateQuestion(question: Question): Question {
  const copy: Question = {
    ...question,
    id: crypto.randomUUID(),
    doc: withFreshChoiceIds(question.doc),
    ...(question.suggestedAnswer
      ? { suggestedAnswer: structuredClone(question.suggestedAnswer) }
      : {}),
  }
  // A list of its own: the copy is a Question Bank record in its own right, and
  // retagging one must never retag the other.
  if (question.topics) copy.topics = [...question.topics]
  return copy
}

export function createExam(title: string = DEFAULT_EXAM_TITLE): Exam {
  return { title, questions: [] }
}

export function createArrangement(letter = 'A'): Arrangement {
  return { id: crypto.randomUUID(), letter, questionOrder: [], choiceOrder: {} }
}

// 'A', 'B', 'C', … skipping letters already taken. Past 'Z' the letters keep
// counting as 'AA', 'AB', … rather than colliding.
export function nextArrangementLetter(arrangements: readonly Arrangement[]): string {
  const taken = new Set(arrangements.map((arrangement) => arrangement.letter))
  for (let index = 0; ; index += 1) {
    const letter = arrangementLetterAt(index)
    if (!taken.has(letter)) return letter
  }
}

function arrangementLetterAt(index: number): string {
  let letter = ''
  let remaining = index
  do {
    letter = String.fromCharCode(65 + (remaining % 26)) + letter
    remaining = Math.floor(remaining / 26) - 1
  } while (remaining >= 0)
  return letter
}

export function questionById(exam: Exam, id: string): Question | undefined {
  return exam.questions.find((question) => question.id === id)
}

// The tolerance rule, in one place: keep the recorded order for everything that
// still exists, drop ids that no longer resolve, and append anything the order
// has never heard of. Duplicates in either list collapse to their first
// occurrence.
export function reconcileOrder(
  order: readonly string[],
  present: readonly string[],
): string[] {
  const remaining = new Set(present)
  const result: string[] = []
  for (const id of order) {
    if (remaining.delete(id)) result.push(id)
  }
  for (const id of present) {
    if (remaining.delete(id)) result.push(id)
  }
  return result
}

/** One Question Section of an Exam: its heading and directions, and nothing
 *  about what kind of question it holds — a Section holds Questions of any
 *  type (ADR-0029). Both are the teacher's own text, begun from the defaults
 *  of the type of the first Question put in it; an empty string is a part the
 *  teacher cleared, which prints nothing. */
export type ExamSection = {
  id: string
  title: string
  instructions: string
}

/** The heading and directions a new Section begins with: those of the type of
 *  the first Question put in it. */
export function newSectionWording(type: QuestionType): Pick<ExamSection, 'title' | 'instructions'> {
  return { title: SECTION_TITLE[type], instructions: SECTION_INSTRUCTIONS[type] }
}

/** A stored Section as this build reads it, or `null` when it cannot be read.
 *  A Section stored while Sections were typed carries a `type` and only the
 *  wording it departed from that type's default with; it reads with that
 *  default filled in, so it prints as it did. */
export function readExamSection(value: unknown): ExamSection | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const { id, type, title, instructions } = value as Record<string, unknown>
  if (typeof id !== 'string' || id === '') return null
  if (title !== undefined && typeof title !== 'string') return null
  if (instructions !== undefined && typeof instructions !== 'string') return null
  const typed = SECTION_ORDER.includes(type as QuestionType) ? (type as QuestionType) : null
  return {
    id,
    title: title ?? (typed ? SECTION_TITLE[typed] : ''),
    instructions: instructions ?? (typed ? SECTION_INSTRUCTIONS[typed] : ''),
  }
}

/** Whether a stored value is a Section this build can read. The single guard,
 *  so storage and import agree on what a readable record is. */
export function isExamSection(value: unknown): boolean {
  return readExamSection(value) !== null
}

// The Section a question belongs to: the stored one it names, if that is still
// there; otherwise the last stored Section; and otherwise — on an Exam that
// stores none — a derived one per type, whose id is the type itself. A stored
// Section's id is a UUID, so the two never collide, and an Exam written before
// Sections were stored reads as one Section per type, exactly as it printed.
function resolvedSectionIdOf(
  question: Question,
  sectionOf: Record<string, string> | undefined,
  stored: readonly ExamSection[],
): string {
  const placed = sectionOf?.[question.id]
  if (placed !== undefined && stored.some(({ id }) => id === placed)) return placed
  return stored.at(-1)?.id ?? question.type
}

function storedSectionsOf(exam: Pick<Exam, 'sections'>): ExamSection[] {
  const seen = new Set<string>()
  const sections: ExamSection[] = []
  for (const value of exam.sections ?? []) {
    const section = readExamSection(value)
    if (!section || seen.has(section.id)) continue
    seen.add(section.id)
    sections.push(section)
  }
  return sections
}

/** The id of the Section this question belongs to on this Exam. */
export function sectionIdOf(exam: Exam, question: Question): string {
  return resolvedSectionIdOf(question, exam.sectionOf, storedSectionsOf(exam))
}

/**
 * Every Section of this Exam, in print order: its stored Sections — empty ones
 * included, which stay until the teacher deletes them. An Exam that stores
 * none has a derived Section for each type it has questions of, in
 * `SECTION_ORDER`, worded by its legacy `sectionHeadings`.
 */
export function sectionsOf(exam: Exam): ExamSection[] {
  const stored = storedSectionsOf(exam)
  if (stored.length > 0) return stored
  const types = new Set(exam.questions.map(({ type }) => type))
  return SECTION_ORDER.filter((type) => types.has(type)).map((type): ExamSection => {
    const heading = exam.sectionHeadings?.[type]
    return {
      id: type,
      title: heading?.title ?? SECTION_TITLE[type],
      instructions: heading?.instructions ?? SECTION_INSTRUCTIONS[type],
    }
  })
}

export function sectionById(exam: Exam, sectionId: string): ExamSection | undefined {
  return sectionsOf(exam).find(({ id }) => id === sectionId)
}

// The questions of one Section, in the order this arrangement puts them in.
export function questionsInSection(
  exam: Exam,
  arrangement: Arrangement,
  sectionId: string,
): Question[] {
  const stored = storedSectionsOf(exam)
  const inSection = exam.questions.filter(
    (question) => resolvedSectionIdOf(question, exam.sectionOf, stored) === sectionId,
  )
  const byId = new Map(inSection.map((question) => [question.id, question]))
  return reconcileOrder(
    arrangement.questionOrder,
    inSection.map((question) => question.id),
  ).map((id) => byId.get(id)!)
}

// Every question in render order: each Section in turn, each Section in the
// order this arrangement puts it in.
export function orderedQuestions(exam: Exam, arrangement: Arrangement): Question[] {
  return sectionsOf(exam).flatMap((section) =>
    questionsInSection(exam, arrangement, section.id),
  )
}

/**
 * The whole of an Exam's Section structure, made explicit: every Section
 * stored, every question placed, and a question order that runs Section by
 * Section. What a structural edit returns, for the store to write back. A
 * derived Section keeps its id when it is stored, and its legacy wording moves
 * onto it, so nothing on the page moves.
 */
export type SectionLayout = {
  sections: ExamSection[]
  sectionOf: Record<string, string>
  questionOrder: string[]
}

type Members = { section: ExamSection; ids: string[] }[]

function membersOf(exam: Exam, arrangement: Arrangement): Members {
  return sectionsOf(exam).map((section) => ({
    section,
    ids: questionsInSection(exam, arrangement, section.id).map(({ id }) => id),
  }))
}

function layoutOf(members: Members): SectionLayout {
  const sectionOf: Record<string, string> = {}
  for (const { section, ids } of members) {
    for (const id of ids) sectionOf[id] = section.id
  }
  return {
    sections: members.map(({ section }) => section),
    sectionOf,
    questionOrder: members.flatMap(({ ids }) => ids),
  }
}

/** This Exam's Sections made explicit, changing nothing about how it prints. */
export function sectionLayoutOf(exam: Exam, arrangement: Arrangement): SectionLayout {
  return layoutOf(membersOf(exam, arrangement))
}

export type QuestionPlacement = 'before' | 'after'

/** Where questions are put: beside a question, at the end of a Section, or in
 *  a new Section of their own directly below one — at the end of the Exam when
 *  `afterSectionId` is `null`. */
export type SectionTarget =
  | { kind: 'question'; questionId: string; placement: QuestionPlacement }
  | { kind: 'section-end'; sectionId: string }
  | { kind: 'new-section'; afterSectionId: string | null }

/**
 * Puts questions — already on the Exam, or just added to it — at a target,
 * keeping their on-page order. A Section holds Questions of any type, so every
 * one of them goes. A new Section begins with the heading and directions of
 * the type of the first Question put in it. A Section a move empties stays.
 * `null` means nothing would change.
 */
export function placeQuestions(
  exam: Exam,
  arrangement: Arrangement,
  questionIds: readonly string[],
  target: SectionTarget,
  newSectionId: () => string = () => crypto.randomUUID(),
): SectionLayout | null {
  const members = membersOf(exam, arrangement)
  const typeById = new Map(exam.questions.map((question) => [question.id, question.type]))
  const requested = new Set(questionIds.filter((id) => typeById.has(id)))
  // On-page order: the requested questions in the order they print. Every
  // question on the Exam resolves to a Section, so this is all of them.
  const moving = members.flatMap(({ ids }) => ids).filter((id) => requested.has(id))
  if (moving.length === 0) return null
  const movingSet = new Set(moving)
  const next: Members = members.map(({ section, ids }) => ({
    section,
    ids: ids.filter((id) => !movingSet.has(id)),
  }))

  if (target.kind === 'new-section') {
    const at =
      target.afterSectionId === null
        ? members.length
        : members.findIndex(({ section }) => section.id === target.afterSectionId) + 1
    if (at === 0) return null
    next.splice(at, 0, {
      section: { id: newSectionId(), ...newSectionWording(typeById.get(moving[0]!)!) },
      ids: moving,
    })
    return layoutOf(next)
  }

  if (target.kind === 'question' && movingSet.has(target.questionId)) return null
  const into =
    target.kind === 'section-end'
      ? next.find(({ section }) => section.id === target.sectionId)
      : next.find(({ ids }) => ids.includes(target.questionId))
  if (!into) return null
  const index =
    target.kind === 'section-end'
      ? into.ids.length
      : into.ids.indexOf(target.questionId) + (target.placement === 'after' ? 1 : 0)
  into.ids.splice(index, 0, ...moving)
  const layout = layoutOf(next)
  return sameLayout(layout, layoutOf(members)) ? null : layout
}

/** The Exam with one Section moved one place up (`-1`) or down (`1`), past its
 *  neighbour. `null` at either end, or for a Section the Exam does not have. */
export function moveSection(
  exam: Exam,
  arrangement: Arrangement,
  sectionId: string,
  direction: -1 | 1,
): SectionLayout | null {
  const members = membersOf(exam, arrangement)
  const index = members.findIndex(({ section }) => section.id === sectionId)
  const swap = index + direction
  if (index < 0 || swap < 0 || swap >= members.length) return null
  ;[members[index], members[swap]] = [members[swap]!, members[index]!]
  return layoutOf(members)
}

/** The Exam without one Section, and the questions that Section held, which
 *  the caller Removes from the Exam. `null` for a Section it does not have. */
export function deleteSection(
  exam: Exam,
  arrangement: Arrangement,
  sectionId: string,
): { layout: SectionLayout; removedQuestionIds: string[] } | null {
  const members = membersOf(exam, arrangement)
  const index = members.findIndex(({ section }) => section.id === sectionId)
  if (index < 0) return null
  const [removed] = members.splice(index, 1)
  return { layout: layoutOf(members), removedQuestionIds: removed!.ids }
}

/** The Exam with one Section reworded. An absent key leaves that part as it
 *  is; an empty string clears it. `null` when nothing changes or the Section
 *  does not exist. */
export function rewordSection(
  exam: Exam,
  arrangement: Arrangement,
  sectionId: string,
  change: SectionHeadingChange,
): SectionLayout | null {
  const members = membersOf(exam, arrangement)
  const entry = members.find(({ section }) => section.id === sectionId)
  if (!entry) return null
  const title = change.title ?? entry.section.title
  const instructions = change.instructions ?? entry.section.instructions
  if (title === entry.section.title && instructions === entry.section.instructions) return null
  entry.section = { id: entry.section.id, title, instructions }
  return layoutOf(members)
}

/** Whether two layouts say the same thing. */
export function sameLayout(left: SectionLayout, right: SectionLayout): boolean {
  return (
    left.questionOrder.length === right.questionOrder.length
    && left.questionOrder.every((id, index) => id === right.questionOrder[index])
    && sameSections(left.sections, right.sections)
    && sameSectionOf(left.sectionOf, right.sectionOf)
  )
}

/** Whether two Section lists agree, Section for Section. Absent and empty agree. */
export function sameSections(
  left: readonly ExamSection[] | undefined,
  right: readonly ExamSection[] | undefined,
): boolean {
  const first = left ?? []
  const second = right ?? []
  return (
    first.length === second.length
    && first.every(
      (section, index) =>
        section.id === second[index]!.id
        && section.title === second[index]!.title
        && section.instructions === second[index]!.instructions,
    )
  )
}

/** Whether two placements agree. Absent and empty agree. */
export function sameSectionOf(
  left: Record<string, string> | undefined,
  right: Record<string, string> | undefined,
): boolean {
  const first = Object.entries(left ?? {})
  return (
    first.length === Object.keys(right ?? {}).length
    && first.every(([id, section]) => right?.[id] === section)
  )
}

// The question's answers in authoring order, correctness included. For a
// matching set these are its Word Bank: the answers an arrangement's
// `choiceOrder` permutes, with no correctness of their own.
export function choicesOf(question: Question): Choice[] {
  if (question.type === 'matching') {
    return matchingBankNodesOf(question.doc).map((node) => ({
      id: choiceIdOf(node),
      correct: false,
      node,
    }))
  }
  return choiceNodesOf(question.doc).map((node) => ({
    id: choiceIdOf(node),
    correct: choiceIsCorrect(node),
    node,
  }))
}

function isBlankDocument(doc: ProseMirrorJSON | undefined): boolean {
  const content = Array.isArray(doc?.content) ? (doc.content as ProseMirrorJSON[]) : []
  return content.every(
    (node) =>
      node.type === 'paragraph'
      && !(Array.isArray(node.content) && node.content.length > 0),
  )
}

// A Multipart question's Parts in authored order — the order they are lettered in on
// every arrangement. Empty for any other question type.
export function partsOf(question: Question): Part[] {
  if (question.type !== 'multipart') return []
  return multipartPartNodesOf(question.doc).map((node) => {
    const answer = partAnswerNodeOf(node)
    const attrs = (node.attrs ?? {}) as Record<string, unknown>
    const columns = attrs.columns
    const type: PartType = answer?.type === 'suggestedAnswer' ? 'open' : 'multiple-choice'
    const part: Part = {
      id: choiceIdOf(node),
      type,
      stem: partStemNodesOf(node),
      choices:
        type === 'multiple-choice'
          ? choiceNodesOf({ content: answer ? [answer] : [] }).map((choice) => ({
              id: choiceIdOf(choice),
              correct: choiceIsCorrect(choice),
              node: choice,
            }))
          : [],
      columns: columns === 1 || columns === 2 || columns === 4 ? columns : DEFAULT_COLUMNS,
    }
    if (type === 'open' && answer) {
      const suggested: ProseMirrorJSON = {
        type: 'doc',
        content: Array.isArray(answer.content) ? answer.content : [],
      }
      if (!isBlankDocument(suggested)) part.suggestedAnswer = suggested
    }
    return part
  })
}

/** The one Part with this id among an Exam's Multipart questions, along with
 *  the question that holds it. */
export function partById(
  exam: Pick<Exam, 'questions'>,
  partId: string,
): { question: Question; part: Part } | undefined {
  for (const question of exam.questions) {
    const part = partsOf(question).find(({ id }) => id === partId)
    if (part) return { question, part }
  }
  return undefined
}

/** Every key an Exam's presentation settings may file under for this
 *  question: its own id, and each of its Parts' ids. Answer order, answer
 *  columns and Work Space are set per Part on a Multipart question, so removing or
 *  replacing the Multipart question has to reach them all. */
export function presentationIdsOf(question: Question): string[] {
  return [question.id, ...partsOf(question).map((part) => part.id)]
}

/** A Multiple Choice Part's answers in the order this arrangement puts them
 *  in, keyed in `choiceOrder` by the Part's id as a question's are by its own. */
export function orderedPartChoices(part: Part, arrangement: Arrangement): Choice[] {
  const byId = new Map(part.choices.map((choice) => [choice.id, choice]))
  return reconcileOrder(
    arrangement.choiceOrder[part.id] ?? [],
    part.choices.map((choice) => choice.id),
  ).map((id) => byId.get(id)!)
}

// A matching set's prompts in authoring order — the order they are numbered
// in on every arrangement. Empty for any other question type.
export function promptsOf(question: Question): Prompt[] {
  if (question.type !== 'matching') return []
  return matchingPromptNodesOf(question.doc).map((node) => ({
    id: choiceIdOf(node),
    answerId: promptAnswerIdOf(node),
    node,
  }))
}

// The question's answers in the order this arrangement puts them in. A choice's
// letter on the printed page is its position here, so correctness follows its
// choice with no bookkeeping.
export function orderedChoices(question: Question, arrangement: Arrangement): Choice[] {
  const choices = choicesOf(question)
  const byId = new Map(choices.map((choice) => [choice.id, choice]))
  return reconcileOrder(
    arrangement.choiceOrder[question.id] ?? [],
    choices.map((choice) => choice.id),
  ).map((id) => byId.get(id)!)
}

export function withQuestionAppended(
  arrangement: Arrangement,
  questionId: string,
): Arrangement {
  if (arrangement.questionOrder.includes(questionId)) return arrangement
  return { ...arrangement, questionOrder: [...arrangement.questionOrder, questionId] }
}

export function withQuestionRemoved(
  arrangement: Arrangement,
  questionId: string,
): Arrangement {
  const choiceOrder = { ...arrangement.choiceOrder }
  delete choiceOrder[questionId]
  return {
    ...arrangement,
    questionOrder: arrangement.questionOrder.filter((id) => id !== questionId),
    choiceOrder,
  }
}

// The same contract as `Math.random`: a float in [0, 1). Random operations
// accept it at their pure-model seam, so their tests can be reproducible while
// an authoring command and a real export can draw from `Math.random`.
export type RandomSource = () => number

/**
 * Shuffles only the selected questions among the positions those questions
 * already occupy, independently in each Question Section.
 *
 * A section with fewer than two selected questions cannot vary and is left
 * untouched. Every eligible section gets a non-identity permutation: a random
 * Fisher–Yates result that happened to be unchanged is rotated once instead.
 * This preserves each unselected question and every section boundary while
 * making one Vary command visibly vary every group it can.
 */
export function shuffleSelectedQuestions(
  exam: Exam,
  arrangement: Arrangement,
  questionIds: readonly string[],
  random: RandomSource,
): Arrangement {
  const selected = new Set(questionIds)
  let changed = false
  const questionOrder = sectionsOf(exam).flatMap((section) => {
    const sectionIds = questionsInSection(exam, arrangement, section.id).map(
      (question) => question.id,
    )
    const selectedIds = sectionIds.filter((id) => selected.has(id))
    if (selectedIds.length < 2) return sectionIds

    const shuffled = [...selectedIds]
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1))
      ;[shuffled[index], shuffled[swapIndex]] = [
        shuffled[swapIndex]!,
        shuffled[index]!,
      ]
    }
    if (shuffled.every((id, index) => id === selectedIds[index])) {
      shuffled.push(shuffled.shift()!)
    }
    changed = true
    let nextSelected = 0
    return sectionIds.map((id) =>
      selected.has(id) ? shuffled[nextSelected++]! : id,
    )
  })

  return changed ? { ...arrangement, questionOrder } : arrangement
}

/**
 * Shuffles the answers of every selected eligible Multiple Choice question, the
 * Word Bank of every selected matching set, and the answers of every Multiple
 * Choice Part of a selected Multipart question, independently. A Multipart question's Parts
 * themselves never move: they are lettered in place. The Question
 * Content is not changed: this records an order of stable choice ids in the
 * arrangement alone, so correctness remains on the choice it was authored on
 * and every prompt still names the same answer under its new letter.
 *
 * A selected Short Answer question, an unknown question, and a question with
 * fewer than two answers cannot vary and are left alone. So does a True/False
 * question: True before False is a convention a student reads rather than an
 * authored order, and reversing it varies nothing. As with question shuffling,
 * an identity Fisher–Yates draw is rotated so every eligible selected question
 * visibly changes order.
 */
export function shuffleSelectedAnswers(
  exam: Exam,
  arrangement: Arrangement,
  questionIds: readonly string[],
  random: RandomSource,
): Arrangement {
  const selected = new Set(questionIds)
  let choiceOrder = arrangement.choiceOrder
  let changed = false

  // Everything whose answers may vary: each eligible question, and each
  // Multiple Choice Part of a selected Multipart question, which Varies as a Multiple
  // Choice question does under the Part's own id.
  const targets: { id: string; current: Choice[] }[] = []
  for (const question of exam.questions) {
    if (!selected.has(question.id)) continue
    if (question.type === 'multipart') {
      for (const part of partsOf(question)) {
        if (part.type === 'multiple-choice') {
          targets.push({ id: part.id, current: orderedPartChoices(part, arrangement) })
        }
      }
    } else if (variesAnswers(question.type)) {
      targets.push({ id: question.id, current: orderedChoices(question, arrangement) })
    }
  }

  for (const { id, current } of targets) {
    if (current.length < 2) continue

    const shuffled = current.map((choice) => choice.id)
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1))
      ;[shuffled[index], shuffled[swapIndex]] = [
        shuffled[swapIndex]!,
        shuffled[index]!,
      ]
    }
    if (shuffled.every((id, index) => id === current[index]!.id)) {
      shuffled.push(shuffled.shift()!)
    }

    if (!changed) choiceOrder = { ...choiceOrder }
    choiceOrder[id] = shuffled
    changed = true
  }

  return changed ? { ...arrangement, choiceOrder } : arrangement
}
