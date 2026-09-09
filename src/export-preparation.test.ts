import { describe, expect, test } from 'bun:test'
import type { Exam, Question, Version } from './exam'
import {
  DEFAULT_EXPORT_CONFIGURATION,
  EMPTY_PUBLICATION_HISTORY,
  exportFilename,
  prepareExport,
  prepareHistoricalExport,
  type PublicationHistory,
  versionFingerprintOf,
} from './export-preparation'
import { unmeasured, type Measure } from './export-plan'

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

function multipleChoice(overrides: Partial<Question> = {}): Question {
  return {
    id: 'source-question',
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
            choice('whale-choice', 'Whale', true),
            choice('shark-choice', 'Shark'),
          ],
        },
      ],
    },
    ...overrides,
  }
}

function inputs(
  question = multipleChoice(),
  history: PublicationHistory = EMPTY_PUBLICATION_HISTORY,
  measure: Measure = unmeasured,
) {
  const exam: Exam = { title: 'Biology Quiz', questions: [question] }
  const version: Version = {
    id: 'exam-draft',
    letter: 'draft',
    questionOrder: [question.id],
    choiceOrder: {},
  }
  return {
    exam,
    version,
    configuration: DEFAULT_EXPORT_CONFIGURATION,
    history,
    measure,
    createdAt: '2026-09-04T12:00:00.000Z',
  }
}

function committed(
  first: ReturnType<typeof prepareExport>,
): PublicationHistory {
  return {
    versions: first.publication.version ? [first.publication.version] : [],
    revisions: first.publication.revisions,
    plans: first.publication.plans,
  }
}

