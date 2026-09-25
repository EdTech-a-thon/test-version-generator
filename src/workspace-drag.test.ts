import { describe, expect, test } from 'bun:test'
import type { QuestionType } from './exam'
import { dropIntent, type DragSource, type DropCandidate } from './workspace-drag'

const fromQuestionBank: DragSource = {
  pane: 'question-bank',
  questionIds: ['bank-1'],
  type: 'multiple-choice',
}

const severalFromQuestionBank: DragSource = {
  pane: 'question-bank',
  questionIds: ['bank-1', 'bank-2'],
  type: 'multiple-choice',
}

const fromExamWorkingCopy: DragSource = {
  pane: 'exam-draft',
  questionIds: ['q2'],
  type: 'multiple-choice',
}

/** A rendered question on a sheet spanning x 100–700, from `top` to `bottom`. */
function rendered(
  questionId: string,
  type: QuestionType,
  top: number,
  bottom: number,
): DropCandidate {
  return {
    questionId,
    type,
    before: { y: top, left: 100, right: 700 },
    after: { y: bottom, left: 100, right: 700 },
  }
}

// Two Multiple Choice questions, then two Short Answer ones, down one sheet.
const page: DropCandidate[] = [
  rendered('q1', 'multiple-choice', 100, 300),
  rendered('q2', 'multiple-choice', 326, 526),
  rendered('s1', 'open', 600, 700),
  rendered('s2', 'open', 726, 826),
]

describe('a Question Bank question released over the Working Copy', () => {
  test('inserts before a question when nearer its top', () => {
    expect(dropIntent(fromQuestionBank, page, { x: 400, y: 150 })).toEqual({
      kind: 'insert',
      targetQuestionId: 'q1',
      placement: 'before',
    })
  })

  test('inserts after a question when nearer its bottom — there is no Replace', () => {
    // The middle of a question is an insertion point too: whichever edge is
    // nearer, and never the question itself.
    expect(dropIntent(fromQuestionBank, page, { x: 400, y: 210 })).toEqual({
      kind: 'insert',
      targetQuestionId: 'q1',
      placement: 'after',
    })
  })

  test('lands in its own section however far into another it is released', () => {
    // A Short Answer question dropped among the Multiple Choice ones goes to
    // the top of the Short Answer section: the nearest place it can go.
    const shortAnswer: DragSource = { pane: 'question-bank', questionIds: ['bank-9'], type: 'open' }
    expect(dropIntent(shortAnswer, page, { x: 400, y: 120 })).toEqual({
      kind: 'insert',
      targetQuestionId: 's1',
      placement: 'before',
    })
    // And a Multiple Choice question released below every Short Answer one goes
    // to the foot of the Multiple Choice section.
    expect(dropIntent(fromQuestionBank, page, { x: 400, y: 900 })).toEqual({
      kind: 'insert',
      targetQuestionId: 'q2',
      placement: 'after',
    })
  })

  test('lands when released in the margin beside the sheet', () => {
    expect(dropIntent(fromQuestionBank, page, { x: 20, y: 110 })).toEqual({
      kind: 'insert',
      targetQuestionId: 'q1',
      placement: 'before',
    })
  })

  test('reaches the nearest line across sheets laid side by side', () => {
    const sideBySide: DropCandidate[] = [
      rendered('q1', 'multiple-choice', 100, 900),
      {
        questionId: 'q2',
        type: 'multiple-choice',
        before: { y: 100, left: 800, right: 1400 },
        after: { y: 300, left: 800, right: 1400 },
      },
    ]
    expect(dropIntent(fromQuestionBank, sideBySide, { x: 1000, y: 250 })).toEqual({
      kind: 'insert',
      targetQuestionId: 'q2',
      placement: 'after',
    })
  })

  test('inserts a multi-row selection the same way', () => {
    expect(dropIntent(severalFromQuestionBank, page, { x: 400, y: 510 })).toEqual({
      kind: 'insert',
      targetQuestionId: 'q2',
      placement: 'after',
    })
  })

  test('adds the first question of a Question Section the exam has none of', () => {
    const trueFalse: DragSource = { pane: 'question-bank', questionIds: ['bank-3'], type: 'true-false' }
    expect(dropIntent(trueFalse, page, { x: 400, y: 150 })).toEqual({ kind: 'insert-first' })
    expect(dropIntent(trueFalse, [], { x: 400, y: 150 })).toEqual({ kind: 'insert-first' })
  })
})

describe('a Working Copy question dragged within the Working Copy', () => {
  test('reorders to the nearest line, never onto itself', () => {
    // Over its own body, q2 is placed relative to the nearest other question.
    expect(dropIntent(fromExamWorkingCopy, page, { x: 400, y: 450 })).toEqual({
      kind: 'insert',
      targetQuestionId: 'q1',
      placement: 'after',
    })
    expect(dropIntent(fromExamWorkingCopy, page, { x: 400, y: 120 })).toEqual({
      kind: 'insert',
      targetQuestionId: 'q1',
      placement: 'before',
    })
  })

  test('stays in its own section when released in another', () => {
    expect(dropIntent(fromExamWorkingCopy, page, { x: 400, y: 800 })).toEqual({
      kind: 'insert',
      targetQuestionId: 'q1',
      placement: 'after',
    })
  })

  test('has nowhere to go when it is the whole of its section', () => {
    const alone: DragSource = { pane: 'exam-draft', questionIds: ['q1', 'q2'], type: 'multiple-choice' }
    expect(dropIntent(alone, page, { x: 400, y: 120 })).toBeNull()
  })
})

test('a release outside the Working Copy changes nothing', () => {
  expect(dropIntent(fromQuestionBank, page, null)).toBeNull()
  expect(dropIntent(fromExamWorkingCopy, page, null)).toBeNull()
})
