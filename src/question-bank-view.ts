// Browsing the Question Bank.
//
// The Question Bank stores questions in the order they were authored. A teacher
// browsing it wants the opposite — the question just written, first — and wants
// to narrow it by wording, Question Type, Difficulty and Topic. All of that is
// a *view*: it derives what to show from the bank and the filter, and changes
// nothing. Search and filter values are transient UI state and never enter the
// authoring history.

import {
  topicsOf,
  type Difficulty,
  type Question,
  type QuestionType,
} from './exam'
import type { QuestionBank } from './question-bank'
import { stemPreview } from './stem-preview'

/** A Difficulty filter value. `'unspecified'` is the questions nobody has
 *  classified: optional Difficulty must never make a question unreachable. */
export type DifficultyFilter = Difficulty | 'unspecified'

/**
 * What the teacher has narrowed the Question Bank to.
 *
 * An empty list is no constraint at all rather than a constraint nothing
 * satisfies. Values within one category are alternatives (OR); the categories
 * and the search narrow each other (AND).
 */
export type QuestionBankFilter = {
  search: string
  types: readonly QuestionType[]
  difficulties: readonly DifficultyFilter[]
  /** Exact, trimmed Topic strings — the ones `topicOptions` offered. */
  topics: readonly string[]
}

/** The unfiltered bank: every question, newest first. */
export const NO_FILTER: QuestionBankFilter = {
  search: '',
  types: [],
  difficulties: [],
  topics: [],
}

/** Whether anything is currently narrowing the bank — what tells "no questions
 *  match" from "no questions yet", and what a Clear control is offered for. */
export function isFilterActive(filter: QuestionBankFilter): boolean {
  return (
    filter.search.trim() !== ''
    || filter.types.length > 0
    || filter.difficulties.length > 0
    || filter.topics.length > 0
  )
}

/** The exact trimmed Topics the Question Bank currently holds, each once, for
 *  the Topic dropdown. Two spellings of one subject are two Topics: nothing
 *  here folds case or otherwise decides they are the same. */
export function topicOptions(bank: QuestionBank): string[] {
  const topics = new Set<string>()
  for (const question of bank.questions) {
    for (const topic of topicsOf(question)) {
      const trimmed = topic.trim()
      if (trimmed !== '') topics.add(trimmed)
    }
  }
  return [...topics].sort((one, other) => one.localeCompare(other))
}

function matchesSearch(question: Question, search: string): boolean {
  const wanted = search.trim().toLowerCase()
  if (wanted === '') return true
  // The projection the row showed, so what can be found is what was on screen:
  // answer choices, correctness and everything else behind the popup are out of
  // reach of search by construction rather than by a second rule.
  return stemPreview(question).text.toLowerCase().includes(wanted)
}

function matchesDifficulty(
  question: Question,
  difficulties: readonly DifficultyFilter[],
): boolean {
  if (difficulties.length === 0) return true
  return difficulties.includes(question.difficulty ?? 'unspecified')
}

function matchesTopics(question: Question, topics: readonly string[]): boolean {
  if (topics.length === 0) return true
  const questionTopics = topicsOf(question).map((topic) => topic.trim())
  return topics.some((topic) => questionTopics.includes(topic))
}

function matches(question: Question, filter: QuestionBankFilter): boolean {
  return (
    matchesSearch(question, filter.search)
    && (filter.types.length === 0 || filter.types.includes(question.type))
    && matchesDifficulty(question, filter.difficulties)
    && matchesTopics(question, filter.topics)
  )
}

/**
 * The Question Bank as the pane shows it: newest first, narrowed by the filter.
 *
 * Filtering hides rows; it never reorders them. Clearing the filter therefore
 * restores exactly the order that was there before, because that order was
 * never anything but the bank's own, reversed.
 */
export function browseQuestionBank(
  bank: QuestionBank,
  filter: QuestionBankFilter,
): Question[] {
  const shown: Question[] = []
  for (let index = bank.questions.length - 1; index >= 0; index -= 1) {
    const question = bank.questions[index]!
    if (matches(question, filter)) shown.push(question)
  }
  return shown
}
