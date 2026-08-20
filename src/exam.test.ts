import { describe, expect, test } from 'bun:test'
import {
  choicesOf,
  createExam,
  createQuestion,
  createVersion,
  duplicateQuestion,
  nextVersionLetter,
  moveQuestion,
  orderedChoices,
  orderedQuestions,
  questionById,
  questionsInSection,
  shuffleAnswers,
  shuffleQuestions,
  withQuestionAppended,
  withQuestionRemoved,
  withTypeSwitched,
} from './exam'
import type { Exam, Question, RandomSource, Version } from './exam'
import type { ProseMirrorJSON } from './question-doc'

// A fixed sequence of draws in place of `Math.random`, so a shuffle's outcome
// is reproducible. Wraps around if a shuffle draws more than the sequence
// supplies.
function fixedRandom(sequence: number[]): RandomSource {
  let index = 0
  return () => {
    const value = sequence[index % sequence.length]!
    index += 1
    return value
  }
}

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

  test('keeps the type, the column setting and the stashed choices', () => {
    const original: Question = {
      ...multipleChoice('q1', ['c1', 'c2']),
      type: 'open',
      columns: 4,
      stashedChoices: { type: 'multipleChoice', content: [] },
    }
    const copy = duplicateQuestion(original)
    expect(copy).toMatchObject({ type: 'open', columns: 4 })
    expect(copy.stashedChoices).toEqual(original.stashedChoices!)
  })
})

describe('switching a question between multiple choice and open response', () => {
  test('switching to open moves the choices into the stash and out of the document', () => {
    const question = multipleChoice('q1', ['c1', 'c2'], 'c1')
    const switched = withTypeSwitched(question, 'open')
    expect(switched.type).toBe('open')
    expect(choicesOf(switched)).toEqual([])
    expect(switched.stashedChoices).toBeDefined()
    expect(
      (switched.stashedChoices as { content: { attrs: { id: string } }[] }).content.map(
        (choice) => choice.attrs.id,
      ),
    ).toEqual(['c1', 'c2'])
  })

  test('switching back restores the stashed choices, including which one was correct', () => {
    const question = multipleChoice('q1', ['c1', 'c2', 'c3'], 'c2')
    const open = withTypeSwitched(question, 'open')
    const restored = withTypeSwitched(open, 'multiple-choice')
    expect(restored.type).toBe('multiple-choice')
    expect(choicesOf(restored)).toEqual(choicesOf(question))
  })

  test('restoring the stash keeps choice ids stable so a version ordering still lines up', () => {
    const question = multipleChoice('q1', ['c1', 'c2'], 'c1')
    const version = versionOf(['q1'], { q1: ['c2', 'c1'] })
    const restored = withTypeSwitched(withTypeSwitched(question, 'open'), 'multiple-choice')
    expect(orderedChoices(restored, version).map((choice) => choice.id)).toEqual(['c2', 'c1'])
  })

  test('switching to open twice does not accumulate history — the stash is replaced, not appended', () => {
    const question = multipleChoice('q1', ['c1', 'c2'], 'c1')
    const firstOpen = withTypeSwitched(question, 'open')
    // Restore, then edit the choices before stashing again — as a teacher would
    // after reconsidering.
    const restored = withTypeSwitched(firstOpen, 'multiple-choice')
    const edited = { ...restored, doc: multipleChoice('q1', ['c3', 'c4'], 'c4').doc }
    const secondOpen = withTypeSwitched(edited, 'open')
    expect(
      (secondOpen.stashedChoices as { content: { attrs: { id: string } }[] }).content.map(
        (choice) => choice.attrs.id,
      ),
    ).toEqual(['c3', 'c4'])
  })

  test('switching to multiple choice with no prior stash starts a fresh set of choices', () => {
    const question = open('o1')
    const switched = withTypeSwitched(question, 'multiple-choice')
    expect(switched.type).toBe('multiple-choice')
    expect(choicesOf(switched).length).toBeGreaterThan(0)
  })

  test('the stash is cleared once restored — it exists only while the question is open', () => {
    const question = multipleChoice('q1', ['c1', 'c2'], 'c1')
    const restored = withTypeSwitched(withTypeSwitched(question, 'open'), 'multiple-choice')
    expect(restored.stashedChoices).toBeUndefined()
  })

  test('switching to the type a question already is returns it unchanged', () => {
    const mc = multipleChoice('q1', ['c1', 'c2'], 'c1')
    const openQuestion = open('o1')
    expect(withTypeSwitched(mc, 'multiple-choice')).toBe(mc)
    expect(withTypeSwitched(openQuestion, 'open')).toBe(openQuestion)
  })
})

