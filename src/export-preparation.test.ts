// Export preparation, at the seam the whole feature turns on.
//
// One pure call in — an exam, the Version being edited, the dialog's
// configuration, a fixed random source and a stub `Measure` — and the complete
// ordered collection of documents out. Everything asserted here is something a
// teacher could see on paper: which arrangement each Version publishes, that no
// two of them are the same paper, which documents come out in which order, and
// what each page says it is. No private helper, no shuffle call count, no
// intermediate array.

import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_EXPORT_CONFIGURATION,
  VERSION_LIMIT,
  docxFilename,
  generateVersions,
  maxDistinctVersions,
  plansOf,
  prepareExport,
  type ExportConfiguration,
  type PreparationProgress,
  type Randomization,
} from './export-preparation'
import {
  SECTION_ORDER,
  orderedChoices,
  orderedQuestions,
  questionsInSection,
  type Exam,
  type Question,
  type RandomSource,
  type Version,
} from './exam'
import { unmeasured, type LayoutPlan, type PageItem } from './export-plan'
import type { ProseMirrorJSON } from './question-doc'
import {
  createExamDraft,
  createQuestionBank,
  withQuestionBanked,
  withReferenceAdded,
} from './question-bank'
import { selectedExam } from './selected-exam'

// ---------------------------------------------------------------------------
// Fixtures

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
        { type: 'paragraph', content: [{ type: 'text', text: `stem ${id}` }] },
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
  return {
    id,
    type: 'open',
    doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }] },
    columns: 2,
  }
}

function examOf(questions: Question[], title = 'Chemistry Unit 3'): Exam {
  return { title, questions }
}

function versionOf(
  questionOrder: string[] = [],
  choiceOrder: Record<string, string[]> = {},
  letter = 'C',
): Version {
  return { id: 'v-current', letter, questionOrder, choiceOrder }
}

/** A source that cycles a fixed sequence of draws: the same exam prepares the
 *  same way every run, and a failure is reproducible. */
function fixedRandom(draws: number[] = [0.7, 0.1, 0.9, 0.35, 0.5, 0.05]): RandomSource {
  let index = 0
  return () => draws[index++ % draws.length]!
}

const NOTHING: Randomization = { questions: false, answers: false }
const QUESTIONS_ONLY: Randomization = { questions: true, answers: false }
const ANSWERS_ONLY: Randomization = { questions: false, answers: true }
const BOTH: Randomization = { questions: true, answers: true }

function configurationOf(overrides: Partial<ExportConfiguration> = {}): ExportConfiguration {
  return { ...DEFAULT_EXPORT_CONFIGURATION, ...overrides }
}

function prepare(
  exam: Exam,
  version: Version,
  overrides: Partial<ExportConfiguration> = {},
  random: RandomSource = fixedRandom(),
) {
  return prepareExport({
    exam,
    version,
    configuration: configurationOf(overrides),
    random,
    measure: unmeasured,
  })
}

/** A mixed exam: two Question Sections, three multiple-choice questions with
 *  four answers each, two short-answer questions. */
function mixedExam(): Exam {
  return examOf([
    multipleChoice('m1', ['a1', 'a2', 'a3', 'a4'], 'a1'),
    multipleChoice('m2', ['b1', 'b2', 'b3', 'b4'], 'b3'),
    multipleChoice('m3', ['c1', 'c2', 'c3', 'c4'], 'c4'),
    open('o1'),
    open('o2'),
  ])
}

const mixedVersion = () => versionOf(['m1', 'm2', 'm3', 'o1', 'o2'])

/** Every question's number and its choices' letters, as the paper prints them —
 *  what a teacher would compare between two papers. */
function arrangementOf(plan: LayoutPlan): string[] {
  return plan.pages
    .flatMap((page) => page.items)
    .flatMap((item) =>
      item.kind === 'question' && item.numbered
        ? [
            `${item.question.number}:${item.question.id}(${item.question.choices
              .map((option) => `${option.letter}=${option.id}`)
              .join(',')})`,
          ]
        : [],
    )
}

function itemsOf(plan: LayoutPlan): PageItem[] {
  return plan.pages.flatMap((page) => page.items)
}

function answerKeyOf(plan: LayoutPlan): { number: number; letter: string | null }[] {
  return itemsOf(plan).flatMap((item) =>
    item.kind === 'answer-key-entry'
      ? [{ number: item.number, letter: item.letter }]
      : [],
  )
}

