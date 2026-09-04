import { describe, expect, test } from 'bun:test'
import { createQuestion, orderedQuestions, topicsOf } from './exam'
import type { Question } from './exam'
import {
  createAuthoringState,
  createMemoryBackend,
  loadExamStore,
} from './exam-store'
import type {
  AuthoringState,
  DurableAuthoringBackend,
  ExamStore,
  SavedState,
} from './exam-store'
import { VERSIONED_STORAGE_NAME } from './indexeddb-authoring'

function memory(initial: AuthoringState | null = null) {
  return createMemoryBackend<AuthoringState>(initial)
}

async function freshStore() {
  const backend = memory()
  const savedBackend = createMemoryBackend<SavedState>()
  const store = await loadExamStore(backend, savedBackend)
  return { backend, savedBackend, store }
}

/** The ids in the Question Bank, in the order it stores them. */
const bankIds = (store: ExamStore) =>
  store.getState().questionBank.questions.map((question) => question.id)

/** The ids the Exam Draft renders, in the order they appear on the page. */
const renderedIds = (store: ExamStore) => {
  const { exam, version } = store.selectedExam()
  return orderedQuestions(exam, version).map((question) => question.id)
}

/** A store holding `count` banked questions, all of them on the Exam Draft. */
async function withExamDraft(count: number, type: Question['type'] = 'multiple-choice') {
  const { backend, savedBackend, store } = await freshStore()
  const questions: Question[] = []
  for (let index = 0; index < count; index += 1) {
    const question = createQuestion(type)
    questions.push(question)
    store.createInExamDraft(question)
  }
  await store.whenSettled()
  return { backend, savedBackend, store, questions }
}

describe('a fresh installation', () => {
  test('starts with an empty Question Bank and an empty Exam Draft', async () => {
    const { store } = await freshStore()
    const state = store.getState()
    expect(state.questionBank.questions).toEqual([])
    expect(state.examDraft.questionIds).toEqual([])
    expect(state.dirty).toBe(false)
    expect(store.selectedExam().exam.questions).toEqual([])
  })

  test('stores under new identifiers, so the earlier generation is never read', () => {
    // ADR-0009: Version History is another storage cutover. Data written by
    // both earlier authoring generations is left where it is and never read.
    expect(VERSIONED_STORAGE_NAME).not.toBe('exam-authoring-v2')
    expect(VERSIONED_STORAGE_NAME).not.toBe('exam-saved-v2')
  })

  test('ignores state stored in the earlier shape', async () => {
    const earlier = {
      exam: { title: 'Written before the cutover', questions: [createQuestion('open')] },
      versions: [{ id: 'v1', letter: 'A', questionOrder: [], choiceOrder: {} }],
      currentVersionId: 'v1',
      dirty: false,
    }
    const store = await loadExamStore(memory(earlier as unknown as AuthoringState))
    expect(store.getState().questionBank.questions).toEqual([])
    expect(store.getState().examDraft.questionIds).toEqual([])
  })

  test('falls back to an empty exam when the stored state is corrupt', async () => {
    const store = await loadExamStore(memory({ nonsense: true } as unknown as AuthoringState))
    expect(store.getState().questionBank.questions).toEqual([])
    expect(store.getState().examDraft.questionIds).toEqual([])
    expect(store.getState().dirty).toBe(false)
  })
})

describe('creating Question Content', () => {
  test('banks a question without putting it on the Exam Draft', async () => {
    const { store } = await freshStore()
    const question = createQuestion('multiple-choice')

    store.createInQuestionBank(question)

    expect(bankIds(store)).toEqual([question.id])
    expect(store.getState().examDraft.questionIds).toEqual([])
    expect(renderedIds(store)).toEqual([])
  })

  test('banks a question and puts it on the Exam Draft in one action', async () => {
    const { store } = await freshStore()
    const question = createQuestion('open')

    store.createInExamDraft(question)

    expect(bankIds(store)).toEqual([question.id])
    expect(renderedIds(store)).toEqual([question.id])
  })

  test('places a new question immediately after the one it was added below', async () => {
    const { store, questions } = await withExamDraft(2)
    const inserted = createQuestion('multiple-choice')

    store.createInExamDraft(inserted, questions[0]!.id)

    expect(renderedIds(store)).toEqual([
      questions[0]!.id,
      inserted.id,
      questions[1]!.id,
    ])
  })
})

