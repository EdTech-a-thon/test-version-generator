import { describe, expect, test } from 'bun:test'
import type { Exam, Question, Arrangement } from './exam'
import {
  DEFAULT_EXPORT_CONFIGURATION,
  DEFAULT_EXPORT_CONFIGURATION,
  EMPTY_EXPORT_HISTORY,
  prepareExport,
  readExportPreferences,
  writeExportPreferences,
  prepareHistoricalExport,
  type ExportHistory,
} from './export-preparation'
import { unmeasured } from './export-plan'

function paragraph(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

function choice(id: string, text: string, correct = false) {
  return {
    type: 'multipleChoiceChoice',
    attrs: { id, correct },
    content: [paragraph(text)],
  }
}

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: 'question-1',
    type: 'multiple-choice',
    columns: 2,
    difficulty: 'easy',
    topics: ['Biology'],
    doc: {
      type: 'doc',
      content: [
        paragraph('Which animal is a mammal?'),
        {
          type: 'multipleChoice',
          content: [
            choice('whale', 'Whale', true),
            choice('shark', 'Shark'),
          ],
        },
      ],
    },
    ...overrides,
  }
}

function request(
  configuration = DEFAULT_EXPORT_CONFIGURATION,
  history: ExportHistory = EMPTY_EXPORT_HISTORY,
) {
  const selected = question()
  const exam: Exam = { title: 'Biology Quiz', questions: [selected] }
  const arrangement: Arrangement = {
    id: 'working-copy',
    letter: '',
    questionOrder: [selected.id],
    choiceOrder: {},
  }
  return {
    examId: 'exam-1',
    exam,
    arrangement,
    configuration,
    history,
    measure: unmeasured,
    createdAt: '2026-09-10T12:00:00.000Z',
    createId: () => 'record-1',
  }
}

describe('Export Record preparation', () => {
  test('defaults to one PDF event containing the student test and answer key', () => {
    const prepared = prepareExport(request())

    expect(prepared.documents.map((plan) => plan.pages[0]?.stream)).toEqual([
      'test',
      'answer-key',
    ])
    expect(prepared.filename).toBe('Biology Quiz.pdf')
    expect(prepared.record).toMatchObject({
      id: 'record-1',
      examId: 'exam-1',
      capturedName: 'Biology Quiz',
      format: 'pdf',
      selection: { test: true, answerKey: true },
      questionCount: 1,
      createdAt: '2026-09-10T12:00:00.000Z',
    })
    expect(prepared.record.plans).toEqual(prepared.documents)
  })

  test('retains only the Content Selection actually produced', () => {
    const prepared = prepareExport(request({
      format: 'docx',
      selection: { test: false, answerKey: true },
    }))

    expect(prepared.documents).toHaveLength(1)
    expect(prepared.documents[0]?.pages[0]?.stream).toBe('answer-key')
    expect(prepared.record.plans).toHaveLength(1)
    expect(prepared.record.selection).toEqual({ test: false, answerKey: true })
    expect(prepared.filename).toBe('Biology Quiz.docx')
  })

  test('identical exports are distinct events rather than deduplicated identities', () => {
    const first = prepareExport(request())
    const second = prepareExport({
      ...request(DEFAULT_EXPORT_CONFIGURATION, { records: [first.record] }),
      createdAt: '2026-09-10T12:01:00.000Z',
      createId: () => 'record-2',
    })

    expect(second.record.id).toBe('record-2')
    expect(second.record.createdAt).not.toBe(first.record.createdAt)
    expect(second.documents).toEqual(first.documents)
  })

  test('captures unsaved visible content without consulting the saved Exam', () => {
    const input = request()
    input.exam.title = 'Renamed Working Copy'
    input.arrangement.choiceOrder = { 'question-1': ['shark', 'whale'] }

    const prepared = prepareExport(input)

    expect(prepared.record.capturedName).toBe('Renamed Working Copy')
    expect(prepared.filename).toBe('Renamed Working Copy.pdf')
    const firstQuestion = prepared.record.plans
      .flatMap((plan) => plan.pages)
      .flatMap((page) => page.items)
      .find((item) => item.kind === 'question')
    expect(firstQuestion?.kind === 'question' && firstQuestion.question.choices.map(({ id }) => id)).toEqual([
      'shark',
      'whale',
    ])
  })

  test('historical re-export uses only stored plans and appends a new event', () => {
    const original = prepareExport(request()).record
    const historical = prepareHistoricalExport({
      record: original,
      createdAt: '2026-09-11T09:00:00.000Z',
      createId: () => 'record-2',
    })

    expect(historical.documents).toEqual(original.plans)
    expect(historical.filename).toBe('Biology Quiz.pdf')
    expect(historical.record).toEqual({
      ...original,
      id: 'record-2',
      createdAt: '2026-09-11T09:00:00.000Z',
      sourceRecordId: 'record-1',
    })
    expect(original.sourceRecordId).toBeUndefined()
  })

  test('blocks empty output and invalid Content Selection', () => {
    expect(() => prepareExport({
      ...request(),
      exam: { title: 'Empty', questions: [] },
      arrangement: { id: 'working-copy', letter: '', questionOrder: [], choiceOrder: {} },
    })).toThrow('Add at least one question to the Exam before exporting.')

    expect(() => prepareExport(request({
      format: 'pdf',
      selection: { test: false, answerKey: false },
    }))).toThrow('Choose the student test, the answer key, or both.')
  })

  test('missing correctness and optional metadata never block export', () => {
    const input = request()
    input.exam.questions = [question({
      difficulty: undefined,
      topics: undefined,
      doc: {
        type: 'doc',
        content: [
          paragraph('Choose one.'),
          { type: 'multipleChoice', content: [choice('one', 'One'), choice('two', 'Two')] },
        ],
      },
    })]
    const prepared = prepareExport(input)
    const entries = prepared.documents
      .flatMap((plan) => plan.pages)
      .flatMap((page) => page.items)
      .filter((item) => item.kind === 'answer-key-entry')

    expect(entries).toEqual([{ kind: 'answer-key-entry', number: 1, letter: null }])
  })
})


describe('global Export preferences', () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }

  test('default to PDF with both documents and retain a valid choice', () => {
    values.clear()
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
    expect(readExportPreferences()).toEqual(DEFAULT_EXPORT_CONFIGURATION)
    const preferred = {
      format: 'docx' as const,
      selection: { test: false, answerKey: true },
    }
    writeExportPreferences(preferred)
    expect(readExportPreferences()).toEqual(preferred)
  })

  test('ignore malformed and empty Content Selection preferences', () => {
    values.set('test-parrot-export-preferences-v1', JSON.stringify({
      format: 'docx', selection: { test: false, answerKey: false },
    }))
    expect(readExportPreferences()).toEqual(DEFAULT_EXPORT_CONFIGURATION)
  })
})
