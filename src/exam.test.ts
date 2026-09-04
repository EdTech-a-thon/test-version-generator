import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_COLUMNS,
  choicesOf,
  columnsOf,
  createExam,
  createQuestion,
  createVersion,
  duplicateQuestion,
  nextVersionLetter,
  moveQuestion,
  moveQuestions,
  shuffleSelectedAnswers,
  shuffleSelectedQuestions,
  orderedChoices,
  orderedQuestions,
  questionById,
  questionsInSection,
  topicsOf,
  withQuestionAppended,
  withQuestionRemoved,
  withTopicAdded,
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
    columns: 2,
  }
}

function open(id: string): Question {
  return { id, type: 'open', doc: { type: 'doc', content: [] }, columns: 2 }
}

function examOf(questions: Question[]): Exam {
  return { title: 'Test', questions }
}

function versionOf(questionOrder: string[], choiceOrder: Record<string, string[]> = {}): Version {
  return { id: 'v1', letter: 'A', questionOrder, choiceOrder }
}

const ids = (questions: Question[]) => questions.map((question) => question.id)

describe('question and version construction', () => {
  test('a new question falls back to the default answer columns', () => {
    expect(createQuestion('multiple-choice').columns).toBe(DEFAULT_COLUMNS)
    expect(createQuestion('open').columns).toBe(DEFAULT_COLUMNS)
  })

  test('a new question can be given the layout of the one it is written beside', () => {
    expect(createQuestion('multiple-choice', 4).columns).toBe(4)
  })

  test('a question stored before the setting was a plain count reads as the default', () => {
    // `'auto'` was a fourth setting once: the count was measured rather than
    // chosen. Records written then are still in browsers.
    const legacy = {
      ...createQuestion('multiple-choice'),
      columns: 'auto' as unknown as Question['columns'],
    }
    expect(columnsOf(legacy)).toBe(DEFAULT_COLUMNS)
    expect(columnsOf({ ...legacy, columns: 4 })).toBe(4)
  })

  test('a new multiple-choice question carries choices, an open one does not', () => {
    expect(orderedChoices(createQuestion('multiple-choice'), createVersion())).not.toHaveLength(0)
    expect(orderedChoices(createQuestion('open'), createVersion())).toHaveLength(0)
  })

  test('a new question carries no Difficulty and no Topics', () => {
    const question = createQuestion('open')
    expect(question.difficulty).toBeUndefined()
    expect(topicsOf(question)).toEqual([])
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

  test('shuffles every selected eligible question independently without changing canonical choices', () => {
    const first = multipleChoice('q1', ['a', 'b', 'c'], 'b')
    const second = multipleChoice('q2', ['d', 'e'], 'd')
    const shortAnswer = open('o1')
    const exam = examOf([first, second, shortAnswer])
    const version = versionOf(['q1', 'q2', 'o1'])

    const shuffled = shuffleSelectedAnswers(exam, version, ['q1', 'q2', 'o1'], () => 0.99)

    expect(shuffled.choiceOrder).toEqual({ q1: ['b', 'c', 'a'], q2: ['e', 'd'] })
    expect(orderedChoices(first, shuffled).map((item) => item.correct)).toEqual([
      true,
      false,
      false,
    ])
    expect(choicesOf(first).map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(first.doc).toBe(first.doc)
  })

  test('forces a non-identity answer shuffle and skips ineligible questions', () => {
    const eligible = multipleChoice('q1', ['a', 'b'], 'a')
    const oneChoice = multipleChoice('q2', ['c'])
    const shortAnswer = open('o1')
    const exam = examOf([eligible, oneChoice, shortAnswer])
    const version = versionOf(['q1', 'q2', 'o1'])

    expect(shuffleSelectedAnswers(exam, version, ['q1'], () => 0).choiceOrder).toEqual({
      q1: ['b', 'a'],
    })
    expect(shuffleSelectedAnswers(exam, version, ['q2', 'o1'], () => 0)).toBe(version)
  })
})

describe('version ordering edits', () => {
  test('moves a question to a specific position within its derived section', () => {
    const exam = examOf([
      multipleChoice('q1', ['a']),
      multipleChoice('q2', ['a']),
      multipleChoice('q3', ['a']),
      open('o1'),
    ])
    const version = versionOf(['q1', 'q2', 'q3', 'o1'])

    const moved = moveQuestion(exam, version, 'q3', 'q1', 'before')

    expect(moved.questionOrder).toEqual(['q3', 'q1', 'q2', 'o1'])
  })

  test('refuses to move a question into another derived section', () => {
    const exam = examOf([multipleChoice('q1', ['a']), open('o1')])
    const version = versionOf(['q1', 'o1'])

    expect(moveQuestion(exam, version, 'q1', 'o1', 'after')).toBe(version)
  })

  test('moves selected questions as one block and preserves their relative order', () => {
    const exam = examOf(['q1', 'q2', 'q3', 'q4'].map((id) => multipleChoice(id, ['a'])))
    const version = versionOf(['q1', 'q2', 'q3', 'q4'])

    expect(
      moveQuestions(exam, version, ['q2', 'q3'], 'q4', 'after').questionOrder,
    ).toEqual(['q1', 'q4', 'q2', 'q3'])
  })

  test('a mixed selection moves only questions in the target section', () => {
    const exam = examOf([
      multipleChoice('q1', ['a']),
      multipleChoice('q2', ['a']),
      multipleChoice('q3', ['a']),
      open('o1'),
    ])
    const version = versionOf(['q1', 'q2', 'q3', 'o1'])

    expect(
      moveQuestions(exam, version, ['q1', 'o1'], 'q3', 'after').questionOrder,
    ).toEqual(['q2', 'q3', 'q1', 'o1'])
  })

  test('shuffles selected questions only within their existing section positions', () => {
    const exam = examOf([
      multipleChoice('m1', ['a']),
      multipleChoice('m2', ['a']),
      multipleChoice('m3', ['a']),
      open('o1'),
      open('o2'),
      open('o3'),
    ])
    const version = versionOf(['m1', 'm2', 'm3', 'o1', 'o2', 'o3'])

    const shuffled = shuffleSelectedQuestions(
      exam,
      version,
      ['m1', 'm3', 'o1', 'o3'],
      () => 0.99,
    )

    expect(shuffled.questionOrder).toEqual(['m3', 'm2', 'm1', 'o3', 'o2', 'o1'])
  })

  test('forces a non-identity permutation and leaves ineligible selections alone', () => {
    const exam = examOf([
      multipleChoice('m1', ['a']),
      multipleChoice('m2', ['a']),
      open('o1'),
    ])
    const version = versionOf(['m1', 'm2', 'o1'])

    expect(
      shuffleSelectedQuestions(exam, version, ['m1', 'm2', 'o1'], () => 0).questionOrder,
    ).toEqual(['m2', 'm1', 'o1'])
    expect(shuffleSelectedQuestions(exam, version, ['m1', 'o1'], () => 0)).toBe(version)
  })

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

describe('duplicating a question', () => {
  test('copies the content under a new question id and new choice ids', () => {
    const original = multipleChoice('q1', ['c1', 'c2'], 'c2')
    const copy = duplicateQuestion(original)
    expect(copy.id).not.toBe(original.id)
    expect(choicesOf(copy).map((choice) => choice.correct)).toEqual([false, true])
    const copiedIds = choicesOf(copy).map((choice) => choice.id)
    expect(copiedIds).not.toContain('c1')
    expect(copiedIds).not.toContain('c2')
    expect(choicesOf(original).map((choice) => choice.id)).toEqual(['c1', 'c2'])
  })

  test('keeps the type and the column setting', () => {
    const original: Question = {
      ...multipleChoice('q1', ['c1', 'c2']),
      type: 'open',
      columns: 4,
    }
    const copy = duplicateQuestion(original)
    expect(copy).toMatchObject({ type: 'open', columns: 4 })
  })

  test('keeps the Difficulty and the Topics, without sharing the Topic list', () => {
    const original: Question = {
      ...multipleChoice('q1', ['c1', 'c2']),
      difficulty: 'hard',
      topics: ['Algebra', 'Geometry'],
    }
    const copy = duplicateQuestion(original)
    expect(copy.difficulty).toBe('hard')
    expect(topicsOf(copy)).toEqual(['Algebra', 'Geometry'])
    expect(copy.topics).not.toBe(original.topics)
  })
})

describe('Difficulty and Topics', () => {
  test('reads a question stored before Topics existed as untagged', () => {
    const { topics, ...untagged } = { ...createQuestion('open'), topics: ['Algebra'] }
    expect(topics).toEqual(['Algebra'])
    expect(topicsOf(untagged)).toEqual([])
  })

  test('commits a Topic with its surrounding whitespace trimmed', () => {
    expect(withTopicAdded([], '  Cell division  ')).toEqual(['Cell division'])
    expect(withTopicAdded(['Algebra'], 'Geometry')).toEqual(['Algebra', 'Geometry'])
  })

  test('ignores a Topic that is empty once trimmed', () => {
    expect(withTopicAdded(['Algebra'], '   ')).toEqual(['Algebra'])
    expect(withTopicAdded(['Algebra'], '')).toEqual(['Algebra'])
  })

  test('preserves casing and spelling rather than normalising them', () => {
    // Two spellings of one subject are two Topics: the teacher chose them, and
    // nothing here folds case, stems or corrects.
    expect(withTopicAdded(['Algebra'], 'algebra')).toEqual(['Algebra', 'algebra'])
    expect(withTopicAdded(['Photosynthesis'], 'Photosynthesis ')).toEqual([
      'Photosynthesis',
    ])
  })
})