describe('the Exam Draft references the Question Bank', () => {
  test('adds an unused bank question to the Exam Draft', async () => {
    const { store } = await freshStore()
    const question = createQuestion('open')
    store.createInQuestionBank(question)

    store.addToExamDraft(question.id)

    expect(renderedIds(store)).toEqual([question.id])
    expect(bankIds(store)).toEqual([question.id])
  })

  test('holds a question at most once, however often it is added', async () => {
    const { store, questions } = await withExamDraft(2)
    const before = store.getState()

    store.addToExamDraft(questions[0]!.id)
    store.addToExamDraft(questions[0]!.id, questions[1]!.id)

    expect(store.getState().examDraft.questionIds).toEqual([
      questions[0]!.id,
      questions[1]!.id,
    ])
    // Refused, so nothing happened at all: an add that changes nothing is not
    // an authoring action and must not cost an undo step.
    expect(store.getState()).toBe(before)
  })

  test('refuses a reference to Question Content that is not banked', async () => {
    const { store } = await freshStore()
    store.addToExamDraft('never-banked')
    expect(store.getState().examDraft.questionIds).toEqual([])
    expect(store.canUndo()).toBe(false)
  })

  test('stores references rather than copies, so an edit reaches the page', async () => {
    const { store, questions } = await withExamDraft(1, 'open')
    const edited = {
      ...questions[0]!,
      doc: { type: 'doc', content: [{ type: 'paragraph' }] },
    }

    store.updateInQuestionBank(edited)

    expect(store.selectedExam().exam.questions[0]!.doc).toEqual(edited.doc)
    expect(bankIds(store)).toEqual([questions[0]!.id])
  })

  test('edits a bank-only question without adding it to the Exam Draft', async () => {
    const { store } = await freshStore()
    const question = createQuestion('open')
    store.createInQuestionBank(question)

    store.updateInQuestionBank({
      ...question,
      doc: { type: 'doc', content: [{ type: 'paragraph' }] },
    })

    expect(store.getState().questionBank.questions[0]!.doc).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    })
    expect(store.getState().examDraft.questionIds).toEqual([])
  })

  test('banks a question it has never seen, so a save is never lost', async () => {
    const { store } = await freshStore()
    const question = createQuestion('open')

    store.updateInQuestionBank(question)

    expect(bankIds(store)).toEqual([question.id])
    expect(store.getState().examDraft.questionIds).toEqual([])
  })

  test('renders a referenced question under the Question Section for its own type', async () => {
    const { store, questions } = await withExamDraft(2)

    store.updateInQuestionBank({ ...questions[0]!, type: 'open' })

    // The Question Sections are derived, so the question keeps its place on the
    // Exam Draft and renders under Short Answer instead.
    expect(renderedIds(store)).toEqual([questions[1]!.id, questions[0]!.id])
  })
})

describe('Remove', () => {
  test('excludes a question from the Exam Draft without deleting it', async () => {
    const { store, questions } = await withExamDraft(2)

    store.removeFromExamDraft([questions[0]!.id])

    expect(renderedIds(store)).toEqual([questions[1]!.id])
    expect(bankIds(store)).toEqual(questions.map((question) => question.id))
    expect(store.getState().questionBank.questions[0]).toEqual(questions[0]!)
  })

  test('excludes a whole selection as one action', async () => {
    const { store, questions } = await withExamDraft(3)

    store.removeFromExamDraft([questions[0]!.id, questions[2]!.id])

    expect(renderedIds(store)).toEqual([questions[1]!.id])
    expect(store.canUndo()).toBe(true)
    store.undo()
    expect(renderedIds(store)).toEqual(questions.map((question) => question.id))
  })

  test('leaves a Removed question available to add again', async () => {
    const { store, questions } = await withExamDraft(1)
    store.removeFromExamDraft([questions[0]!.id])

    store.addToExamDraft(questions[0]!.id)

    expect(renderedIds(store)).toEqual([questions[0]!.id])
  })
})

