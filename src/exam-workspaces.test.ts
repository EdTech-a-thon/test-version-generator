import { expect, test } from 'bun:test'
import { createAuthoringState } from './exam-store'
import { isPristineExam } from './exam-workspaces'

test('only an untouched Untitled Exam without Export Records is disposable', () => {
  const empty = createAuthoringState()
  empty.examDraft.title = 'Untitled Exam'
  expect(isPristineExam(empty, { versions: [] })).toBe(true)

  expect(isPristineExam({ ...empty, examDraft: { ...empty.examDraft, title: 'Named Exam' } }, { versions: [] })).toBe(false)
  expect(isPristineExam({ ...empty, questionBank: { questions: [{} as never] } }, { versions: [] })).toBe(true)
  expect(isPristineExam(empty, { versions: [{}] })).toBe(false)
  expect(isPristineExam(null, { versions: [] })).toBe(false)
})
