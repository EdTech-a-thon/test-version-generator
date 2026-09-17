import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_COLUMNS,
  SECTION_ORDER,
  choicesOf,
  columnsOf,
  createExam,
  createQuestion,
  createArrangement,
  duplicateQuestion,
  nextArrangementLetter,
  moveQuestion,
  moveQuestions,
  shuffleSelectedAnswers,
  shuffleSelectedQuestions,
  orderedChoices,
  orderedQuestions,
  promptsOf,
  questionById,
  questionsInSection,
  topicsOf,
  withQuestionAppended,
  withQuestionRemoved,
  withTopicAdded,
} from './exam'
import type { Exam, Question, Arrangement } from './exam'
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

function trueFalse(id: string, correct: 'true' | 'false' = 'true'): Question {
  return {
    id,
    type: 'true-false',
    doc: {
      type: 'doc',
      content: [
        { type: 'paragraph' },
        {
          type: 'multipleChoice',
          content: [
            choice(`${id}-t`, correct === 'true'),
            choice(`${id}-f`, correct === 'false'),
          ],
        },
      ],
    },
    columns: 2,
  }
}

function open(id: string): Question {
  return { id, type: 'open', doc: { type: 'doc', content: [] }, columns: 2 }
}

// A matching set whose prompts name answers by id: `matches` is each prompt's
// answer id in prompt order, '' for an unmatched one.
function matching(id: string, matches: string[], bankIds: string[]): Question {
  return {
    id,
    type: 'matching',
    doc: {
      type: 'doc',
      content: [
        { type: 'paragraph' },
        {
          type: 'matching',
          content: [
            ...matches.map((answer, index) => ({
              type: 'matchingPrompt',
              attrs: { id: `${id}-p${index + 1}`, answer },
              content: [{ type: 'paragraph' }],
            })),
            ...bankIds.map((bankId) => ({
              type: 'matchingAnswer',
              attrs: { id: bankId },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: bankId }] }],
            })),
          ],
        },
      ],
    },
    columns: 2,
  }
}

function examOf(questions: Question[]): Exam {
  return { title: 'Test', questions }
}

function arrangementOf(questionOrder: string[], choiceOrder: Record<string, string[]> = {}): Arrangement {
  return { id: 'v1', letter: 'A', questionOrder, choiceOrder }
}

const ids = (questions: Question[]) => questions.map((question) => question.id)

describe('question and arrangement construction', () => {
  test('a new question falls back to the default answer columns', () => {
    expect(createQuestion('multiple-choice').columns).toBe(DEFAULT_COLUMNS)
    expect(createQuestion('open').columns).toBe(DEFAULT_COLUMNS)
  })

  test('a new true/false question opens with the fixed pair, nothing marked correct', () => {
    const question = createQuestion('true-false')
    expect(question.type).toBe('true-false')
    const answers = choicesOf(question)
    expect(answers).toHaveLength(2)
    expect(
      answers.map((answer) => (answer.node.content as ProseMirrorJSON[])[0]),
    ).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'True' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'False' }] },
    ])
    // Which one is true is the teacher's to say, so a fresh question states
    // neither rather than guessing.
    expect(answers.every((answer) => !answer.correct)).toBe(true)
    expect(new Set(answers.map((answer) => answer.id)).size).toBe(2)
  })

  test('a new matching set opens with blank items and a blank word bank, nothing matched', () => {
    const question = createQuestion('matching')
    expect(question.type).toBe('matching')
    const prompts = promptsOf(question)
    const bank = choicesOf(question)
    expect(prompts).toHaveLength(4)
    expect(bank).toHaveLength(4)
    expect(prompts.every((prompt) => prompt.answerId === '')).toBe(true)
    // A Word Bank answer is never correct on its own.
    expect(bank.every((answer) => !answer.correct)).toBe(true)
    expect(new Set([...prompts, ...bank].map((cell) => cell.id)).size).toBe(8)
    // Only a matching set has prompts.
    expect(promptsOf(createQuestion('multiple-choice'))).toEqual([])
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
    expect(orderedChoices(createQuestion('multiple-choice'), createArrangement())).not.toHaveLength(0)
    expect(orderedChoices(createQuestion('open'), createArrangement())).toHaveLength(0)
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

  test('arrangement letters are allocated A, B, C', () => {
    expect(nextArrangementLetter([])).toBe('A')
    expect(nextArrangementLetter([createArrangement('A')])).toBe('B')
    expect(nextArrangementLetter([createArrangement('A'), createArrangement('B')])).toBe('C')
  })
})