describe('Insert and Replace', () => {
  test('inserts an unused bank question after a chosen Exam Draft question', async () => {
    const { store, questions } = await withExamDraft(2)
    const spare = createQuestion('multiple-choice')
    store.createInQuestionBank(spare)

    store.addToExamDraft(spare.id, questions[0]!.id)

    expect(renderedIds(store)).toEqual([questions[0]!.id, spare.id, questions[1]!.id])
  })

  test('inserts an unused bank question before a chosen Exam Draft question', async () => {
    const { store, questions } = await withExamDraft(2)
    const spare = createQuestion('multiple-choice')
    store.createInQuestionBank(spare)

    store.addToExamDraft(spare.id, questions[1]!.id, 'before')

    expect(renderedIds(store)).toEqual([questions[0]!.id, spare.id, questions[1]!.id])
  })

  test('inserts before the first question of a Question Section', async () => {
    // The only placement that cannot be expressed as "after something": the
    // top edge of the first rendered question in its section.
    const { store, questions } = await withExamDraft(2)
    const spare = createQuestion('multiple-choice')
    store.createInQuestionBank(spare)

    store.addToExamDraft(spare.id, questions[0]!.id, 'before')

    expect(renderedIds(store)).toEqual([spare.id, questions[0]!.id, questions[1]!.id])
  })

  test('inserts before a question whose Exam Draft neighbour is in the other section', async () => {
    // The Exam Draft's stored order interleaves the sections; the rendered
    // order groups them. An insertion is placed against the *rendered*
    // neighbour, so the two cannot disagree about where the question landed.
    const { store, questions } = await withExamDraft(1, 'multiple-choice')
    const shortAnswer = createQuestion('open')
    store.createInExamDraft(shortAnswer)
    const second = createQuestion('multiple-choice')
    store.createInExamDraft(second)
    const spare = createQuestion('multiple-choice')
    store.createInQuestionBank(spare)
    expect(store.getState().examDraft.questionIds).toEqual([
      questions[0]!.id,
      shortAnswer.id,
      second.id,
    ])

    store.addToExamDraft(spare.id, second.id, 'before')

    expect(renderedIds(store)).toEqual([
      questions[0]!.id,
      spare.id,
      second.id,
      shortAnswer.id,
    ])
  })

  test('refuses to insert before a question in another Question Section', async () => {
    const { store } = await withExamDraft(1, 'multiple-choice')
    const shortAnswer = createQuestion('open')
    store.createInExamDraft(shortAnswer)
    const spare = createQuestion('multiple-choice')
    store.createInQuestionBank(spare)
    const before = store.getState()

    store.addToExamDraft(spare.id, shortAnswer.id, 'before')

    expect(store.getState()).toBe(before)
  })

  test('refuses to insert into another Question Section', async () => {
    const { store, questions } = await withExamDraft(2, 'multiple-choice')
    const shortAnswer = createQuestion('open')
    store.createInQuestionBank(shortAnswer)
    const before = store.getState()

    store.addToExamDraft(shortAnswer.id, questions[0]!.id)

    expect(store.getState()).toBe(before)
  })

  test('replaces one Exam Draft question with an unused bank question in its place', async () => {
    const { store, questions } = await withExamDraft(3)
    const spare = createQuestion('multiple-choice')
    store.createInQuestionBank(spare)

    store.replaceInExamDraft(questions[1]!.id, spare.id)

    expect(renderedIds(store)).toEqual([questions[0]!.id, spare.id, questions[2]!.id])
  })

  test('leaves the replaced question in the Question Bank, unchanged', async () => {
    const { store, questions } = await withExamDraft(1)
    const spare = createQuestion('multiple-choice')
    store.createInQuestionBank(spare)

    store.replaceInExamDraft(questions[0]!.id, spare.id)

    expect(bankIds(store)).toEqual([questions[0]!.id, spare.id])
    expect(store.getState().questionBank.questions[0]).toEqual(questions[0]!)
    // Replaced out, so it is available to compose with again.
    store.addToExamDraft(questions[0]!.id)
    expect(renderedIds(store)).toEqual([spare.id, questions[0]!.id])
  })

  test('refuses a Replace across Question Sections, or one that would duplicate', async () => {
    const { store, questions } = await withExamDraft(2, 'multiple-choice')
    const shortAnswer = createQuestion('open')
    store.createInQuestionBank(shortAnswer)
    const before = store.getState()

    store.replaceInExamDraft(questions[0]!.id, shortAnswer.id)
    store.replaceInExamDraft(questions[0]!.id, questions[1]!.id)
    store.replaceInExamDraft(questions[0]!.id, 'never-banked')
    store.replaceInExamDraft('not-on-the-exam', shortAnswer.id)

    expect(store.getState()).toBe(before)
    expect(store.canUndo()).toBe(true)
  })

  test('each is exactly one undo step', async () => {
    const { store, questions } = await withExamDraft(2)
    const spare = createQuestion('multiple-choice')
    store.createInQuestionBank(spare)

    store.replaceInExamDraft(questions[0]!.id, spare.id)
    store.undo()

    expect(renderedIds(store)).toEqual([questions[0]!.id, questions[1]!.id])
    expect(bankIds(store)).toEqual([questions[0]!.id, questions[1]!.id, spare.id])

    store.redo()
    expect(renderedIds(store)).toEqual([spare.id, questions[1]!.id])
  })
})

