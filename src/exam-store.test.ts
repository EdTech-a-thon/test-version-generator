import { describe, expect, test } from 'bun:test'
import { createQuestion, orderedQuestions } from './exam'
import type { Question } from './exam'
import {
  createMemoryBackend,
  createWorkingDraft,
  loadExamStore,
} from './exam-store'
import type { ExamStore, WorkingDraft } from './exam-store'

function memory(initial: WorkingDraft | null = null) {
  return createMemoryBackend<WorkingDraft>(initial)
}

async function freshStore() {
  const backend = memory()
  const store = await loadExamStore(backend)
  return { backend, store }
}

const ids = (store: ExamStore) =>
  orderedQuestions(store.getState().exam, store.currentVersion()).map((q) => q.id)

async function withQuestions(count: number) {
  const { backend, store } = await freshStore()
  const questions: Question[] = []
  for (let index = 0; index < count; index += 1) {
    const question = createQuestion('multiple-choice')
    questions.push(question)
    store.addQuestion(question)
  }
  await store.whenSettled()
  return { backend, store, questions }
}

describe('the working draft', () => {
  test('a first run starts on an empty exam with a single draft version', async () => {
    const { store } = await freshStore()
    const state = store.getState()
    expect(state.exam.questions).toEqual([])
    expect(state.versions).toHaveLength(1)
    expect(state.versions[0]!.letter).toBe('A')
    expect(state.currentVersionId).toBe(state.versions[0]!.id)
    expect(state.dirty).toBe(false)
  })

  test('every kind of change raises the dirty flag', async () => {
    const cases: Array<(store: ExamStore) => void> = [
      (store) => store.setTitle('Chem Unit 3'),
      (store) => store.addQuestion(createQuestion('open')),
      (store) => store.putVersion({ ...store.currentVersion(), questionOrder: [] }),
    ]
    for (const change of cases) {
      const { store } = await freshStore()
      expect(store.getState().dirty).toBe(false)
      change(store)
      expect(store.getState().dirty).toBe(true)
    }
  })

  test('the draft is mirrored on every change', async () => {
    const { backend, store } = await freshStore()
    store.setTitle('Chem Unit 3')
    await store.whenSettled()
    expect(backend.value?.exam.title).toBe('Chem Unit 3')
  })

  test('the draft round-trips a refresh with the dirty flag intact', async () => {
    const { backend, store, questions } = await withQuestions(2)
    store.setTitle('Chem Unit 3')
    await store.whenSettled()

    const reloaded = await loadExamStore(backend)
    expect(reloaded.getState().exam.title).toBe('Chem Unit 3')
    expect(reloaded.getState().dirty).toBe(true)
    expect(ids(reloaded)).toEqual(questions.map((question) => question.id))
    expect(reloaded.getState().currentVersionId).toBe(store.getState().currentVersionId)
  })

  test('an unreadable stored draft falls back to a fresh one', async () => {
    const backend = createMemoryBackend<WorkingDraft>({ nonsense: true } as unknown as WorkingDraft)
    const store = await loadExamStore(backend)
    expect(store.getState().exam.questions).toEqual([])
    expect(store.getState().dirty).toBe(false)
  })

  test('a stored draft is used as-is rather than replaced', async () => {
    const draft = createWorkingDraft()
    draft.exam.title = 'Saved earlier'
    const store = await loadExamStore(createMemoryBackend<WorkingDraft>(draft))
    expect(store.getState().exam.title).toBe('Saved earlier')
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
})

describe('editing questions', () => {
  test('adding a question appends its id to the ordering', async () => {
    const { store, questions } = await withQuestions(3)
    expect(store.currentVersion().questionOrder).toEqual(questions.map((q) => q.id))
    expect(ids(store)).toEqual(questions.map((q) => q.id))
  })

  test('adding a question appends it to every version, not just the current one', async () => {
    const { store, questions } = await withQuestions(1)
    const other = { ...store.currentVersion(), id: 'v2', letter: 'B' }
    store.putVersion(other)
    store.addQuestion(createQuestion('open'))
    const added = store.getState().exam.questions.at(-1)!
    for (const version of store.getState().versions) {
      expect(version.questionOrder).toContain(added.id)
      expect(version.questionOrder).toContain(questions[0]!.id)
    }
  })

  test('deleting a question removes it from the exam and from the ordering', async () => {
    const { store, questions } = await withQuestions(3)
    store.putVersion({
      ...store.currentVersion(),
      choiceOrder: { [questions[1]!.id]: ['c1', 'c2'] },
    })
    store.removeQuestion(questions[1]!.id)
    expect(store.getState().exam.questions.map((q) => q.id)).toEqual([
      questions[0]!.id,
      questions[2]!.id,
    ])
    expect(store.currentVersion().questionOrder).toEqual([
      questions[0]!.id,
      questions[2]!.id,
    ])
    expect(store.currentVersion().choiceOrder).toEqual({})
  })

  test('editing a question replaces its content in place', async () => {
    const { store, questions } = await withQuestions(2)
    const edited = { ...questions[0]!, doc: { type: 'doc', content: [] } }
    store.updateQuestion(edited)
    expect(store.getState().exam.questions.map((q) => q.id)).toEqual(questions.map((q) => q.id))
    expect(store.getState().exam.questions[0]!.doc).toEqual({ type: 'doc', content: [] })
  })

  test('editing an unknown question adds it, so a save is never lost', async () => {
    const { store } = await freshStore()
    const question = createQuestion('open')
    store.updateQuestion(question)
    expect(store.getState().exam.questions.map((q) => q.id)).toEqual([question.id])
    expect(store.currentVersion().questionOrder).toEqual([question.id])
  })

  test('a column override is recorded on the question', async () => {
    const { store, questions } = await withQuestions(1)
    store.setQuestionColumns(questions[0]!.id, 2)
    expect(store.getState().exam.questions[0]!.columns).toBe(2)
  })

  test('a column override survives a later content edit', async () => {
    const { store, questions } = await withQuestions(1)
    store.setQuestionColumns(questions[0]!.id, 4)
    // Mirrors what the question dialog's save path does: spread the current
    // question (columns included) over a new doc, the way `QuestionDialog`'s
    // `onSave` handler in App.tsx builds `saved`.
    const current = store.getState().exam.questions[0]!
    store.updateQuestion({
      ...current,
      doc: { type: 'doc', content: [{ type: 'paragraph' }] },
    })
    expect(store.getState().exam.questions[0]!.columns).toBe(4)
  })

  test('the exam title is editable', async () => {
    const { store } = await freshStore()
    store.setTitle('Chem Unit 3')
    expect(store.getState().exam.title).toBe('Chem Unit 3')
  })
})

describe('versions', () => {
  test('the current version is the one being viewed', async () => {
    const { store } = await freshStore()
    const first = store.currentVersion()
    const second = { ...first, id: 'v2', letter: 'B' }
    store.putVersion(second)
    expect(store.currentVersion().id).toBe(first.id)
    store.selectVersion('v2')
    expect(store.currentVersion().letter).toBe('B')
  })

  test('replacing a version leaves the others alone', async () => {
    const { store, questions } = await withQuestions(2)
    const first = store.currentVersion()
    store.putVersion({ ...first, id: 'v2', letter: 'B' })
    store.selectVersion('v2')
    store.putVersion({
      ...store.currentVersion(),
      questionOrder: [questions[1]!.id, questions[0]!.id],
    })
    expect(ids(store)).toEqual([questions[1]!.id, questions[0]!.id])
    store.selectVersion(first.id)
    expect(ids(store)).toEqual([questions[0]!.id, questions[1]!.id])
  })

  test('a content edit made in one version is visible from another', async () => {
    const { store, questions } = await withQuestions(1)
    store.putVersion({ ...store.currentVersion(), id: 'v2', letter: 'B' })
    store.selectVersion('v2')
    store.updateQuestion({ ...questions[0]!, doc: { type: 'doc', content: [{ type: 'paragraph' }] } })
    store.selectVersion(store.getState().versions[0]!.id)
    expect(store.getState().exam.questions[0]!.doc).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    })
  })

  test('looking at another version is not an edit', async () => {
    const { store } = await freshStore()
    store.putVersion({ ...store.currentVersion(), id: 'v2', letter: 'B' })
    const saved = { ...store.getState(), dirty: false }
    const clean = await loadExamStore(createMemoryBackend<WorkingDraft>(saved))
    clean.selectVersion('v2')
    expect(clean.getState().dirty).toBe(false)
    expect(clean.currentVersion().letter).toBe('B')
  })

  test('an ordering change to the current version raises the dirty flag', async () => {
    const { store, questions } = await withQuestions(2)
    store.updateCurrentVersion((version) => ({
      ...version,
      questionOrder: [questions[1]!.id, questions[0]!.id],
    }))
    expect(store.getState().dirty).toBe(true)
    expect(ids(store)).toEqual([questions[1]!.id, questions[0]!.id])
  })

  test('selecting an unknown version leaves the current one alone', async () => {
    const { store } = await freshStore()
    const current = store.currentVersion().id
    store.selectVersion('nope')
    expect(store.currentVersion().id).toBe(current)
  })
})