// ---------------------------------------------------------------------------
// Version A

describe('Version A', () => {
  test('publishes the arrangement the teacher is looking at', () => {
    const exam = mixedExam()
    const version = versionOf(['m2', 'm1', 'm3', 'o2', 'o1'], {
      m1: ['a3', 'a1', 'a4', 'a2'],
    })
    const [test0] = plansOf(prepare(exam, version))

    expect(
      itemsOf(test0!).flatMap((item) =>
        item.kind === 'question' && item.numbered ? [item.question.id] : [],
      ),
    ).toEqual(['m2', 'm1', 'm3', 'o2', 'o1'])
    const m1 = itemsOf(test0!).find(
      (item) => item.kind === 'question' && item.question.id === 'm1',
    )
    expect(
      m1?.kind === 'question' ? m1.question.choices.map((option) => option.id) : [],
    ).toEqual(['a3', 'a1', 'a4', 'a2'])
  })

  test('is labelled A whatever the edited version is called', () => {
    const prepared = prepare(mixedExam(), versionOf(['m1'], {}, 'Q'))
    expect(prepared.labels).toEqual(['A'])
    expect(prepared.documents[0]!.plan.version.letter).toBe('A')
    expect(prepared.documents[0]!.plan.pages[0]!.furniture.versionLabel).toBe('ID: A')
  })

  test('leaves the exam and the edited version untouched', () => {
    const exam = mixedExam()
    const version = mixedVersion()
    const examBefore = structuredClone(exam)
    const versionBefore = structuredClone(version)

    prepare(exam, version, { versionCount: 6, randomization: BOTH })

    expect(exam).toEqual(examBefore)
    expect(version).toEqual(versionBefore)
  })

  test('reconciles an ordering that has fallen behind the exam', () => {
    const exam = mixedExam()
    // 'm3' is missing from the recorded order and 'gone' no longer exists.
    const version = versionOf(['gone', 'm2', 'm1', 'o1', 'o2'])
    const [test0] = plansOf(prepare(exam, version))

    expect(
      itemsOf(test0!).flatMap((item) =>
        item.kind === 'question' && item.numbered ? [item.question.id] : [],
      ),
    ).toEqual(['m2', 'm1', 'm3', 'o1', 'o2'])
  })
})

// ---------------------------------------------------------------------------
// Randomization