describe('replacing selected questions with Equivalent Questions', () => {
  test('replaces exact matches at their occupied positions and reports the batch', async () => {
    const { store } = await freshStore()
    const selected = [
      { ...createQuestion('multiple-choice'), difficulty: 'hard' as const, topics: ['Cells'] },
      { ...createQuestion('multiple-choice'), difficulty: 'easy' as const, topics: ['Plants'] },
    ]
    const equivalent = {
      ...createQuestion('multiple-choice'),
      difficulty: 'hard' as const,
      topics: ['Cells'],
    }
    for (const question of selected) store.createInExamDraft(question)
    store.createInQuestionBank(equivalent)

    const result = store.replaceWithEquivalentQuestions(selected.map(({ id }) => id))

    expect(result).toEqual({ replaced: 1, unmatched: 1 })
    expect(renderedIds(store)).toEqual([equivalent.id, selected[1]!.id])
    store.undo()
    expect(renderedIds(store)).toEqual(selected.map(({ id }) => id))
  })

  test('uses restrictive exact metadata pools and consumes each candidate once', async () => {
    const { store } = await freshStore()
    const algebra = [
      { ...createQuestion('multiple-choice'), difficulty: 'hard' as const, topics: ['Algebra'] },
      { ...createQuestion('multiple-choice'), difficulty: 'hard' as const, topics: ['Algebra'] },
    ]
    const cells = {
      ...createQuestion('multiple-choice'),
      topics: ['Cells', 'Mitosis'],
    }
    const untagged = { ...createQuestion('multiple-choice'), difficulty: 'hard' as const }
    const alreadyInDraft = {
      ...createQuestion('multiple-choice'),
      difficulty: 'hard' as const,
      topics: ['Algebra'],
    }
    for (const question of [...algebra, cells, untagged, alreadyInDraft]) {
      store.createInExamDraft(question)
    }

    const algebraCandidate = {
      ...createQuestion('multiple-choice'),
      difficulty: 'hard' as const,
      topics: ['Algebra'],
    }
    const cellsCandidate = {
      ...createQuestion('multiple-choice'),
      topics: ['Mitosis', 'Cells'],
    }
    const nearMisses: Question[] = [
      { ...createQuestion('multiple-choice'), difficulty: 'hard', topics: ['algebra'] },
      { ...createQuestion('multiple-choice'), difficulty: 'easy', topics: ['Algebra'] },
      { ...createQuestion('open'), difficulty: 'hard', topics: ['Algebra'] },
      { ...createQuestion('multiple-choice'), difficulty: 'hard' },
    ]
    for (const question of [algebraCandidate, cellsCandidate, ...nearMisses]) {
      store.createInQuestionBank(question)
    }

    const result = store.replaceWithEquivalentQuestions([
      algebra[0]!.id,
      algebra[1]!.id,
      cells.id,
      untagged.id,
    ])

    expect(result).toEqual({ replaced: 2, unmatched: 2 })
    expect(renderedIds(store)).toEqual([
      algebraCandidate.id,
      algebra[1]!.id,
      cellsCandidate.id,
      untagged.id,
      alreadyInDraft.id,
    ])
    expect(new Set(renderedIds(store)).size).toBe(5)
  })

  test('matches against the latest Question Bank state and leaves outgoing records banked', async () => {
    const { store } = await freshStore()
    const outgoing = {
      ...createQuestion('multiple-choice'),
      difficulty: 'medium' as const,
      topics: ['Geometry'],
    }
    const candidate = {
      ...createQuestion('multiple-choice'),
      difficulty: 'easy' as const,
      topics: ['Arithmetic'],
    }
    store.createInExamDraft(outgoing)
    store.createInQuestionBank(candidate)
    store.updateInQuestionBank({
      ...candidate,
      difficulty: 'medium',
      topics: ['Geometry'],
    })

    expect(store.replaceWithEquivalentQuestions([outgoing.id])).toEqual({
      replaced: 1,
      unmatched: 0,
    })
    expect(bankIds(store)).toEqual([outgoing.id, candidate.id])
    expect(store.selectedExam().version.choiceOrder[candidate.id]).toBeUndefined()
  })
})