describe('shuffleQuestions', () => {
  function exam5() {
    return examOf([
      multipleChoice('q1', ['a']),
      multipleChoice('q2', ['a']),
      multipleChoice('q3', ['a']),
      open('o1'),
      open('o2'),
    ])
  }

  test('is a permutation of the same ids, with nothing lost or duplicated', () => {
    const exam = exam5()
    const version = versionOf(['q1', 'q2', 'q3', 'o1', 'o2'])
    const result = shuffleQuestions(exam, version, 'all', fixedRandom([0.9, 0.1, 0.6, 0.3]))
    expect(result.questionOrder).toHaveLength(5)
    expect(new Set(result.questionOrder)).toEqual(new Set(['q1', 'q2', 'q3', 'o1', 'o2']))
  })

  test('shuffling one section leaves the other section untouched', () => {
    const exam = exam5()
    const version = versionOf(['q1', 'q2', 'q3', 'o1', 'o2'])
    const result = shuffleQuestions(exam, version, 'multiple-choice', fixedRandom([0.9, 0.1]))
    expect(ids(questionsInSection(exam, result, 'open'))).toEqual(['o1', 'o2'])
  })

  test("'all' shuffles every section, but never mixes multiple-choice and short-answer", () => {
    const exam = exam5()
    const version = versionOf(['q1', 'q2', 'q3', 'o1', 'o2'])
    const result = shuffleQuestions(exam, version, 'all', fixedRandom([0.9, 0.1, 0.6, 0.3]))
    expect(new Set(ids(questionsInSection(exam, result, 'multiple-choice')))).toEqual(
      new Set(['q1', 'q2', 'q3']),
    )
    expect(new Set(ids(questionsInSection(exam, result, 'open')))).toEqual(new Set(['o1', 'o2']))
  })

  test('question content is never modified by a shuffle', () => {
    const exam = exam5()
    const version = versionOf(['q1', 'q2', 'q3', 'o1', 'o2'])
    shuffleQuestions(exam, version, 'all', fixedRandom([0.9, 0.1, 0.6, 0.3]))
    // The exam passed in is read, not written: its own question order is
    // untouched by the call.
    expect(exam.questions.map((question) => question.id)).toEqual(['q1', 'q2', 'q3', 'o1', 'o2'])
  })

  test('a fixed random source produces a fixed ordering', () => {
    const exam = exam5()
    const version = versionOf(['q1', 'q2', 'q3', 'o1', 'o2'])
    const a = shuffleQuestions(exam, version, 'multiple-choice', fixedRandom([0.9, 0.1, 0.6]))
    const b = shuffleQuestions(exam, version, 'multiple-choice', fixedRandom([0.9, 0.1, 0.6]))
    expect(a.questionOrder).toEqual(b.questionOrder)
  })

  test('a question missing from the version is still included exactly once, appended to its section', () => {
    const exam = exam5()
    const version = versionOf(['q1', 'o1']) // q2, q3, o2 were added since this version was saved
    const result = shuffleQuestions(exam, version, 'multiple-choice', fixedRandom([0.9]))
    expect(new Set(ids(questionsInSection(exam, result, 'multiple-choice')))).toEqual(
      new Set(['q1', 'q2', 'q3']),
    )
  })
})

describe('shuffleAnswers', () => {
  test('is a permutation of the same choice ids, with nothing lost or duplicated', () => {
    const exam = examOf([multipleChoice('q1', ['a', 'b', 'c', 'd'], 'c')])
    const version = versionOf(['q1'])
    const result = shuffleAnswers(exam, version, ['q1'], fixedRandom([0.9, 0.1, 0.5]))
    expect(result.choiceOrder.q1).toHaveLength(4)
    expect(new Set(result.choiceOrder.q1)).toEqual(new Set(['a', 'b', 'c', 'd']))
  })

  test('unselected questions are untouched', () => {
    const exam = examOf([
      multipleChoice('q1', ['a', 'b'], 'a'),
      multipleChoice('q2', ['a', 'b'], 'b'),
    ])
    const version = versionOf(['q1', 'q2'], { q2: ['a', 'b'] })
    const result = shuffleAnswers(exam, version, ['q1'], fixedRandom([0.9]))
    expect(result.choiceOrder.q2).toEqual(['a', 'b'])
  })

  test('the correct answer stays attached to its choice through the permutation', () => {
    const exam = examOf([multipleChoice('q1', ['a', 'b', 'c'], 'b')])
    const version = versionOf(['q1'])
    const result = shuffleAnswers(exam, version, ['q1'], fixedRandom([0.9, 0.4]))
    const question = questionById(exam, 'q1')!
    const shuffledChoices = orderedChoices(question, result)
    expect(shuffledChoices.find((choice) => choice.correct)?.id).toBe('b')
  })

  test('choice letters follow the new order — the letter shown is the position on this paper', () => {
    const exam = examOf([multipleChoice('q1', ['a', 'b', 'c'])])
    const version = versionOf(['q1'])
    const result = shuffleAnswers(exam, version, ['q1'], fixedRandom([0.9, 0.4]))
    // orderedChoices returns choices in this version's order; the letter a
    // student sees is that position, so asserting the order asserts the
    // letters too.
    expect(result.choiceOrder.q1).toEqual(
      orderedChoices(questionById(exam, 'q1')!, result).map((choice) => choice.id),
    )
  })

  test('a selected open question is skipped safely and gets no choiceOrder entry', () => {
    const exam = examOf([open('o1')])
    const version = versionOf(['o1'])
    const result = shuffleAnswers(exam, version, ['o1'], fixedRandom([0.9]))
    expect(result.choiceOrder.o1).toBeUndefined()
  })

  test('a fixed random source produces a fixed ordering', () => {
    const exam = examOf([multipleChoice('q1', ['a', 'b', 'c', 'd'])])
    const version = versionOf(['q1'])
    const a = shuffleAnswers(exam, version, ['q1'], fixedRandom([0.9, 0.2, 0.6]))
    const b = shuffleAnswers(exam, version, ['q1'], fixedRandom([0.9, 0.2, 0.6]))
    expect(a.choiceOrder.q1).toEqual(b.choiceOrder.q1)
  })

  test('question content is never modified by a shuffle', () => {
    const exam = examOf([multipleChoice('q1', ['a', 'b', 'c'], 'b')])
    const version = versionOf(['q1'])
    const before = structuredClone(exam)
    shuffleAnswers(exam, version, ['q1'], fixedRandom([0.9]))
    expect(exam).toEqual(before)
  })
})
