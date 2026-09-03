import { describe, expect, test } from 'bun:test'
import { dropIntent, type DragSource, type DropCandidate } from './workspace-drag'

const fromQuestionBank: DragSource = {
  pane: 'question-bank',
  questionId: 'bank-1',
  type: 'multiple-choice',
}

const fromExamDraft: DragSource = {
  pane: 'exam-draft',
  questionIds: ['q2'],
  type: 'multiple-choice',
}

/** A rendered question 200px tall, starting 100px down the viewport. */
function rendered(
  overrides: Partial<Extract<DropCandidate, { kind: 'question' }>> = {},
): DropCandidate {
  return {
    kind: 'question',
    questionId: 'q1',
    type: 'multiple-choice',
    top: 100,
    height: 200,
    ...overrides,
  }
}

describe('a Question Bank question dropped on a rendered question', () => {
  test('inserts before it at the top edge', () => {
    expect(dropIntent(fromQuestionBank, rendered(), 110)).toEqual({
      kind: 'insert',
      targetQuestionId: 'q1',
      placement: 'before',
    })
  })

  test('Replaces it at the centre', () => {
    expect(dropIntent(fromQuestionBank, rendered(), 200)).toEqual({
      kind: 'replace',
      outgoingQuestionId: 'q1',
    })
  })

  test('inserts after it at the bottom edge', () => {
    expect(dropIntent(fromQuestionBank, rendered(), 290)).toEqual({
      kind: 'insert',
      targetQuestionId: 'q1',
      placement: 'after',
    })
  })

  test('keeps the edges shallow on a very tall question, so the centre Replaces', () => {
    // A question filling most of a sheet would otherwise give a third of the
    // page to each edge, and Replace would be all but unreachable.
    const tall = rendered({ top: 0, height: 900 })
    expect(dropIntent(fromQuestionBank, tall, 10)?.kind).toBe('insert')
    expect(dropIntent(fromQuestionBank, tall, 120)).toEqual({
      kind: 'replace',
      outgoingQuestionId: 'q1',
    })
    expect(dropIntent(fromQuestionBank, tall, 895)).toEqual({
      kind: 'insert',
      targetQuestionId: 'q1',
      placement: 'after',
    })
  })

  test('offers all three zones on a short question', () => {
    const short = rendered({ top: 0, height: 60 })
    expect(dropIntent(fromQuestionBank, short, 4)).toEqual({
      kind: 'insert',
      targetQuestionId: 'q1',
      placement: 'before',
    })
    expect(dropIntent(fromQuestionBank, short, 30)).toEqual({
      kind: 'replace',
      outgoingQuestionId: 'q1',
    })
    expect(dropIntent(fromQuestionBank, short, 56)).toEqual({
      kind: 'insert',
      targetQuestionId: 'q1',
      placement: 'after',
    })
  })

  test('offers nothing at all in another Question Section', () => {
    const shortAnswer = rendered({ type: 'open' })
    expect(dropIntent(fromQuestionBank, shortAnswer, 110)).toBeNull()
    expect(dropIntent(fromQuestionBank, shortAnswer, 200)).toBeNull()
    expect(dropIntent(fromQuestionBank, shortAnswer, 290)).toBeNull()
  })
})

describe('an Exam Draft question dragged within the Exam Draft', () => {
  test('reorders before or after, and never Replaces', () => {
    expect(dropIntent(fromExamDraft, rendered(), 110)).toEqual({
      kind: 'insert',
      targetQuestionId: 'q1',
      placement: 'before',
    })
    // The centre is a placement too: half the question each way, so there is
    // no dead band and no Replace anywhere on it.
    expect(dropIntent(fromExamDraft, rendered(), 195)).toEqual({
      kind: 'insert',
      targetQuestionId: 'q1',
      placement: 'before',
    })
    expect(dropIntent(fromExamDraft, rendered(), 205)).toEqual({
      kind: 'insert',
      targetQuestionId: 'q1',
      placement: 'after',
    })
  })

  test('offers nothing over a question it is carrying', () => {
    expect(dropIntent(fromExamDraft, rendered({ questionId: 'q2' }), 110)).toBeNull()
  })

  test('offers nothing in another Question Section', () => {
    expect(dropIntent(fromExamDraft, rendered({ type: 'open' }), 110)).toBeNull()
  })
})

describe('the first question of an empty Question Section', () => {
  const emptySection: DropCandidate = { kind: 'empty-section', section: 'multiple-choice' }

  test('accepts a Question Bank question of that section', () => {
    expect(dropIntent(fromQuestionBank, emptySection, 0)).toEqual({ kind: 'insert-first' })
  })

  test('refuses a Question Bank question of another section', () => {
    expect(
      dropIntent(fromQuestionBank, { kind: 'empty-section', section: 'open' }, 0),
    ).toBeNull()
  })

  test('refuses an Exam Draft question, which can only be reordered', () => {
    expect(dropIntent(fromExamDraft, emptySection, 0)).toBeNull()
  })
})

test('nothing under the pointer is no drop at all', () => {
  expect(dropIntent(fromQuestionBank, null, 110)).toBeNull()
  expect(dropIntent(fromExamDraft, null, 110)).toBeNull()
})