describe('classifying a question', () => {
  test('saves Difficulty and Topics as one authoring action', async () => {
    const { store, questions, backend } = await withExamDraft(1)

    store.updateInQuestionBank({
      ...questions[0]!,
      difficulty: 'hard',
      topics: ['Cell division'],
    })
    await store.whenSettled()

    const banked = store.getState().questionBank.questions[0]!
    expect(banked.difficulty).toBe('hard')
    expect(topicsOf(banked)).toEqual(['Cell division'])
    expect(store.getState().dirty).toBe(true)
    expect(backend.value?.questionBank.questions[0]?.difficulty).toBe('hard')

    store.undo()
    expect(store.getState().questionBank.questions[0]!.difficulty).toBeUndefined()
  })

  test('classifies a bank-only question without putting it on the Exam Draft', async () => {
    const { store } = await freshStore()
    const question = createQuestion('open')
    store.createInQuestionBank(question)

    store.updateInQuestionBank({ ...question, difficulty: 'easy', topics: ['Algebra'] })

    expect(store.getState().examDraft.questionIds).toEqual([])
    expect(topicsOf(store.getState().questionBank.questions[0]!)).toEqual(['Algebra'])
  })
})

describe('moving a reference', () => {
  test('moves one question to an exact position on the Exam Draft', async () => {
    const { store, questions } = await withExamDraft(3)

    store.moveInExamDraft([questions[2]!.id], questions[0]!.id, 'before')

    expect(renderedIds(store)).toEqual([
      questions[2]!.id,
      questions[0]!.id,
      questions[1]!.id,
    ])
  })

  test('moves a selection as one block, preserving its order', async () => {
    const { store, questions } = await withExamDraft(4)

    store.moveInExamDraft(
      [questions[0]!.id, questions[1]!.id],
      questions[3]!.id,
      'after',
    )

    expect(renderedIds(store)).toEqual([
      questions[2]!.id,
      questions[3]!.id,
      questions[0]!.id,
      questions[1]!.id,
    ])
  })

  test('refuses to move a question into another Question Section', async () => {
    const { store } = await freshStore()
    const multipleChoice = createQuestion('multiple-choice')
    const shortAnswer = createQuestion('open')
    store.createInExamDraft(multipleChoice)
    store.createInExamDraft(shortAnswer)

    store.moveInExamDraft([shortAnswer.id], multipleChoice.id, 'before')

    expect(renderedIds(store)).toEqual([multipleChoice.id, shortAnswer.id])
  })

  test('a move that changes nothing is not an authoring action', async () => {
    const { store, questions } = await withExamDraft(2)
    const before = store.getState()

    store.moveInExamDraft([questions[0]!.id], questions[1]!.id, 'before')

    expect(store.getState()).toBe(before)
    // Nothing was recorded, so undo reaches past it to the last real action.
    store.undo()
    expect(renderedIds(store)).toEqual([questions[0]!.id])
  })
})

