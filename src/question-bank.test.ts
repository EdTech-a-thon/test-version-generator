// The Question Bank and Exam Draft operations, at the level a teacher's action
// reduces to. The store composes these into atomic authoring actions; what is
// asserted here is the part that has to hold however they are composed —
// including the tolerance rules that keep a Question Bank and an Exam Draft
// usable when they disagree.

import { describe, expect, test } from 'bun:test'
import { createQuestion, DEFAULT_EXAM_TITLE } from './exam'
import {
  bankQuestionById,
  createExamDraft,
  createQuestionBank,
  isInExamDraft,
  withQuestionBanked,
  withReferenceAdded,
  withReferenceOrder,
  withReferenceReplaced,
  withReferencesRemoved,
} from './question-bank'

const ids = ['q1', 'q2', 'q3']

function draftOf(questionIds: readonly string[] = ids) {
  return questionIds.reduce(
    (draft, id) => withReferenceAdded(draft, id),
    createExamDraft(),
  )
}

describe('a new Question Bank and Exam Draft', () => {
  test('are empty, and the exam is untitled', () => {
    expect(createQuestionBank().questions).toEqual([])
    expect(createExamDraft().questionIds).toEqual([])
    expect(createExamDraft().title).toBe(DEFAULT_EXAM_TITLE)
    expect(createExamDraft('Chem Unit 3').title).toBe('Chem Unit 3')
  })
})

describe('banking Question Content', () => {
  test('stores each question once, keeping its identity', () => {
    const question = createQuestion('open')
    const bank = withQuestionBanked(createQuestionBank(), question)

    expect(bank.questions).toEqual([question])
    expect(bankQuestionById(bank, question.id)).toBe(question)
    expect(bankQuestionById(bank, 'unknown')).toBeUndefined()
  })

  test('replaces content in place rather than banking a second record', () => {
    const question = createQuestion('open')
    const edited = { ...question, columns: 2 as const }
    const bank = withQuestionBanked(
      withQuestionBanked(createQuestionBank(), question),
      edited,
    )

    expect(bank.questions).toEqual([edited])
  })

  test('keeps the authoring order, so a new question is the last one banked', () => {
    const [first, second] = [createQuestion('open'), createQuestion('open')]
    const bank = [first!, second!].reduce(withQuestionBanked, createQuestionBank())

    expect(bank.questions.map((question) => question.id)).toEqual([
      first!.id,
      second!.id,
    ])
  })
})

describe('referencing from the Exam Draft', () => {
  test('adds a reference at the end, or immediately after a given one', () => {
    expect(draftOf().questionIds).toEqual(ids)
    expect(withReferenceAdded(draftOf(), 'q4', 'q1').questionIds).toEqual([
      'q1',
      'q4',
      'q2',
      'q3',
    ])
  })

  test('appends when the question it would follow is not on the Exam Draft', () => {
    expect(withReferenceAdded(draftOf(), 'q4', 'elsewhere').questionIds).toEqual([
      ...ids,
      'q4',
    ])
  })

  test('holds a reference at most once, and adding it again is not a move', () => {
    const draft = draftOf()
    expect(withReferenceAdded(draft, 'q1', 'q3')).toBe(draft)
    expect(isInExamDraft(draft, 'q1')).toBe(true)
    expect(isInExamDraft(draft, 'q9')).toBe(false)
  })

  test('Removes references and leaves an unreferenced Remove alone', () => {
    const draft = draftOf()
    expect(withReferencesRemoved(draft, ['q1', 'q3']).questionIds).toEqual(['q2'])
    expect(withReferencesRemoved(draft, ['q9'])).toBe(draft)
  })
})

describe('reordering the Exam Draft', () => {
  test('takes the given order', () => {
    expect(withReferenceOrder(draftOf(), ['q3', 'q1', 'q2']).questionIds).toEqual([
      'q3',
      'q1',
      'q2',
    ])
  })

  test('ignores ids the Exam Draft does not reference', () => {
    expect(withReferenceOrder(draftOf(), ['q3', 'stranger', 'q1', 'q2']).questionIds)
      .toEqual(['q3', 'q1', 'q2'])
  })

  test('keeps a reference the new order forgot, so a reorder never Removes one', () => {
    // A reference the Question Bank cannot resolve never reaches the derived
    // ordering, so a move computed from that ordering comes back without it.
    // It stays on the Exam Draft rather than disappearing behind a drag.
    expect(withReferenceOrder(draftOf(), ['q3', 'q1']).questionIds).toEqual([
      'q3',
      'q1',
      'q2',
    ])
  })

  test('an order that changes nothing is the same Exam Draft', () => {
    const draft = draftOf()
    expect(withReferenceOrder(draft, ids)).toBe(draft)
  })
})

describe('replacing a reference', () => {
  test('puts the incoming question in the outgoing one’s place', () => {
    expect(withReferenceReplaced(draftOf(), 'q2', 'q9').questionIds).toEqual([
      'q1',
      'q9',
      'q3',
    ])
  })

  test('refuses when the outgoing question is not on the Exam Draft', () => {
    const draft = draftOf()
    expect(withReferenceReplaced(draft, 'elsewhere', 'q9')).toBe(draft)
  })

  test('refuses when the incoming question is already on the Exam Draft', () => {
    // A reference occurs at most once, so this would be a Remove wearing a
    // replacement's clothes.
    const draft = draftOf()
    expect(withReferenceReplaced(draft, 'q2', 'q1')).toBe(draft)
    expect(withReferenceReplaced(draft, 'q2', 'q2')).toBe(draft)
  })
})
