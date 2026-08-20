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
  type ProseMirrorJSON,
} from './question-doc'
import { newMultipleChoiceNode } from './multiple-choice'

export type QuestionType = 'multiple-choice' | 'open'

// How many columns a multiple-choice question's answers lay out in. `'auto'`
// defers to measurement; an explicit count disables that permanently.
export type ColumnSetting = 'auto' | 1 | 2 | 4

export type Question = {
  id: string
  type: QuestionType
  doc: ProseMirrorJSON
  // Choices preserved while the question's type is 'open', so switching type is
  // never destructive. Only one stash is kept.
  stashedChoices?: ProseMirrorJSON
  columns: ColumnSetting
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

export function createQuestion(type: QuestionType): Question {
  return {
    id: crypto.randomUUID(),
    type,
    doc: newQuestionDoc(type),
    columns: 'auto',
  }
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