describe('shuffling selected questions', () => {
  test('shuffles the selected scope within each Question Section as one undo step', async () => {
    const { store } = await freshStore()
    const multipleChoice = [
      createQuestion('multiple-choice'),
      createQuestion('multiple-choice'),
      createQuestion('multiple-choice'),
    ]
    const shortAnswer = [createQuestion('open'), createQuestion('open')]
    for (const question of [
      multipleChoice[0]!,
      shortAnswer[0]!,
      multipleChoice[1]!,
      shortAnswer[1]!,
      multipleChoice[2]!,
    ]) {
      store.createInExamDraft(question)
    }

    store.shuffleSelectedQuestions([
      multipleChoice[0]!.id,
      multipleChoice[2]!.id,
      shortAnswer[0]!.id,
      shortAnswer[1]!.id,
    ])

    const shuffled = renderedIds(store)
    expect(shuffled.slice(0, 3)).toEqual([
      multipleChoice[2]!.id,
      multipleChoice[1]!.id,
      multipleChoice[0]!.id,
    ])
    expect(shuffled.slice(3)).toEqual([shortAnswer[1]!.id, shortAnswer[0]!.id])
    store.undo()
    expect(renderedIds(store)).toEqual([
      ...multipleChoice.map((question) => question.id),
      ...shortAnswer.map((question) => question.id),
    ])
  })

  test('does not record an action when no section has two selected questions', async () => {
    const { store, questions } = await withExamDraft(2)
    const before = store.getState()

    store.shuffleSelectedQuestions([questions[0]!.id])

    expect(store.getState()).toBe(before)
  })
})

describe('duplicating', () => {
  test('banks a copy and places it after the original', async () => {
    const { store, questions } = await withExamDraft(2)

    store.duplicateInExamDraft(questions[0]!.id)

    const copyId = renderedIds(store)[1]!
    expect(copyId).not.toBe(questions[0]!.id)
    expect(renderedIds(store)).toEqual([questions[0]!.id, copyId, questions[1]!.id])
    expect(bankIds(store)).toHaveLength(3)
  })
})

