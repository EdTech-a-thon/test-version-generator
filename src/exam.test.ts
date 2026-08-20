import { describe, expect, test } from 'bun:test'
import {
  createExam,
  createQuestion,
  createVersion,
  nextVersionLetter,
  orderedChoices,
  orderedQuestions,
  questionById,
  questionsInSection,
  withQuestionAppended,
  withQuestionRemoved,
} from './exam'
import type { Exam, Question, Version } from './exam'
import type { ProseMirrorJSON } from './question-doc'

function choice(id: string, correct = false): ProseMirrorJSON {
  return {
    type: 'multipleChoiceChoice',
    attrs: { correct, id },
    content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }],
  }
}

function multipleChoice(id: string, choiceIds: string[], correctId = ''): Question {
  return {
    id,
    type: 'multiple-choice',
    doc: {
      type: 'doc',
      content: [
        { type: 'paragraph' },
        {
          type: 'multipleChoice',
          content: choiceIds.map((cid) => choice(cid, cid === correctId)),
        },
      ],
    },
    columns: 'auto',
  }
}

function open(id: string): Question {
  return { id, type: 'open', doc: { type: 'doc', content: [] }, columns: 'auto' }
}

function examOf(questions: Question[]): Exam {
  return { title: 'Test', questions }
}

function versionOf(questionOrder: string[], choiceOrder: Record<string, string[]> = {}): Version {
  return { id: 'v1', letter: 'A', questionOrder, choiceOrder }
}

const ids = (questions: Question[]) => questions.map((question) => question.id)

describe('question and version construction', () => {
  test('a new question defaults to automatic columns', () => {
    expect(createQuestion('multiple-choice').columns).toBe('auto')
    expect(createQuestion('open').columns).toBe('auto')
  })

  test('a new multiple-choice question carries choices, an open one does not', () => {
    expect(orderedChoices(createQuestion('multiple-choice'), createVersion())).not.toHaveLength(0)
    expect(orderedChoices(createQuestion('open'), createVersion())).toHaveLength(0)
  })

  test('a new exam is empty and its questions have unique ids', () => {
    expect(createExam().questions).toEqual([])
    expect(createQuestion('open').id).not.toBe(createQuestion('open').id)
  })

  test('version letters are allocated A, B, C', () => {
    expect(nextVersionLetter([])).toBe('A')
    expect(nextVersionLetter([createVersion('A')])).toBe('B')
    expect(nextVersionLetter([createVersion('A'), createVersion('B')])).toBe('C')
  })
})

describe('question ordering', () => {
  test('questions render in the version ordering', () => {
    const exam = examOf([multipleChoice('q1', ['a']), multipleChoice('q2', ['a']), multipleChoice('q3', ['a'])])
    expect(ids(orderedQuestions(exam, versionOf(['q3', 'q1', 'q2'])))).toEqual(['q3', 'q1', 'q2'])
  })

  test('sections are ordered multiple choice first, then short answer', () => {
    const exam = examOf([open('o1'), multipleChoice('q1', ['a'])])
    expect(ids(orderedQuestions(exam, versionOf(['o1', 'q1'])))).toEqual(['q1', 'o1'])
  })

  test('a question missing from the ordering is appended to the end of its section', () => {
    const exam = examOf([multipleChoice('q1', ['a']), open('o1'), multipleChoice('q2', ['a']), open('o2')])
    // Only q1 and o1 were in the ordering when this version was saved.
    expect(ids(orderedQuestions(exam, versionOf(['o1', 'q1'])))).toEqual(['q1', 'q2', 'o1', 'o2'])
  })

  test('an ordering id with no matching question is ignored', () => {
    const exam = examOf([multipleChoice('q1', ['a'])])
    expect(ids(orderedQuestions(exam, versionOf(['gone', 'q1'])))).toEqual(['q1'])
  })

  test('a section holds only the questions of its own type', () => {
    const exam = examOf([multipleChoice('q1', ['a']), open('o1')])
    const version = versionOf(['q1', 'o1'])
    expect(ids(questionsInSection(exam, version, 'multiple-choice'))).toEqual(['q1'])
    expect(ids(questionsInSection(exam, version, 'open'))).toEqual(['o1'])
  })

  test('a question is found by id', () => {
    const exam = examOf([multipleChoice('q1', ['a'])])
    expect(questionById(exam, 'q1')?.id).toBe('q1')
    expect(questionById(exam, 'nope')).toBeUndefined()
  })
})

describe('choice ordering', () => {
  const question = multipleChoice('q1', ['c1', 'c2', 'c3'], 'c1')

  test('choices render in the version ordering', () => {
    const version = versionOf(['q1'], { q1: ['c3', 'c1', 'c2'] })
    expect(orderedChoices(question, version).map((c) => c.id)).toEqual(['c3', 'c1', 'c2'])
  })

  test('with no ordering recorded, choices render in authoring order', () => {
    expect(orderedChoices(question, versionOf(['q1'])).map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
  })

  test('a choice missing from the ordering is appended to the end', () => {
    const version = versionOf(['q1'], { q1: ['c3', 'c1'] })
    expect(orderedChoices(question, version).map((c) => c.id)).toEqual(['c3', 'c1', 'c2'])
  })

  test('an ordering id with no matching choice is ignored', () => {
    const version = versionOf(['q1'], { q1: ['gone', 'c2', 'c1', 'c3'] })
    expect(orderedChoices(question, version).map((c) => c.id)).toEqual(['c2', 'c1', 'c3'])
  })

  test('correctness travels with its choice through a reordering', () => {
    const version = versionOf(['q1'], { q1: ['c2', 'c3', 'c1'] })
    expect(orderedChoices(question, version).map((c) => c.correct)).toEqual([false, false, true])
  })

  test('an open question has no choices even if an ordering survives', () => {
    expect(orderedChoices(open('o1'), versionOf(['o1'], { o1: ['c1'] }))).toEqual([])
  })
})

describe('version ordering edits', () => {
  test('appending a question adds it to the end of the ordering, once', () => {
    const version = withQuestionAppended(versionOf(['q1']), 'q2')
    expect(version.questionOrder).toEqual(['q1', 'q2'])
    expect(withQuestionAppended(version, 'q2').questionOrder).toEqual(['q1', 'q2'])
  })

  test('removing a question drops it from the ordering and its choice ordering', () => {
    const version = withQuestionRemoved(versionOf(['q1', 'q2'], { q1: ['c1'], q2: ['c2'] }), 'q1')
    expect(version.questionOrder).toEqual(['q2'])
    expect(version.choiceOrder).toEqual({ q2: ['c2'] })
  })

  test('ordering edits do not mutate the version they are given', () => {
    const version = versionOf(['q1'], { q1: ['c1'] })
    withQuestionAppended(version, 'q2')
    withQuestionRemoved(version, 'q1')
    expect(version.questionOrder).toEqual(['q1'])
    expect(version.choiceOrder).toEqual({ q1: ['c1'] })
  })
})
