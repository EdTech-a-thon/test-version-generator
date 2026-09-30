import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { inspectImportValue } from '../package-import'
import { readQuestionFile } from '.'
import { blocksText } from './rich-text'

const fixture = (path: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${path}`, import.meta.url)))

/** A file read, then checked by the import every Test Parrot file goes through. */
async function read(name: string, bytes: Uint8Array) {
  const reading = await readQuestionFile({ name, bytes })
  const proposal = await inspectImportValue(reading.record)
  return { reading, proposal, questions: reading.record.bank.questions }
}

const text = (document: { content: unknown[] } | undefined) =>
  document ? blocksText(document.content as never) : ''

describe('Blackboard Test Generator text', () => {
  test('reads the customer’s tagged sample as one Multiple Choice question', async () => {
    const { reading, questions } = await read('psych.txt', fixture('bb-generator/customer-sample.txt'))
    expect(reading.format).toBe('bb-generator')
    expect(reading.issues).toEqual([])
    expect(questions).toHaveLength(1)
    const [question] = questions
    expect(question!.type).toBe('multiple-choice')
    expect(text(question!.stem)).toBe(
      'What metaphor would developmentalists use to describe a child who flourishes despite adverse childhood experiences?',
    )
    expect(question!.choices!.map((choice) => [text(choice.content), choice.correct])).toEqual([
      ['a rose', false],
      ['a tulip', false],
      ['a dandelion', true],
      ['an orchid', false],
    ])
  })

  test('reads the generator’s own sample quiz', async () => {
    const { reading, questions } = await read('sampleQuiz.txt', fixture('bb-generator/oc-sample-quiz.txt'))
    expect(reading.format).toBe('bb-generator')
    expect(reading.found).toBe(6)
    expect(questions.map((question) => question.type)).toEqual([
      'multiple-choice', 'multiple-choice', 'true-false', 'short-answer', 'short-answer', 'matching',
    ])
    // Question 1 is Multiple Answer: it comes in with none marked, and says so.
    expect(questions[0]!.choices!.every((choice) => !choice.correct)).toBe(true)
    expect(reading.issues.map((issue) => issue.code)).toContain('multiple-answer')
    expect(questions[2]!.choices!.map((choice) => choice.correct)).toEqual([true, false])
    expect(text(questions[4]!.suggestedAnswer)).toBe('four / 4')
    const matching = questions[5]!
    expect(matching.prompts!.map((prompt) => text(prompt.content))).toEqual(['3', '1', '12', '4'])
    expect(matching.wordBank!.map((answer) => text(answer.content))).toEqual(['three', 'one', 'twelve', 'fore'])
    expect(matching.prompts![3]!.answer).toBeUndefined()
  })
})

describe('what a teacher is told', () => {
  test('a note names the question by its place in the whole file', async () => {
    const pasted = 'MC\nNo star here.\nyes\nno\n\nMA\nPick two.\n*one\n*two\nthree\n'
    const { reading } = await read('pasted.txt', new TextEncoder().encode(pasted))
    expect(reading.issues.map((issue) => issue.message.split(':')[0])).toEqual([
      'Question 1 (line 1)',
      'Question 2 (line 6)',
    ])
  })
})