describe('the dirty flag and persistence', () => {
  test('Save does not overwrite authoring work made while an earlier write settles', async () => {
    let working: AuthoringState | null = null
    let saved: SavedState | null = null
    let releaseFirstWrite = () => undefined
    let firstWrite = true
    let queued = Promise.resolve()
    const schedule = (operation: () => Promise<void> | void) => {
      const result = queued.then(operation)
      queued = result.catch(() => undefined)
      return result
    }
    const backend: DurableAuthoringBackend = {
      read: async () => working,
      readSaved: async () => saved,
      write: (value) =>
        schedule(async () => {
          if (firstWrite) {
            firstWrite = false
            await new Promise<void>((resolve) => {
              releaseFirstWrite = resolve
            })
          }
          working = structuredClone(value)
        }),
      commitSaved: (value) =>
        schedule(() => {
          saved = structuredClone(value)
          working = { ...structuredClone(value), dirty: false }
        }),
    }
    const store = await loadExamStore(backend)
    const first = createQuestion('multiple-choice')
    const addedWhileSaving = createQuestion('open')
    store.createInExamDraft(first)
    await Promise.resolve()

    const saving = store.save()
    store.createInQuestionBank(addedWhileSaving)
    releaseFirstWrite()
    await saving
    await store.whenSettled()

    const reloaded = await loadExamStore(backend)
    expect(bankIds(reloaded)).toEqual([first.id, addedWhileSaving.id])
    expect(renderedIds(reloaded)).toEqual([first.id])
  })

  test('every authoring action raises the dirty flag', async () => {
    const cases: Array<(store: ExamStore, question: Question) => void> = [
      (store) => store.setTitle('Chem Unit 3'),
      (store) => store.createInQuestionBank(createQuestion('open')),
      (store) => store.createInExamDraft(createQuestion('open')),
      (store, question) => store.updateInQuestionBank({ ...question, columns: 2 }),
      (store, question) => store.setQuestionColumns([question.id], 4),
      (store, question) => store.duplicateInExamDraft(question.id),
      (store, question) => store.removeFromExamDraft([question.id]),
    ]
    for (const act of cases) {
      const { store, questions } = await withExamDraft(1)
      await store.save()
      expect(store.getState().dirty).toBe(false)
      act(store, questions[0]!)
      expect(store.getState().dirty).toBe(true)
    }
  })

  test('a change that changes nothing costs no undo step, dirty flag, or write', async () => {
    // The store's one-action invariant cuts both ways: an action that leaves
    // the state exactly as it found it is not an action. Setting the title it
    // already has, or the column count already in force, must not hand the
    // teacher an undo step that appears to do nothing.
    const cases: Array<(store: ExamStore, question: Question) => void> = [
      (store) => store.setTitle('Chem Unit 3'),
      (store, question) => store.setQuestionColumns([question.id], 4),
    ]
    for (const act of cases) {
      const { backend, store, questions } = await withExamDraft(1)
      await store.save()
      const before = store.getState()

      act(store, questions[0]!)
      await store.save()
      const changed = store.getState()
      const writes = backend.writes

      // The same action again, with nothing left for it to do.
      act(store, questions[0]!)
      await store.whenSettled()

      expect(store.getState()).toBe(changed)
      expect(store.getState().dirty).toBe(false)
      expect(backend.writes).toBe(writes)

      // One undo steps past the real change, not a phantom one.
      store.undo()
      expect(store.getState()).toBe(before)
    }
  })

  test('adding a bank-only question to the Exam Draft raises the dirty flag', async () => {
    const { store } = await freshStore()
    const question = createQuestion('open')
    store.createInQuestionBank(question)
    await store.save()

    store.addToExamDraft(question.id)

    expect(store.getState().dirty).toBe(true)
  })

  test('a refresh restores the Question Bank, the Exam Draft and the dirty flag', async () => {
    const { backend, store, questions } = await withExamDraft(2)
    const bankOnly = createQuestion('open')
    store.createInQuestionBank(bankOnly)
    store.moveInExamDraft([questions[1]!.id], questions[0]!.id, 'before')
    store.setTitle('Chem Unit 3')
    await store.whenSettled()

    const reloaded = await loadExamStore(backend)

    expect(reloaded.getState().examDraft.title).toBe('Chem Unit 3')
    expect(bankIds(reloaded)).toEqual([
      questions[0]!.id,
      questions[1]!.id,
      bankOnly.id,
    ])
    expect(renderedIds(reloaded)).toEqual([questions[1]!.id, questions[0]!.id])
    expect(reloaded.getState().dirty).toBe(true)
  })

  test('bank-only work is durable even though it is on no exam', async () => {
    const { backend, store } = await freshStore()
    const question = createQuestion('open')
    store.createInQuestionBank(question)
    await store.whenSettled()

    const reloaded = await loadExamStore(backend)

    expect(bankIds(reloaded)).toEqual([question.id])
    expect(reloaded.getState().examDraft.questionIds).toEqual([])
  })

  test('saving clears the dirty flag and reloads without a working draft', async () => {
    const { savedBackend, store, questions } = await withExamDraft(1)
    store.setTitle('Persisted')

    await store.save()

    expect(store.getState().dirty).toBe(false)
    expect(store.hasSavedExam()).toBe(true)
    const reloaded = await loadExamStore(memory(), savedBackend)
    expect(reloaded.getState().examDraft.title).toBe('Persisted')
    expect(renderedIds(reloaded)).toEqual([questions[0]!.id])
    expect(reloaded.getState().dirty).toBe(false)
  })

  test('discard restores the last saved Question Bank and Exam Draft', async () => {
    const { store, questions } = await withExamDraft(2)
    await store.save()
    store.removeFromExamDraft([questions[0]!.id])
    store.setTitle('Changed')

    await store.discard()

    expect(store.getState().examDraft.title).toBe('Untitled exam')
    expect(renderedIds(store)).toEqual(questions.map((question) => question.id))
    expect(store.getState().dirty).toBe(false)
  })

  test('subscribers are notified of a change', async () => {
    const { store } = await freshStore()
    let notified = 0
    const unsubscribe = store.subscribe(() => {
      notified += 1
    })
    store.setTitle('One')
    expect(notified).toBe(1)
    unsubscribe()
    store.setTitle('Two')
    expect(notified).toBe(1)
  })

  test('snapshots keep stable identities while nothing changes', async () => {
    const { store } = await withExamDraft(1)
    const state = store.getState()
    const selected = store.selectedExam()
    expect(store.getState()).toBe(state)
    expect(store.selectedExam()).toBe(selected)
  })
})