describe('question ordering', () => {
  test('questions render in the arrangement ordering', () => {
    const exam = examOf([multipleChoice('q1', ['a']), multipleChoice('q2', ['a']), multipleChoice('q3', ['a'])])
    expect(ids(orderedQuestions(exam, arrangementOf(['q3', 'q1', 'q2'])))).toEqual(['q3', 'q1', 'q2'])
  })

  test('sections are ordered multiple choice first, then short answer', () => {
    const exam = examOf([open('o1'), multipleChoice('q1', ['a'])])
    expect(ids(orderedQuestions(exam, arrangementOf(['o1', 'q1'])))).toEqual(['q1', 'o1'])
  })

  test('matching prints after true/false and before short answer', () => {
    expect(SECTION_ORDER).toEqual(['multiple-choice', 'true-false', 'matching', 'open'])
    const exam = examOf([open('o1'), matching('x1', [''], ['a', 'b']), multipleChoice('q1', ['a'])])
    expect(ids(orderedQuestions(exam, arrangementOf(['o1', 'x1', 'q1'])))).toEqual(['q1', 'x1', 'o1'])
  })

  test('a question missing from the ordering is appended to the end of its section', () => {
    const exam = examOf([multipleChoice('q1', ['a']), open('o1'), multipleChoice('q2', ['a']), open('o2')])
    // Only q1 and o1 were in the ordering when this arrangement was saved.
    expect(ids(orderedQuestions(exam, arrangementOf(['o1', 'q1'])))).toEqual(['q1', 'q2', 'o1', 'o2'])
  })

  test('an ordering id with no matching question is ignored', () => {
    const exam = examOf([multipleChoice('q1', ['a'])])
    expect(ids(orderedQuestions(exam, arrangementOf(['gone', 'q1'])))).toEqual(['q1'])
  })

  test('a section holds only the questions of its own type', () => {
    const exam = examOf([multipleChoice('q1', ['a']), open('o1')])
    const arrangement = arrangementOf(['q1', 'o1'])
    expect(ids(questionsInSection(exam, arrangement, 'multiple-choice'))).toEqual(['q1'])
    expect(ids(questionsInSection(exam, arrangement, 'open'))).toEqual(['o1'])
  })

  test('a question is found by id', () => {
    const exam = examOf([multipleChoice('q1', ['a'])])
    expect(questionById(exam, 'q1')?.id).toBe('q1')
    expect(questionById(exam, 'nope')).toBeUndefined()
  })
})

