import { describe, expect, test } from 'bun:test'
import type { QuestionType } from './exam'
import {
  dropIntent,
  landsOnRelease,
  type DragSource,
  type DropCandidate,
  type DropField,
} from './workspace-drag'

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

const shortAnswerFromQuestionBank: DragSource = {
  pane: 'question-bank',
  questionIds: ['bank-3'],
  type: 'open',
}

/** A rendered question on a sheet spanning x 100–700, from `top` to `bottom`. */
function rendered(
  questionId: string,
  sectionId: string,
  type: QuestionType,
  top: number,
  bottom: number,
): DropCandidate {
  return {
    questionId,
    sectionId,
    type,
    before: { y: top, left: 100, right: 700 },
    after: { y: bottom, left: 100, right: 700 },
  }
}

function field(
  candidates: DropCandidate[],
  extra: Partial<DropField> = {},
): DropField {
  return { candidates, emptySections: [], openNewSection: null, ...extra }
}

// A Multiple Choice Section of two questions, a Short Answer Section of two,
// then a second Multiple Choice Section of one, down one sheet.
const page = field([
  rendered('q1', 'mc', 'multiple-choice', 100, 300),
  rendered('q2', 'mc', 'multiple-choice', 326, 526),
  rendered('s1', 'sa', 'open', 600, 700),
  rendered('s2', 'sa', 'open', 726, 826),
  rendered('q3', 'mc-2', 'multiple-choice', 900, 1000),
])

describe('a Question Bank question released over the Working Copy', () => {
  test('inserts before a question when nearer its top', () => {
    expect(dropIntent(fromQuestionBank, page, { x: 400, y: 150 })).toEqual({
      kind: 'insert',
      targetQuestionId: 'q1',
      placement: 'before',
      opensBelow: null,
    })
  })

  test('inserts after a question when nearer its bottom, and never replaces it', () => {
    expect(dropIntent(fromQuestionBank, page, { x: 400, y: 210 })).toEqual({
      kind: 'insert',
      targetQuestionId: 'q1',
      placement: 'after',
      opensBelow: null,
    })
  })

  test('reaches a second Section of its type as readily as the first', () => {
    expect(dropIntent(fromQuestionBank, page, { x: 400, y: 910 })).toEqual({
      kind: 'insert',
      targetQuestionId: 'q3',
      placement: 'before',
      opensBelow: null,
    })
  })

  test('never lands inside a Section of another type, going to the nearest line of its own', () => {
    // Over the middle of the Short Answer Section: the nearest Multiple Choice
    // line is below the first Section.
    const intent = dropIntent(fromQuestionBank, page, { x: 400, y: 560 })
    expect(intent).toMatchObject({ kind: 'insert', targetQuestionId: 'q2', placement: 'after' })
  })

  test('opens a new-Section target at the foot of its own type of Section', () => {
    expect(dropIntent(fromQuestionBank, page, { x: 400, y: 520 })).toEqual({
      kind: 'insert',
      targetQuestionId: 'q2',
      placement: 'after',
      opensBelow: 'mc',
    })
  })

  test('opens one at the foot of a Section of another type, which releases nothing until aimed at', () => {
    const intent = dropIntent(fromQuestionBank, page, { x: 400, y: 830 })
    expect(intent).toEqual({
      kind: 'new-section',
      afterSectionId: 'sa',
      armed: false,
      opensBelow: 'sa',
    })
    expect(landsOnRelease(intent)).toBe(false)
  })

  test('makes a new Section only when released over the open target', () => {
    const open = field(page.candidates, {
      openNewSection: {
        afterSectionId: 'sa',
        box: { top: 832, bottom: 884, left: 100, right: 700 },
      },
    })
    const intent = dropIntent(fromQuestionBank, open, { x: 400, y: 860 })
    expect(intent).toEqual({
      kind: 'new-section',
      afterSectionId: 'sa',
      armed: true,
      opensBelow: 'sa',
    })
    expect(landsOnRelease(intent)).toBe(true)
  })

  test('drops into an empty Section of its own type, and offers a new one beneath one of another', () => {
    const withEmpty = field(page.candidates, {
      emptySections: [
        { sectionId: 'empty-mc', type: 'multiple-choice', box: { top: 1100, bottom: 1156, left: 100, right: 700 } },
        { sectionId: 'empty-sa', type: 'open', box: { top: 1250, bottom: 1306, left: 100, right: 700 } },
      ],
    })
    expect(dropIntent(fromQuestionBank, withEmpty, { x: 400, y: 1120 })).toEqual({
      kind: 'section-end',
      sectionId: 'empty-mc',
      opensBelow: 'empty-mc',
    })
    expect(dropIntent(fromQuestionBank, withEmpty, { x: 400, y: 1270 })).toMatchObject({
      kind: 'new-section',
      afterSectionId: 'empty-sa',
      armed: false,
    })
  })

  test('a Short Answer question reaches only Short Answer lines', () => {
    expect(dropIntent(shortAnswerFromQuestionBank, page, { x: 400, y: 150 })).toMatchObject({
      kind: 'new-section',
      afterSectionId: 'mc',
    })
    expect(dropIntent(shortAnswerFromQuestionBank, page, { x: 400, y: 610 })).toMatchObject({
      kind: 'insert',
      targetQuestionId: 's1',
      placement: 'before',
    })
  })

  test('starts the first Section of an Exam with nothing on it', () => {
    expect(dropIntent(fromQuestionBank, field([]), { x: 400, y: 150 })).toEqual({
      kind: 'new-section',
      afterSectionId: null,
      armed: true,
      opensBelow: null,
    })
  })

  test('a gesture carrying several is placed like one', () => {
    expect(dropIntent(severalFromQuestionBank, page, { x: 400, y: 150 })).toMatchObject({
      kind: 'insert',
      targetQuestionId: 'q1',
      placement: 'before',
    })
  })

  test('outside the Working Copy, a release changes nothing', () => {
    expect(dropIntent(fromQuestionBank, page, null)).toBeNull()
  })
})

describe('a Working Copy question moved within it', () => {
  test('is never placed relative to itself, and the foot of its Section is the question above it', () => {
    // q2 is being carried: the line below q1 is the foot of its Section now.
    expect(dropIntent(fromExamWorkingCopy, page, { x: 400, y: 380 })).toEqual({
      kind: 'insert',
      targetQuestionId: 'q1',
      placement: 'after',
      opensBelow: 'mc',
    })
  })

  test('an Exam with nothing on it offers a move nothing', () => {
    expect(dropIntent(fromExamWorkingCopy, field([]), { x: 400, y: 150 })).toBeNull()
  })
})
