// The canonical exam model.
//
// There is exactly one copy of every question. A `Version` holds an ordering
// and nothing else: which order the questions appear in, and which order each
// question's choices appear in. Fixing a typo therefore fixes it in every
// version, and shuffling one version never disturbs another.
//
// Orderings are tolerated rather than validated: a question or choice that the
// ordering has never heard of is appended to the end of its section, and an id
// in an ordering with nothing behind it is ignored. That is what keeps versions
// valid across content edits without a migration step.

import {
  choiceIdOf,
  choiceIsCorrect,
  choiceNodesOf,
  emptyDoc,
  withFreshChoiceIds,
  type ProseMirrorJSON,
} from './question-doc'
import { newMultipleChoiceNode } from './multiple-choice'

export type QuestionType = 'multiple-choice' | 'open'

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
 *  bank row, the filter and the Exam Draft's own chrome can never disagree. */
export const SECTION_LABELS: Record<QuestionType, string> = {
  'multiple-choice': 'Multiple choice',
  open: 'Short answer',
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
}

export type Version = {
  id: string
  letter: string
  questionOrder: string[]
  choiceOrder: Record<string, string[]>
}

// A choice as the page sees it: its stable id, whether it is the correct
// answer, and the document node to render.
export type Choice = {
  id: string
  correct: boolean
  node: ProseMirrorJSON
}

// Sections are derived from question type, never stored, and always appear in
// this order. `'open'` is the section a school test calls "Short Answer".
export const SECTION_ORDER: readonly QuestionType[] = ['multiple-choice', 'open']

export const DEFAULT_EXAM_TITLE = 'Untitled exam'

function newQuestionDoc(type: QuestionType): ProseMirrorJSON {
  return type === 'multiple-choice'
    ? { type: 'doc', content: [{ type: 'paragraph' }, newMultipleChoiceNode()] }
    : structuredClone(emptyDoc)
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
  }
  // A list of its own: the copy is a Question Bank record in its own right, and
  // retagging one must never retag the other.
  if (question.topics) copy.topics = [...question.topics]
  return copy
}

export function createExam(title: string = DEFAULT_EXAM_TITLE): Exam {
  return { title, questions: [] }
}

export function createVersion(letter = 'A'): Version {
  return { id: crypto.randomUUID(), letter, questionOrder: [], choiceOrder: {} }
}

// 'A', 'B', 'C', … skipping letters already taken. Past 'Z' the letters keep
// counting as 'AA', 'AB', … rather than colliding.
export function nextVersionLetter(versions: readonly Version[]): string {
  const taken = new Set(versions.map((version) => version.letter))
  for (let index = 0; ; index += 1) {
    const letter = versionLetterAt(index)
    if (!taken.has(letter)) return letter
  }
}

function versionLetterAt(index: number): string {
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

// The questions of one section, in the order this version puts them in.
export function questionsInSection(
  exam: Exam,
  version: Version,
  section: QuestionType,
): Question[] {
  const inSection = exam.questions.filter((question) => question.type === section)
  const byId = new Map(inSection.map((question) => [question.id, question]))
  return reconcileOrder(
    version.questionOrder,
    inSection.map((question) => question.id),
  ).map((id) => byId.get(id)!)
}

// Every question in render order: each section in turn, each section in the
// order this version puts it in.
export function orderedQuestions(exam: Exam, version: Version): Question[] {
  return SECTION_ORDER.flatMap((section) =>
    questionsInSection(exam, version, section),
  )
}

// The question's answers in authoring order, correctness included.
export function choicesOf(question: Question): Choice[] {
  return choiceNodesOf(question.doc).map((node) => ({
    id: choiceIdOf(node),
    correct: choiceIsCorrect(node),
    node,
  }))
}

// The question's answers in the order this version puts them in. A choice's
// letter on the printed page is its position here, so correctness follows its
// choice with no bookkeeping.
export function orderedChoices(question: Question, version: Version): Choice[] {
  const choices = choicesOf(question)
  const byId = new Map(choices.map((choice) => [choice.id, choice]))
  return reconcileOrder(
    version.choiceOrder[question.id] ?? [],
    choices.map((choice) => choice.id),
  ).map((id) => byId.get(id)!)
}

export function withQuestionAppended(
  version: Version,
  questionId: string,
): Version {
  if (version.questionOrder.includes(questionId)) return version
  return { ...version, questionOrder: [...version.questionOrder, questionId] }
}

export function withQuestionRemoved(
  version: Version,
  questionId: string,
): Version {
  const choiceOrder = { ...version.choiceOrder }
  delete choiceOrder[questionId]
  return {
    ...version,
    questionOrder: version.questionOrder.filter((id) => id !== questionId),
    choiceOrder,
  }
}

export type QuestionPlacement = 'before' | 'after'

// Moves one question to an exact position in its derived section. A target in
// another section is refused: ordering never changes a question's type.
export function moveQuestion(
  exam: Exam,
  version: Version,
  questionId: string,
  targetId: string,
  placement: QuestionPlacement,
): Version {
  const question = questionById(exam, questionId)
  const target = questionById(exam, targetId)
  if (!question || !target || question.type !== target.type || questionId === targetId) {
    return version
  }

  const sectionIds = questionsInSection(exam, version, question.type).map(
    (item) => item.id,
  )
  const withoutQuestion = sectionIds.filter((id) => id !== questionId)
  const targetIndex = withoutQuestion.indexOf(targetId)
  if (targetIndex < 0) return version
  withoutQuestion.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, questionId)

  const questionOrder = SECTION_ORDER.flatMap((section) =>
    section === question.type
      ? withoutQuestion
      : questionsInSection(exam, version, section).map((item) => item.id),
  )
  if (questionOrder.every((id, index) => id === version.questionOrder[index]) &&
      questionOrder.length === version.questionOrder.length) return version
  return { ...version, questionOrder }
}

// Moves a selection as one block while preserving its on-page order. Only
// selected questions in the target's section participate: sections are fixed
// by question type, so a mixed selection can still be dragged without ever
// moving a question into the wrong section.
export function moveQuestions(
  exam: Exam,
  version: Version,
  questionIds: readonly string[],
  targetId: string,
  placement: QuestionPlacement,
): Version {
  const target = questionById(exam, targetId)
  if (!target) return version

  const sectionIds = questionsInSection(exam, version, target.type).map(
    (question) => question.id,
  )
  const selected = new Set(
    questionIds.filter((id) => questionById(exam, id)?.type === target.type),
  )
  if (selected.size === 0 || selected.has(targetId)) return version

  const moving = sectionIds.filter((id) => selected.has(id))
  const remaining = sectionIds.filter((id) => !selected.has(id))
  const targetIndex = remaining.indexOf(targetId)
  if (targetIndex < 0) return version
  remaining.splice(
    targetIndex + (placement === 'after' ? 1 : 0),
    0,
    ...moving,
  )

  const questionOrder = SECTION_ORDER.flatMap((section) =>
    section === target.type
      ? remaining
      : questionsInSection(exam, version, section).map((question) => question.id),
  )
  if (
    questionOrder.length === version.questionOrder.length &&
    questionOrder.every((id, index) => id === version.questionOrder[index])
  ) {
    return version
  }
  return { ...version, questionOrder }
}

// The same contract as `Math.random`: a float in [0, 1). Export Randomization
// is the only thing that draws from one, and it injects its own source so a
// fixture's Versions are reproducible while a real export is not.
export type RandomSource = () => number