describe('choice ordering', () => {
  const question = multipleChoice('q1', ['c1', 'c2', 'c3'], 'c1')

  test('choices render in the arrangement ordering', () => {
    const arrangement = arrangementOf(['q1'], { q1: ['c3', 'c1', 'c2'] })
    expect(orderedChoices(question, arrangement).map((c) => c.id)).toEqual(['c3', 'c1', 'c2'])
  })

  test('with no ordering recorded, choices render in authoring order', () => {
    expect(orderedChoices(question, arrangementOf(['q1'])).map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
  })

  test('a choice missing from the ordering is appended to the end', () => {
    const arrangement = arrangementOf(['q1'], { q1: ['c3', 'c1'] })
    expect(orderedChoices(question, arrangement).map((c) => c.id)).toEqual(['c3', 'c1', 'c2'])
  })

  test('an ordering id with no matching choice is ignored', () => {
    const arrangement = arrangementOf(['q1'], { q1: ['gone', 'c2', 'c1', 'c3'] })
    expect(orderedChoices(question, arrangement).map((c) => c.id)).toEqual(['c2', 'c1', 'c3'])
  })

  test('correctness travels with its choice through a reordering', () => {
    const arrangement = arrangementOf(['q1'], { q1: ['c2', 'c3', 'c1'] })
    expect(orderedChoices(question, arrangement).map((c) => c.correct)).toEqual([false, false, true])
  })

  test('an open question has no choices even if an ordering survives', () => {
    expect(orderedChoices(open('o1'), arrangementOf(['o1'], { o1: ['c1'] }))).toEqual([])
  })

  test('shuffles every selected eligible question independently without changing canonical choices', () => {
    const first = multipleChoice('q1', ['a', 'b', 'c'], 'b')
    const second = multipleChoice('q2', ['d', 'e'], 'd')
    const shortAnswer = open('o1')
    const exam = examOf([first, second, shortAnswer])
    const arrangement = arrangementOf(['q1', 'q2', 'o1'])

    const shuffled = shuffleSelectedAnswers(exam, arrangement, ['q1', 'q2', 'o1'], () => 0.99)

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
    const arrangement = arrangementOf(['q1', 'q2', 'o1'])

    expect(shuffleSelectedAnswers(exam, arrangement, ['q1'], () => 0).choiceOrder).toEqual({
      q1: ['b', 'a'],
    })
    expect(shuffleSelectedAnswers(exam, arrangement, ['q2', 'o1'], () => 0)).toBe(arrangement)
  })

  test('leaves a true/false question alone: True before False is not an authored order', () => {
    const exam = examOf([trueFalse('t1'), multipleChoice('q1', ['a', 'b'], 'a')])
    const arrangement = arrangementOf(['q1', 't1'])

    expect(shuffleSelectedAnswers(exam, arrangement, ['t1'], () => 0)).toBe(arrangement)
    expect(
      shuffleSelectedAnswers(exam, arrangement, ['t1', 'q1'], () => 0).choiceOrder,
    ).toEqual({ q1: ['b', 'a'] })
  })

  test('shuffles a matching set\'s word bank, and every item still names the same answer', () => {
    const exam = examOf([matching('x1', ['b', ''], ['a', 'b', 'c'])])
    const arrangement = arrangementOf(['x1'])
    const shuffled = shuffleSelectedAnswers(exam, arrangement, ['x1'], () => 0)

    expect(shuffled.choiceOrder.x1).toEqual(['b', 'c', 'a'])
    expect(orderedChoices(exam.questions[0]!, shuffled).map((answer) => answer.id)).toEqual([
      'b',
      'c',
      'a',
    ])
    // The match is content, not arrangement: it is untouched.
    expect(promptsOf(exam.questions[0]!).map((prompt) => prompt.answerId)).toEqual(['b', ''])
  })

  test('shuffles true/false questions among their own positions, in their own section', () => {
    const exam = examOf([
      multipleChoice('q1', ['a', 'b']),
      trueFalse('t1'),
      trueFalse('t2'),
    ])
    const arrangement = arrangementOf(['q1', 't1', 't2'])
    const shuffled = shuffleSelectedQuestions(exam, arrangement, ['t1', 't2'], () => 0)

    expect(shuffled.questionOrder).toEqual(['q1', 't2', 't1'])
  })
})

describe('arrangement ordering edits', () => {
  test('moves a question to a specific position within its derived section', () => {
    const exam = examOf([
      multipleChoice('q1', ['a']),
      multipleChoice('q2', ['a']),
      multipleChoice('q3', ['a']),
      open('o1'),
    ])
    const arrangement = arrangementOf(['q1', 'q2', 'q3', 'o1'])

    const moved = moveQuestion(exam, arrangement, 'q3', 'q1', 'before')

    expect(moved.questionOrder).toEqual(['q3', 'q1', 'q2', 'o1'])
  })

  test('refuses to move a question into another derived section', () => {
    const exam = examOf([multipleChoice('q1', ['a']), open('o1')])
    const arrangement = arrangementOf(['q1', 'o1'])

    expect(moveQuestion(exam, arrangement, 'q1', 'o1', 'after')).toBe(arrangement)
  })

  test('moves selected questions as one block and preserves their relative order', () => {
    const exam = examOf(['q1', 'q2', 'q3', 'q4'].map((id) => multipleChoice(id, ['a'])))
    const arrangement = arrangementOf(['q1', 'q2', 'q3', 'q4'])

    expect(
      moveQuestions(exam, arrangement, ['q2', 'q3'], 'q4', 'after').questionOrder,
    ).toEqual(['q1', 'q4', 'q2', 'q3'])
  })

  test('a mixed selection moves only questions in the target section', () => {
    const exam = examOf([
      multipleChoice('q1', ['a']),
      multipleChoice('q2', ['a']),
      multipleChoice('q3', ['a']),
      open('o1'),
    ])
    const arrangement = arrangementOf(['q1', 'q2', 'q3', 'o1'])

    expect(
      moveQuestions(exam, arrangement, ['q1', 'o1'], 'q3', 'after').questionOrder,
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
    const arrangement = arrangementOf(['m1', 'm2', 'm3', 'o1', 'o2', 'o3'])

    const shuffled = shuffleSelectedQuestions(
      exam,
      arrangement,
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
    const arrangement = arrangementOf(['m1', 'm2', 'o1'])

    expect(
      shuffleSelectedQuestions(exam, arrangement, ['m1', 'm2', 'o1'], () => 0).questionOrder,
    ).toEqual(['m2', 'm1', 'o1'])
    expect(shuffleSelectedQuestions(exam, arrangement, ['m1', 'o1'], () => 0)).toBe(arrangement)
  })

  test('appending a question adds it to the end of the ordering, once', () => {
    const arrangement = withQuestionAppended(arrangementOf(['q1']), 'q2')
    expect(arrangement.questionOrder).toEqual(['q1', 'q2'])
    expect(withQuestionAppended(arrangement, 'q2').questionOrder).toEqual(['q1', 'q2'])
  })

  test('removing a question drops it from the ordering and its choice ordering', () => {
    const arrangement = withQuestionRemoved(arrangementOf(['q1', 'q2'], { q1: ['c1'], q2: ['c2'] }), 'q1')
    expect(arrangement.questionOrder).toEqual(['q2'])
    expect(arrangement.choiceOrder).toEqual({ q2: ['c2'] })
  })

  test('ordering edits do not mutate the arrangement they are given', () => {
    const arrangement = arrangementOf(['q1'], { q1: ['c1'] })
    withQuestionAppended(arrangement, 'q2')
    withQuestionRemoved(arrangement, 'q1')
    expect(arrangement.questionOrder).toEqual(['q1'])
    expect(arrangement.choiceOrder).toEqual({ q1: ['c1'] })
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

  test('renames a matching set\'s word bank and keeps every item matched to the same answer', () => {
    const original = matching('x1', ['b', '', 'b'], ['a', 'b'])
    const copy = duplicateQuestion(original)
    const copiedBank = choicesOf(copy).map((answer) => answer.id)
    const copiedPrompts = promptsOf(copy)

    expect(copiedBank).not.toContain('a')
    expect(copiedBank).not.toContain('b')
    expect(copiedPrompts.map((prompt) => prompt.id)).not.toContain('x1-p1')
    // What was matched to the second answer is matched to the copy's second.
    expect(copiedPrompts.map((prompt) => prompt.answerId)).toEqual([
      copiedBank[1],
      '',
      copiedBank[1],
    ])
    expect(promptsOf(original).map((prompt) => prompt.answerId)).toEqual(['b', '', 'b'])
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