describe('undo and redo', () => {
  test('each authoring action is exactly one step in both directions', async () => {
    const { store } = await freshStore()
    const first = createQuestion('multiple-choice')
    const second = createQuestion('multiple-choice')

    store.createInExamDraft(first)
    store.createInQuestionBank(second)
    store.addToExamDraft(second.id)
    store.moveInExamDraft([second.id], first.id, 'before')
    store.removeFromExamDraft([first.id])
    expect(renderedIds(store)).toEqual([second.id])

    store.undo()
    expect(renderedIds(store)).toEqual([second.id, first.id])
    store.undo()
    expect(renderedIds(store)).toEqual([first.id, second.id])
    store.undo()
    expect(renderedIds(store)).toEqual([first.id])
    expect(bankIds(store)).toEqual([first.id, second.id])
    store.undo()
    expect(bankIds(store)).toEqual([first.id])
    store.undo()
    expect(bankIds(store)).toEqual([])
    expect(store.canUndo()).toBe(false)

    store.redo()
    expect(bankIds(store)).toEqual([first.id])
    store.redo()
    store.redo()
    store.redo()
    store.redo()
    expect(renderedIds(store)).toEqual([second.id])
    expect(store.canRedo()).toBe(false)
  })

  test('undoing a Remove puts the reference back where it was', async () => {
    const { store, questions } = await withExamDraft(3)

    store.removeFromExamDraft([questions[1]!.id])
    store.undo()

    expect(renderedIds(store)).toEqual(questions.map((question) => question.id))
  })

  test('a new action after an undo clears the redo branch', async () => {
    const { store } = await freshStore()
    store.setTitle('First')
    store.undo()
    store.setTitle('Second')

    expect(store.canRedo()).toBe(false)
    expect(store.getState().examDraft.title).toBe('Second')
  })

  test('restored history is mirrored, so a refresh agrees with the screen', async () => {
    const { backend, store } = await freshStore()
    store.setTitle('Changed')
    store.undo()
    await store.whenSettled()

    expect(backend.value?.examDraft.title).toBe('Untitled exam')
  })

  test('an untouched store has nothing to undo or redo', async () => {
    const { store } = await freshStore()
    expect(store.canUndo()).toBe(false)
    expect(store.canRedo()).toBe(false)
    expect(createAuthoringState().dirty).toBe(false)
  })
})