describe('Randomization', () => {
  test('question order alone leaves every answer order alone', () => {
    const exam = mixedExam()
    const version = mixedVersion()
    const versions = generateVersions(exam, version, 4, QUESTIONS_ONLY, fixedRandom())

    for (const generated of versions) {
      for (const question of exam.questions) {
        expect(orderedChoices(question, generated).map((option) => option.id)).toEqual(
          orderedChoices(question, version).map((option) => option.id),
        )
      }
    }
    expect(new Set(versions.map((one) => one.questionOrder.join(','))).size).toBe(4)
  })

  test('answer order alone leaves the question order alone', () => {
    const exam = mixedExam()
    const version = mixedVersion()
    const versions = generateVersions(exam, version, 5, ANSWERS_ONLY, fixedRandom())

    for (const generated of versions) {
      expect(orderedQuestions(exam, generated).map((question) => question.id)).toEqual(
        orderedQuestions(exam, version).map((question) => question.id),
      )
    }
    const answers = versions.map((generated) =>
      exam.questions
        .map((question) => orderedChoices(question, generated).map((o) => o.id).join(''))
        .join('|'),
    )
    expect(new Set(answers).size).toBe(5)
  })

  test('both dimensions vary together', () => {
    const exam = mixedExam()
    const versions = generateVersions(exam, mixedVersion(), 6, BOTH, fixedRandom())
    const papers = versions.map(
      (generated) =>
        generated.questionOrder.join(',')
        + '|'
        + exam.questions
          .map((question) => orderedChoices(question, generated).map((o) => o.id).join(''))
          .join('|'),
    )
    expect(new Set(papers).size).toBe(6)
  })

  test('never moves a question across its Question Section', () => {
    const exam = mixedExam()
    const versions = generateVersions(exam, mixedVersion(), 8, BOTH, fixedRandom())

    for (const generated of versions) {
      for (const section of SECTION_ORDER) {
        const ids = questionsInSection(exam, generated, section).map((q) => q.id)
        expect(ids.every((id) => exam.questions.find((q) => q.id === id)?.type === section))
          .toBe(true)
      }
      expect(questionsInSection(exam, generated, 'open').map((q) => q.id).sort())
        .toEqual(['o1', 'o2'])
      expect(questionsInSection(exam, generated, 'multiple-choice').map((q) => q.id).sort())
        .toEqual(['m1', 'm2', 'm3'])
    }
  })

  test('keeps every question and every choice exactly once', () => {
    const exam = mixedExam()
    const versions = generateVersions(exam, mixedVersion(), 8, BOTH, fixedRandom())

    for (const generated of versions) {
      const questions = orderedQuestions(exam, generated).map((q) => q.id)
      expect(questions.slice().sort()).toEqual(['m1', 'm2', 'm3', 'o1', 'o2'])
      for (const question of exam.questions) {
        const ids = orderedChoices(question, generated).map((option) => option.id)
        expect(new Set(ids).size).toBe(ids.length)
        expect(ids.slice().sort()).toEqual(
          orderedChoices(question, mixedVersion()).map((o) => o.id).sort(),
        )
      }
    }
  })

  test('keeps Question Content unchanged and correctness on its own choice', () => {
    const exam = mixedExam()
    const prepared = prepare(exam, mixedVersion(), {
      versionCount: 4,
      selection: { test: true, answerKey: true },
      randomization: BOTH,
    })

    for (const document of prepared.documents) {
      for (const item of itemsOf(document.plan)) {
        if (item.kind !== 'question') continue
        // The stem is the authored document, not a copy someone rewrote.
        const source = exam.questions.find((q) => q.id === item.question.id)!
        expect(item.question.stem[0]).toEqual(
          (source.doc.content as ProseMirrorJSON[])[0]!,
        )
        for (const option of item.question.choices) {
          const correctId = { m1: 'a1', m2: 'b3', m3: 'c4' }[item.question.id]
          expect(option.correct).toBe(option.id === correctId)
        }
      }
    }
  })

  test('the answer key names the letter that version actually printed', () => {
    const exam = examOf([multipleChoice('m1', ['a1', 'a2', 'a3', 'a4'], 'a3')])
    const prepared = prepare(exam, versionOf(['m1']), {
      versionCount: 4,
      selection: { test: true, answerKey: true },
      randomization: ANSWERS_ONLY,
    })
    const tests = prepared.documents.filter((one) => one.stream === 'test')
    const keys = prepared.documents.filter((one) => one.stream === 'answer-key')

    for (const [index, key] of keys.entries()) {
      const printed = itemsOf(tests[index]!.plan).flatMap((item) =>
        item.kind === 'question'
          ? item.question.choices.filter((option) => option.correct)
          : [],
      )
      expect(answerKeyOf(key.plan)).toEqual([{ number: 1, letter: printed[0]!.letter }])
    }
    // And the letter really does move: four arrangements do not all leave the
    // correct answer where Version A had it.
    expect(new Set(keys.map((key) => answerKeyOf(key.plan)[0]!.letter)).size)
      .toBeGreaterThan(1)
  })
})

// ---------------------------------------------------------------------------
// Distinctness

