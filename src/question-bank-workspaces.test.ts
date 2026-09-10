import { expect, test } from 'bun:test'
import { createQuestion } from './exam'
import {
  UNTITLED_QUESTION_BANK,
  createQuestionBankResourceStore,
  isPristineQuestionBank,
  type QuestionBankResource,
} from './question-bank-workspaces'

function bank(): QuestionBankResource {
  return {
    id: 'bank-1',
    name: UNTITLED_QUESTION_BANK,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastUpdatedAt: '2026-01-01T00:00:00.000Z',
    questions: [],
  }
}

test('only a pristine empty Untitled Question Bank is disposable', () => {
  const empty = bank()
  expect(isPristineQuestionBank(empty)).toBe(true)
  expect(isPristineQuestionBank({ ...empty, name: 'Biology' })).toBe(false)
  expect(isPristineQuestionBank({ ...empty, questions: [createQuestion('open')] })).toBe(false)
  expect(isPristineQuestionBank(null)).toBe(false)
})

test('a bank change becomes visible only after its durable commit', async () => {
  const initial = bank()
  let finish!: (value: QuestionBankResource) => void
  const committed = new Promise<QuestionBankResource>((resolve) => { finish = resolve })
  const store = createQuestionBankResourceStore(initial, () => committed)

  const renaming = store.rename('Biology')
  expect(store.getState()).toBe(initial)

  const durable = { ...initial, name: 'Biology', lastUpdatedAt: '2026-01-02T00:00:00.000Z' }
  finish(durable)
  await renaming
  expect(store.getState()).toBe(durable)
})

test('a failed Question save leaves canonical visible state unchanged for retry', async () => {
  const initial = bank()
  const store = createQuestionBankResourceStore(initial, async () => {
    throw new Error('Storage unavailable')
  })

  await expect(store.createQuestion(createQuestion('multiple-choice'))).rejects.toThrow('Storage unavailable')
  expect(store.getState()).toBe(initial)
  expect(store.getState().questions).toHaveLength(0)
})