describe('one-Version export preparation', () => {
  test('defaults to one PDF containing the student test before its answer key', () => {
    const prepared = prepareExport(inputs())

    expect(prepared.documents.map((plan) => plan.pages[0]?.stream)).toEqual([
      'test',
      'answer-key',
    ])
    expect(prepared.resolution.kind).toBe('new')
    expect(prepared.resolution.version.name).toBe('Amber Badger')
    expect(prepared.filename).toBe('Biology Quiz-Amber Badger.pdf')
    for (const plan of prepared.documents) {
      expect(
        plan.pages.every(
          (page) => page.furniture.versionLabel === 'Version: Amber Badger',
        ),
      ).toBe(true)
    }
  })

  test('uses one shared filename stem for PDF and DOCX regardless of Content Selection', () => {
    expect(exportFilename('Biology/Quiz', 'Amber Badger', 'pdf')).toBe(
      'Biology-Quiz-Amber Badger.pdf',
    )
    expect(exportFilename('Biology/Quiz', 'Amber Badger', 'docx')).toBe(
      'Biology-Quiz-Amber Badger.docx',
    )
  })

  test('always prepares both canonical plans when only one is selected', () => {
    const prepared = prepareExport({
      ...inputs(),
      configuration: { format: 'pdf', selection: { test: false, answerKey: true } },
    })

    expect(prepared.canonicalPlans.test.pages[0]?.stream).toBe('test')
    expect(prepared.canonicalPlans.answerKey.pages[0]?.stream).toBe(
      'answer-key',
    )
    expect(prepared.documents.map((plan) => plan.pages[0]?.stream)).toEqual([
      'answer-key',
    ])
    expect(prepared.publication.plans).toHaveLength(2)
  })

  test('reads a historical Version from stored plans without current content or layout', () => {
    const first = prepareExport(inputs())
    const history = committed(first)
    const historical = prepareHistoricalExport({
      history,
      version: first.resolution.version,
      configuration: { format: 'pdf', selection: { test: false, answerKey: true } },
    })

    expect(historical.documents).toEqual([first.canonicalPlans.answerKey])
    expect(historical.filename).toBe('Biology Quiz-Amber Badger.pdf')
    expect(historical.publication).toEqual({
      version: null,
      revisions: [],
      plans: [],
      mediaHashes: [],
    })
    expect(history).toEqual(committed(first))
  })

  test('metadata-only edits reuse the Version, Question Revision, and first provenance', () => {
    const first = prepareExport(inputs())
    const history = committed(first)
    const edited = multipleChoice({ difficulty: 'hard', topics: ['Zoology'] })
    const secondRequest = inputs(edited, history)
    secondRequest.configuration = {
      format: 'pdf',
      selection: { test: false, answerKey: true },
    }
    secondRequest.createdAt = '2030-01-01T00:00:00.000Z'
    const second = prepareExport(secondRequest)

    expect(second.resolution).toEqual({
      kind: 'existing',
      version: history.versions[0],
    })
    expect(second.publication.version).toBeNull()
    expect(second.publication.revisions).toEqual([])
    expect(second.resolution.version.revisionIds).toEqual(
      first.resolution.version.revisionIds,
    )
    expect(history.revisions[0]?.metadata).toEqual({
      difficulty: 'easy',
      topics: ['Biology'],
    })
  })

  test('source record and generated choice identities do not change Version identity', () => {
    const first = prepareExport(inputs())
    const copied = multipleChoice({
      id: 'copied-source',
      doc: {
        type: 'doc',
        content: [
          paragraph('Which animal is a mammal?'),
          {
            type: 'multipleChoice',
            content: [
              choice('fresh-1', 'Whale', true),
              choice('fresh-2', 'Shark'),
            ],
          },
        ],
      },
    })

    expect(
      prepareExport(inputs(copied, committed(first))).resolution.kind,
    ).toBe('existing')
  })

  test('identical presentation states from distinct Question Bank records retain distinct revisions', () => {
    const original = multipleChoice()
    const copied = multipleChoice({ id: 'copied-source' })
    const request = inputs(original)
    request.exam.questions = [original, copied]
    request.version.questionOrder = [original.id, copied.id]

    const prepared = prepareExport(request)

    expect(prepared.publication.revisions.map((revision) => revision.sourceQuestionId)).toEqual([
      'source-question',
      'copied-source',
    ])
    expect(prepared.resolution.version.revisionIds).toHaveLength(2)
    expect(new Set(prepared.resolution.version.revisionIds).size).toBe(2)
  })

  test('media identity keeps each content hash at its published occurrence', () => {
    const a = `/local-images/${'a'.repeat(64)}`
    const b = `/local-images/${'b'.repeat(64)}`
    const withImages = (sources: string[]) =>
      multipleChoice({
        doc: {
          type: 'doc',
          content: [
            paragraph('Which animal is a mammal?'),
            ...sources.map((src) => ({ type: 'image-block', attrs: { src } })),
            {
              type: 'multipleChoice',
              content: [
                choice('whale-choice', 'Whale', true),
                choice('shark-choice', 'Shark'),
              ],
            },
          ],
        },
      })

    expect(prepareExport(inputs(withImages([a, b, a]))).fingerprint).not.toBe(
      prepareExport(inputs(withImages([a, a, b]))).fingerprint,
    )
  })

  test('explicit page-break decisions identify a Version', () => {
    const prepared = prepareExport(inputs())
    const changed = structuredClone(prepared.canonicalPlans)
    changed.answerKey.pages[0]!.breakBefore = true

    expect(
      versionFingerprintOf(prepared.canonicalPlans.test, prepared.canonicalPlans.answerKey),
    ).not.toBe(versionFingerprintOf(changed.test, changed.answerKey))
  })

  test('published content, correctness, arrangement, columns, media, and page assignment identify a Version', () => {
    const first = prepareExport(inputs())
    const history = committed(first)
    const changedWords = multipleChoice({
      doc: {
        type: 'doc',
        content: [
          paragraph('Which animal lives in the ocean?'),
          {
            type: 'multipleChoice',
            content: [
              choice('whale-choice', 'Whale', true),
              choice('shark-choice', 'Shark'),
            ],
          },
        ],
      },
    })
    const changedCorrectness = multipleChoice({
      doc: {
        type: 'doc',
        content: [
          paragraph('Which animal is a mammal?'),
          {
            type: 'multipleChoice',
            content: [
              choice('whale-choice', 'Whale'),
              choice('shark-choice', 'Shark', true),
            ],
          },
        ],
      },
    })
    const changedColumns = multipleChoice({ columns: 1 })
    const changedMedia = multipleChoice({
      doc: {
        type: 'doc',
        content: [
          paragraph('Which animal is a mammal?'),
          {
            type: 'image-block',
            attrs: {
              src: '/local-images/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            },
          },
          {
            type: 'multipleChoice',
            content: [
              choice('whale-choice', 'Whale', true),
              choice('shark-choice', 'Shark'),
            ],
          },
        ],
      },
    })

    for (const request of [
      inputs(changedWords, history),
      inputs(changedCorrectness, history),
      inputs(changedColumns, history),
      inputs(changedMedia, history),
    ]) {
      expect(prepareExport(request).resolution.kind).toBe('new')
    }

    const reordered = inputs(multipleChoice(), history)
    reordered.version.choiceOrder = {
      'source-question': ['shark-choice', 'whale-choice'],
    }
    const rearranged = prepareExport(reordered)
    expect(rearranged.resolution.kind).toBe('new')
    expect(rearranged.publication.revisions).toEqual([])

    const repaginated: Measure = {
      itemHeight: (item) => (item.kind === 'question' ? 900 : 0),
    }
    expect(
      prepareExport(inputs(multipleChoice(), history, repaginated)).resolution
        .kind,
    ).toBe('new')
  })

  test('new fingerprints get a unique provisional name without changing committed history', () => {
    const first = prepareExport(inputs())
    const history = committed(first)
    const second = prepareExport(
      inputs(multipleChoice({ columns: 1 }), history),
    )

    expect(second.resolution.version.name).toBe('Amber Falcon')
    expect(history.versions.map((version) => version.name)).toEqual([
      'Amber Badger',
    ])
    expect(second.publication.version?.name).toBe('Amber Falcon')
  })

  test('an empty Exam Draft is blocked with an actionable message', () => {
    expect(() =>
      prepareExport({
        ...inputs(),
        exam: { title: 'Empty', questions: [] },
        version: {
          id: 'exam-draft',
          letter: 'draft',
          questionOrder: [],
          choiceOrder: {},
        },
      }),
    ).toThrow('Add at least one question')
  })

  test('a missing correct answer remains exportable and leaves a blank key entry', () => {
    const question = multipleChoice({
      doc: {
        type: 'doc',
        content: [
          paragraph('Choose one.'),
          {
            type: 'multipleChoice',
            content: [choice('one', 'One'), choice('two', 'Two')],
          },
        ],
      },
    })
    const prepared = prepareExport(inputs(question))
    const entries = prepared.canonicalPlans.answerKey.pages
      .flatMap((page) => page.items)
      .filter((item) => item.kind === 'answer-key-entry')

    expect(entries).toEqual([
      { kind: 'answer-key-entry', number: 1, letter: null },
    ])
  })
})