describe('distinctness', () => {
  test('every Version differs from every other under the enabled dimensions', () => {
    const exam = mixedExam()
    const prepared = prepare(exam, mixedVersion(), {
      versionCount: VERSION_LIMIT,
      randomization: BOTH,
    })
    const arrangements = plansOf(prepared).map((plan) => arrangementOf(plan).join(';'))

    expect(arrangements.length).toBe(VERSION_LIMIT)
    expect(new Set(arrangements).size).toBe(VERSION_LIMIT)
  })

  test('Version A is one of the versions that must be differed from', () => {
    // Two choices arrange exactly two ways, so B has nowhere to go but the one
    // arrangement A is not using.
    const exam = examOf([multipleChoice('m1', ['a1', 'a2'], 'a1')])
    const versions = generateVersions(exam, versionOf(['m1']), 2, ANSWERS_ONLY, () => 0.99)

    expect(versions.map((one) => one.choiceOrder.m1)).toEqual([
      ['a1', 'a2'],
      ['a2', 'a1'],
    ])
  })

  test('distinctness is judged only on the dimensions that were enabled', () => {
    // Question order is the only enabled dimension, so two Versions that happen
    // to shuffle answers identically are still distinct papers — and two with
    // the same question order would not be, whatever their answers did.
    const exam = examOf([open('o1'), open('o2')])
    const versions = generateVersions(exam, versionOf(['o1', 'o2']), 2, QUESTIONS_ONLY, () => 0)
    expect(new Set(versions.map((one) => one.questionOrder.join(','))).size).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// How many Versions are possible

describe('the effective maximum', () => {
  test('is one when there is nothing to shuffle', () => {
    expect(maxDistinctVersions(examOf([]), versionOf([]), BOTH)).toBe(1)
    expect(maxDistinctVersions(examOf([open('o1')]), versionOf(['o1']), BOTH)).toBe(1)
    expect(
      maxDistinctVersions(
        examOf([multipleChoice('m1', ['a1'], 'a1')]),
        versionOf(['m1']),
        BOTH,
      ),
    ).toBe(1)
  })

  test('is one when neither dimension is enabled', () => {
    expect(maxDistinctVersions(mixedExam(), mixedVersion(), NOTHING)).toBe(1)
  })

  test('counts the permutations of one shuffleable section', () => {
    const exam = examOf([open('o1'), open('o2'), open('o3')])
    expect(maxDistinctVersions(exam, versionOf(['o1', 'o2', 'o3']), QUESTIONS_ONLY)).toBe(6)
  })

  test('multiplies several Question Sections together', () => {
    // Two multiple-choice questions (2 ways) and three short answers (6 ways).
    const exam = examOf([
      multipleChoice('m1', ['a1', 'a2'], 'a1'),
      multipleChoice('m2', ['b1', 'b2'], 'b1'),
      open('o1'),
      open('o2'),
      open('o3'),
    ])
    const version = versionOf(['m1', 'm2', 'o1', 'o2', 'o3'])
    expect(maxDistinctVersions(exam, version, QUESTIONS_ONLY)).toBe(12)
  })

  test('multiplies several multiple-choice questions together', () => {
    const exam = examOf([
      multipleChoice('m1', ['a1', 'a2'], 'a1'),
      multipleChoice('m2', ['b1', 'b2'], 'b1'),
      open('o1'),
    ])
    const version = versionOf(['m1', 'm2', 'o1'])
    // 2 x 2 answer arrangements; the short answer contributes nothing.
    expect(maxDistinctVersions(exam, version, ANSWERS_ONLY)).toBe(4)
    // Question order adds the two arrangements of the multiple-choice section.
    expect(maxDistinctVersions(exam, version, BOTH)).toBe(8)
  })

  test('saturates at twenty-six', () => {
    expect(maxDistinctVersions(mixedExam(), mixedVersion(), BOTH)).toBe(VERSION_LIMIT)
    const long = examOf(Array.from({ length: 40 }, (_u, index) => open(`o${index}`)))
    const order = long.questions.map((question) => question.id)
    expect(maxDistinctVersions(long, versionOf(order), QUESTIONS_ONLY)).toBe(VERSION_LIMIT)
  })
})

// ---------------------------------------------------------------------------
// Termination

describe('generation always finishes', () => {
  test('asking for the complete set of a tiny space terminates', () => {
    // Three short answers arrange six ways, and the source always draws the
    // same permutation, so every version after the first collides.
    const exam = examOf([open('o1'), open('o2'), open('o3')])
    const versions = generateVersions(exam, versionOf(['o1', 'o2', 'o3']), 6, QUESTIONS_ONLY, () => 0)

    expect(versions.length).toBe(6)
    expect(new Set(versions.map((one) => one.questionOrder.join(','))).size).toBe(6)
  })

  test('asking for the complete set of a two-arrangement space terminates', () => {
    const exam = examOf([multipleChoice('m1', ['a1', 'a2'], 'a1')])
    const versions = generateVersions(exam, versionOf(['m1']), 2, BOTH, () => 0)
    expect(new Set(versions.map((one) => one.choiceOrder.m1!.join(','))).size).toBe(2)
  })

  test('asking for twenty-six of a large space terminates', () => {
    const prepared = prepare(mixedExam(), mixedVersion(), {
      versionCount: VERSION_LIMIT,
      randomization: BOTH,
    })
    expect(prepared.labels).toEqual([...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'])
  })

  test('refuses a count the exam cannot produce', () => {
    const exam = examOf([multipleChoice('m1', ['a1', 'a2'], 'a1')])
    expect(() =>
      prepare(exam, versionOf(['m1']), { versionCount: 3, randomization: ANSWERS_ONLY }),
    ).toThrow(/2 distinct versions/)
    expect(() =>
      prepare(exam, versionOf(['m1']), { versionCount: 2, randomization: NOTHING }),
    ).toThrow(/1 distinct version/)
  })

  test('a blank exam still exports as Version A', () => {
    const prepared = prepare(examOf([]), versionOf([]), { versionCount: 1, randomization: BOTH })
    expect(prepared.labels).toEqual(['A'])
    expect(prepared.documents.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// What comes out, and in what order

describe('the prepared collection', () => {
  test('is the student tests alone when only the test is selected', () => {
    const prepared = prepare(mixedExam(), mixedVersion(), {
      versionCount: 3,
      randomization: BOTH,
      selection: { test: true, answerKey: false },
    })
    expect(prepared.documents.map((one) => `${one.stream} ${one.label}`)).toEqual([
      'test A',
      'test B',
      'test C',
    ])
  })

  test('is the answer keys alone when only the key is selected', () => {
    const prepared = prepare(mixedExam(), mixedVersion(), {
      versionCount: 2,
      randomization: BOTH,
      selection: { test: false, answerKey: true },
    })
    expect(prepared.documents.map((one) => `${one.stream} ${one.label}`)).toEqual([
      'answer-key A',
      'answer-key B',
    ])
  })

  test('puts every student test before every answer key', () => {
    const prepared = prepare(mixedExam(), mixedVersion(), {
      versionCount: 3,
      randomization: BOTH,
      selection: { test: true, answerKey: true },
    })
    expect(prepared.documents.map((one) => `${one.stream} ${one.label}`)).toEqual([
      'test A',
      'test B',
      'test C',
      'answer-key A',
      'answer-key B',
      'answer-key C',
    ])
  })

  test('starts every standalone document at page one', () => {
    const prepared = prepare(mixedExam(), mixedVersion(), {
      versionCount: 3,
      randomization: BOTH,
      selection: { test: true, answerKey: true },
    })
    for (const document of prepared.documents) {
      expect(document.plan.pages[0]!.furniture.pageNumber).toBe(1)
      expect(document.plan.pages.map((page) => page.number)).toEqual(
        document.plan.pages.map((_page, index) => index + 1),
      )
    }
  })

  test('labels every page of every document with its own Version', () => {
    const prepared = prepare(mixedExam(), mixedVersion(), {
      versionCount: 3,
      randomization: BOTH,
      selection: { test: true, answerKey: true },
    })
    for (const document of prepared.documents) {
      for (const page of document.plan.pages) {
        expect(page.furniture.versionLabel).toBe(`ID: ${document.label}`)
      }
      expect(document.plan.pages.every((page) => page.stream === document.stream)).toBe(true)
    }
  })

  test('refuses an empty content selection', () => {
    expect(() =>
      prepare(mixedExam(), mixedVersion(), { selection: { test: false, answerKey: false } }),
    ).toThrow(/student test/)
  })

  test('generates a fresh set each time it is asked', () => {
    const exam = mixedExam()
    const version = mixedVersion()
    const first = plansOf(prepare(exam, version, { versionCount: 4, randomization: BOTH }, fixedRandom([0.9, 0.2, 0.4, 0.7])))
    const second = plansOf(prepare(exam, version, { versionCount: 4, randomization: BOTH }, fixedRandom([0.1, 0.8, 0.3, 0.6])))

    // Version A is the paper on screen both times; the generated ones are not
    // reproduced from anything, so a second export is a second draw.
    expect(arrangementOf(first[0]!)).toEqual(arrangementOf(second[0]!))
    expect(first.slice(1).map(arrangementOf)).not.toEqual(second.slice(1).map(arrangementOf))
  })

  test('reports progress it can actually measure', () => {
    const progress: PreparationProgress[] = []
    prepareExport({
      exam: mixedExam(),
      version: mixedVersion(),
      configuration: configurationOf({
        versionCount: 3,
        randomization: BOTH,
        selection: { test: true, answerKey: true },
      }),
      random: fixedRandom(),
      measure: unmeasured,
      onProgress: (update) => progress.push(update),
    })

    expect(progress.filter((one) => one.stage === 'versions').map((one) => one.completed))
      .toEqual([1, 2, 3])
    const planning = progress.filter((one) => one.stage === 'planning')
    expect(planning.map((one) => one.completed)).toEqual([1, 2, 3, 4, 5, 6])
    expect(planning.every((one) => one.total === 6)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Artifact metadata

describe('the artifact', () => {
  test('names one version’s file after that version', () => {
    expect(prepare(mixedExam(), mixedVersion()).filename).toBe(
      'Chemistry Unit 3-version-A.docx',
    )
  })

  test('names a set after the range it holds', () => {
    const prepared = prepare(mixedExam(), mixedVersion(), {
      versionCount: 4,
      randomization: BOTH,
    })
    expect(prepared.filename).toBe('Chemistry Unit 3-versions-A-D.docx')
  })

  test('sanitizes a title a filesystem would refuse', () => {
    expect(docxFilename('Unit 3: Review / Retake', ['A'])).toBe(
      'Unit 3- Review - Retake-version-A.docx',
    )
    expect(docxFilename('   ', ['A', 'B'])).toBe('Untitled exam-versions-A-B.docx')
  })
})

// ---------------------------------------------------------------------------
// Question Bank compatibility
//
// Preparation is unchanged by the Question Bank: it still takes an Exam and an
// ordering. What is new is where that pair comes from, so these are the cases
// that prove the derived pair is a pair preparation is happy with — and that
// Question Content sitting unused in the bank cannot reach a published paper.

describe('an Exam Draft prepared for export', () => {
  const bankOf = (questions: Question[]) =>
    questions.reduce(withQuestionBanked, createQuestionBank())

  const draftOf = (questionIds: string[]) =>
    questionIds.reduce(
      (draft, id) => withReferenceAdded(draft, id),
      createExamDraft('Chemistry Unit 3'),
    )

  const publishedIds = (plan: LayoutPlan) =>
    itemsOf(plan).flatMap((item) =>
      item.kind === 'question' ? [item.question.id] : [],
    )

  test('publishes the referenced questions and nothing else', () => {
    const questions = mixedExam().questions
    const { exam, version } = selectedExam(
      bankOf(questions),
      draftOf(['m2', 'o2']),
    )

    const prepared = prepare(exam, version, {
      selection: { test: true, answerKey: true },
    })

    for (const document of prepared.documents) {
      if (document.stream === 'test') {
        expect(publishedIds(document.plan)).toEqual(['m2', 'o2'])
      } else {
        // The key answers exactly the questions the paper asked.
        expect(answerKeyOf(document.plan).map((entry) => entry.number)).toEqual([1, 2])
      }
    }
  })

  test('leaves unused Question Bank content out of every Randomized Version', () => {
    const questions = mixedExam().questions
    const { exam, version } = selectedExam(
      bankOf(questions),
      draftOf(['m1', 'm2', 'o1']),
    )

    const prepared = prepare(exam, version, {
      versionCount: 3,
      randomization: BOTH,
      selection: { test: true, answerKey: true },
    })

    expect(prepared.labels).toEqual(['A', 'B', 'C'])
    for (const document of prepared.documents) {
      if (document.stream === 'test') {
        expect(publishedIds(document.plan).toSorted()).toEqual(['m1', 'm2', 'o1'])
      } else {
        expect(answerKeyOf(document.plan).map((entry) => entry.number)).toEqual([1, 2, 3])
      }
    }
  })

  test('publishes Version A in Exam Draft order, with answers as authored', () => {
    const questions = mixedExam().questions
    const { exam, version } = selectedExam(
      bankOf(questions),
      draftOf(['m3', 'm1', 'o2']),
    )

    const prepared = prepare(exam, version)

    expect(arrangementOf(prepared.documents[0]!.plan)).toEqual([
      '1:m3(A=c1,B=c2,C=c3,D=c4)',
      '2:m1(A=a1,B=a2,C=a3,D=a4)',
      '3:o2()',
    ])
  })

  test('counts only the referenced questions towards the distinct Versions available', () => {
    const questions = mixedExam().questions
    const bank = bankOf(questions)
    // One multiple-choice question with four answers: 4! = 24 arrangements,
    // whatever else is sitting unused in the Question Bank.
    const { exam, version } = selectedExam(bank, draftOf(['m1']))

    expect(maxDistinctVersions(exam, version, ANSWERS_ONLY)).toBe(24)
  })
})
