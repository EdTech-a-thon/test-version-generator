// What `QuestionReading` draws: a Question's full content, already in editor
// nodes, whichever Question shape it came from. See `question-reading.tsx`.

import {
  SECTION_LABELS,
  choicesOf,
  promptsOf,
  topicsOf,
  type Difficulty,
  type Question,
} from './exam'
import { bankLetter } from './matching'
import { stemNodesOf, type ProseMirrorJSON } from './question-doc'

export type QuestionReadingContent = {
  typeLabel: string
  difficulty?: Difficulty
  topics: readonly string[]
  stem: ProseMirrorJSON[]
  choices?: { id: string; content: ProseMirrorJSON[]; correct: boolean }[]
  matching?: {
    /** `letter` is the Word Bank letter the item is matched to, if any. */
    prompts: { id: string; content: ProseMirrorJSON[]; letter?: string }[]
    wordBank: { id: string; content: ProseMirrorJSON[] }[]
  }
  suggestedAnswer?: ProseMirrorJSON[]
}

const childNodes = (node: ProseMirrorJSON): ProseMirrorJSON[] =>
  Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []

/** An editor Question, as the reading draws it. */
export function readingOfQuestion(question: Question): QuestionReadingContent {
  const base = {
    typeLabel: SECTION_LABELS[question.type],
    difficulty: question.difficulty,
    topics: topicsOf(question),
    stem: stemNodesOf(question.doc),
  }
  if (question.type === 'open') {
    return {
      ...base,
      ...(question.suggestedAnswer
        ? { suggestedAnswer: childNodes(question.suggestedAnswer) }
        : {}),
    }
  }
  if (question.type === 'matching') {
    const bank = choicesOf(question)
    const letters = new Map(bank.map((answer, index) => [answer.id, bankLetter(index)]))
    return {
      ...base,
      matching: {
        prompts: promptsOf(question).map((prompt) => ({
          id: prompt.id,
          content: childNodes(prompt.node),
          letter: letters.get(prompt.answerId),
        })),
        wordBank: bank.map((answer) => ({ id: answer.id, content: childNodes(answer.node) })),
      },
    }
  }
  return {
    ...base,
    choices: choicesOf(question).map((choice) => ({
      id: choice.id,
      content: childNodes(choice.node),
      correct: choice.correct,
    })),
  }
}
