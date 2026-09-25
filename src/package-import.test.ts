import { describe, expect, test } from 'bun:test'
import { PDFDocument } from 'pdf-lib'
import {
  QUESTION_BANK_ATTACHMENT_DESCRIPTION,
  QUESTION_BANK_ATTACHMENT_NAME,
  QUESTION_BANK_FORMAT,
  QUESTION_BANK_FORMAT_VERSION,
  type QuestionBankRecord,
  type QuestionBankRecordQuestion,
} from './question-bank-export'
import { QuestionBankImportError } from './question-bank-import'
import {
  BARE_RECORD_BANK_ID,
  DEFAULT_PACKAGE_IMPORT_LIMITS,
  inspectImportFile,
  inspectImportRecord,
  type ExamRecordPosition,
} from './package-import'

const encoder = new TextEncoder()

const paragraph = (value: string) => ({
  type: 'document' as const,
  content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }],
})

function multipleChoice(id: string, answers = 3): QuestionBankRecordQuestion {
  return {
    id,
    type: 'multiple-choice',
    stem: paragraph(`Question ${id}`),
    choices: Array.from({ length: answers }, (_, index) => ({
      id: `${id}-c${index + 1}`,
      content: paragraph(`Answer ${index + 1}`),
      correct: index === 0,
    })),
  }
}

function shortAnswer(id: string): QuestionBankRecordQuestion {
  return { id, type: 'short-answer', stem: paragraph(`Explain ${id}`) }
}

function trueFalse(id: string): QuestionBankRecordQuestion {
  return {
    id,
    type: 'true-false',
    stem: paragraph(`Is ${id} true?`),
    choices: [
      { id: `${id}-c1`, content: paragraph('True'), correct: true },
      { id: `${id}-c2`, content: paragraph('False'), correct: false },
    ],
  }
}

function matching(id: string): QuestionBankRecordQuestion {
  return {
    id,
    type: 'matching',
    stem: paragraph(`Match ${id}`),
    prompts: [
      { id: `${id}-p1`, content: paragraph('One'), answer: `${id}-a1` },
      { id: `${id}-p2`, content: paragraph('Two'), answer: `${id}-a2` },
    ],
    wordBank: [
      { id: `${id}-a1`, content: paragraph('1') },
      { id: `${id}-a2`, content: paragraph('2') },
      { id: `${id}-a3`, content: paragraph('3') },
    ],
  }
}

function multipart(id: string): QuestionBankRecordQuestion {
  return {
    id,
    type: 'multipart',
    stem: paragraph(`Read ${id}`),
    parts: [
      {
        id: `${id}-s1`,
        type: 'multiple-choice',
        stem: paragraph('Which?'),
        choices: [
          { id: `${id}-s1-c1`, content: paragraph('This'), correct: true },
          { id: `${id}-s1-c2`, content: paragraph('That'), correct: false },
        ],
      },
      { id: `${id}-s2`, type: 'short-answer', stem: paragraph('Why?') },
    ],
  }
}

function bankRecord(name: string, questions: QuestionBankRecordQuestion[]): QuestionBankRecord {
  return {
    format: QUESTION_BANK_FORMAT,
    formatVersion: QUESTION_BANK_FORMAT_VERSION,
    generator: { name: 'Test', version: '1' },
    requiredFeatures: [],
    bank: { name, questions },
    media: [],
  }
}

function at(bank: string, question: string, extra: Omit<ExamRecordPosition, 'question'> = {}) {
  return { question: { bank, question }, ...extra }
}

function examRecord(name: string, positions: unknown[]) {
  return { format: 'test-parrot/exam', formatVersion: '0.1.0', name, positions }
}

function packageOf(
  banks: { id: string; record: unknown }[],
  exams: unknown[] = [],
): Record<string, unknown> {
  return {
    format: 'test-parrot/package',
    formatVersion: '0.1.0',
    generator: { name: 'Test', version: '1' },
    requiredFeatures: [],
    questionBanks: banks,
    exams,
  }
}

const bytesOf = (value: unknown) => encoder.encode(JSON.stringify(value))

async function rejected(value: unknown, code: QuestionBankImportError['code'], text?: string) {
  try {
    await inspectImportRecord(bytesOf(value))
  } catch (error) {
    expect(error).toBeInstanceOf(QuestionBankImportError)
    expect((error as QuestionBankImportError).code).toBe(code)
    if (text) expect((error as Error).message).toContain(text)
    return
  }
  throw new Error('Expected inspection to reject')
}

const chemistry = () => bankRecord('Chemistry', [multipleChoice('q1'), shortAnswer('q2'), multipleChoice('q3')])

describe('inspecting a Test Parrot Package', () => {
  test('a bare Question Bank Record reads as one bank and no Exams', async () => {
    const proposal = await inspectImportRecord(bytesOf(chemistry()))

    expect(proposal.source).toEqual({ format: QUESTION_BANK_FORMAT, formatVersion: '0.5.0' })
    expect(proposal.banks).toHaveLength(1)
    expect(proposal.banks[0]).toMatchObject({
      id: BARE_RECORD_BANK_ID,
      exams: [],
      summary: { bankName: 'Chemistry', questionCounts: { 'multiple-choice': 2, 'short-answer': 1 } },
    })
    expect(proposal.exams).toEqual([])
  })

  test('a bank with an Exam lists both and the dependency between them', async () => {
    const proposal = await inspectImportRecord(bytesOf(packageOf(
      [{ id: 'chem', record: chemistry() }],
      [examRecord('Unit 1 Test', [
        at('chem', 'q3', { columns: 4, answerOrder: ['q3-c3', 'q3-c1', 'q3-c2'] }),
        at('chem', 'q2', { workSpace: { height: 96, style: 'lines', fill: false } }),
      ])],
    )))

    expect(proposal.source).toEqual({ format: 'test-parrot/package', formatVersion: '0.1.0' })
    expect(proposal.banks.map(({ id, exams }) => ({ id, exams }))).toEqual([
      { id: 'chem', exams: ['exam-1'] },
    ])
    expect(proposal.exams).toEqual([{
      key: 'exam-1',
      name: 'Unit 1 Test',
      formatVersion: '0.1.0',
      banks: ['chem'],
      positions: [
        at('chem', 'q3', { columns: 4, answerOrder: ['q3-c3', 'q3-c1', 'q3-c2'] }),
        at('chem', 'q2', { workSpace: { height: 96, style: 'lines', fill: false } }),
      ],
    }])
  })

  test('several Exams may share one bank, and a bank may hold Questions no Exam uses', async () => {
    const proposal = await inspectImportRecord(bytesOf(packageOf(
      [{ id: 'chem', record: chemistry() }],
      [
        examRecord('Version A', [at('chem', 'q1', { answerOrder: ['q1-c1', 'q1-c2', 'q1-c3'] })]),
        examRecord('Version B', [at('chem', 'q1', { answerOrder: ['q1-c3', 'q1-c2', 'q1-c1'] })]),
      ],
    )))

    expect(proposal.banks[0]!.exams).toEqual(['exam-1', 'exam-2'])
    expect(proposal.exams.map(({ name, banks }) => ({ name, banks }))).toEqual([
      { name: 'Version A', banks: ['chem'] },
      { name: 'Version B', banks: ['chem'] },
    ])
  })

  test('an Exam may draw on several banks, and dependencies read both ways', async () => {
    const proposal = await inspectImportRecord(bytesOf(packageOf(
      [
        { id: 'chem', record: chemistry() },
        { id: 'phys', record: bankRecord('Physics', [trueFalse('q1')]) },
        { id: 'bio', record: bankRecord('Biology', [shortAnswer('q1')]) },
      ],
      [
        examRecord('Science', [at('phys', 'q1'), at('chem', 'q1')]),
        examRecord('Chemistry only', [at('chem', 'q2')]),
      ],
    )))

    expect(proposal.exams.map(({ banks }) => banks)).toEqual([['phys', 'chem'], ['chem']])
    expect(Object.fromEntries(proposal.banks.map(({ id, exams }) => [id, exams]))).toEqual({
      chem: ['exam-1', 'exam-2'],
      phys: ['exam-1'],
      bio: [],
    })
  })

  test('positions regroup into Section order, keeping order within each Section', async () => {
    const record = bankRecord('Mixed', [
      multipleChoice('q1'), multipleChoice('q2'), trueFalse('q3'), matching('q4'), shortAnswer('q5'), shortAnswer('q6'),
      multipart('q7'),
    ])
    const proposal = await inspectImportRecord(bytesOf(packageOf(
      [{ id: 'b', record }],
      [examRecord('Upside down', [
        at('b', 'q7'), at('b', 'q6'), at('b', 'q2'), at('b', 'q4'), at('b', 'q5'), at('b', 'q3'), at('b', 'q1'),
      ])],
    )))

    // A Multipart question prints last, in a Section of its own.
    expect(proposal.exams[0]!.positions.map(({ question }) => question.question)).toEqual([
      'q2', 'q1', 'q3', 'q4', 'q6', 'q5', 'q7',
    ])
  })

  test('a Multipart position is accepted as a whole Question, and per-Part presentation is not carried', async () => {
    const record = bankRecord('Passages', [multipart('q1')])
    const proposal = await inspectImportRecord(bytesOf(packageOf(
      [{ id: 'b', record }],
      [examRecord('Reading', [at('b', 'q1')])],
    )))

    expect(proposal.banks[0]!.summary.questionCounts.multipart).toBe(1)
    expect(proposal.exams[0]!.positions).toEqual([at('b', 'q1')])
    // Answer order belongs to a Part, not the Multipart question, and 0.1.0 cannot say
    // which Part it would be for.
    await rejected(
      packageOf([{ id: 'b', record }], [
        examRecord('Reading', [at('b', 'q1', { answerOrder: ['q1-s1-c2', 'q1-s1-c1'] })]),
      ]),
      'invalid-position',
      'answer order',
    )
  })

  test('a PDF carrier may hold a package', async () => {
    const pdf = await PDFDocument.create()
    pdf.addPage()
    await pdf.attach(
      bytesOf(packageOf([{ id: 'chem', record: chemistry() }], [examRecord('From PDF', [at('chem', 'q1')])])),
      QUESTION_BANK_ATTACHMENT_NAME,
      { description: QUESTION_BANK_ATTACHMENT_DESCRIPTION, mimeType: 'application/json' },
    )
    const proposal = await inspectImportFile(await pdf.save({ useObjectStreams: false }))

    expect(proposal.banks.map(({ id }) => id)).toEqual(['chem'])
    expect(proposal.exams.map(({ name }) => name)).toEqual(['From PDF'])
  })
})

describe('rejecting a Test Parrot Package whole', () => {
  const withExam = (positions: unknown[]) =>
    packageOf([{ id: 'chem', record: chemistry() }], [examRecord('Broken', positions)])

  test('an Exam referencing an unknown bank or Question', async () => {
    await rejected(withExam([at('elsewhere', 'q1')]), 'dangling-reference', 'elsewhere')
    await rejected(withExam([at('chem', 'q99')]), 'dangling-reference', 'q99')
  })

  test('one Question used twice in one Exam', async () => {
    await rejected(withExam([at('chem', 'q1'), at('chem', 'q1')]), 'duplicate-reference', 'q1')
  })

  test('a position option that does not fit its Question Type', async () => {
    await rejected(withExam([at('chem', 'q2', { columns: 2 })]), 'invalid-position', 'answer columns')
    await rejected(
      withExam([at('chem', 'q1', { workSpace: { height: 32, style: 'blank', fill: false } })]),
      'invalid-position',
      'Work Space',
    )
    await rejected(withExam([at('chem', 'q2', { answerOrder: [] })]), 'invalid-position', 'answer order')
    await rejected(
      packageOf([{ id: 'b', record: bankRecord('TF', [trueFalse('q1')]) }], [
        examRecord('TF', [at('b', 'q1', { answerOrder: ['q1-c2', 'q1-c1'] })]),
      ]),
      'invalid-position',
      'answer order',
    )
  })

  test('an answer order that is not an exact permutation', async () => {
    await rejected(withExam([at('chem', 'q1', { answerOrder: ['q1-c1', 'q1-c2'] })]), 'invalid-answer-order')
    await rejected(withExam([at('chem', 'q1', { answerOrder: ['q1-c1', 'q1-c1', 'q1-c2'] })]), 'invalid-answer-order')
    await rejected(withExam([at('chem', 'q1', { answerOrder: ['q1-c1', 'q1-c2', 'q3-c1'] })]), 'invalid-answer-order')
    await rejected(
      packageOf([{ id: 'b', record: bankRecord('M', [matching('q1')]) }], [
        examRecord('M', [at('b', 'q1', { answerOrder: ['q1-p1', 'q1-a2', 'q1-a3'] })]),
      ]),
      'invalid-answer-order',
    )
  })

  test('duplicated bank ids, and a package with no banks', async () => {
    await rejected(
      packageOf([{ id: 'chem', record: chemistry() }, { id: 'chem', record: chemistry() }]),
      'duplicate-id',
      'chem',
    )
    await rejected(packageOf([]), 'invalid-structure')
  })

  test('a bank inside a package obeys every Question Bank Record rule', async () => {
    const broken = chemistry()
    broken.bank.questions[1] = { ...broken.bank.questions[0]!, id: 'q1' }
    await rejected(packageOf([{ id: 'chem', record: broken }]), 'duplicate-id', 'q1')
  })

  test('an unsupported version of each format', async () => {
    await rejected({ ...packageOf([{ id: 'chem', record: chemistry() }]), formatVersion: '9.0.0' }, 'unsupported-version', 'Test Parrot Package')
    await rejected(
      packageOf([{ id: 'chem', record: { ...chemistry(), formatVersion: '9.0.0' } }]),
      'unsupported-version',
      'Question Bank',
    )
    await rejected(
      packageOf([{ id: 'chem', record: chemistry() }], [{ ...examRecord('Future', []), formatVersion: '9.0.0' }]),
      'unsupported-version',
      'Exam Record',
    )
  })

  test('an Exam Record on its own is not importable', async () => {
    await rejected(examRecord('Alone', [at('chem', 'q1')]), 'unsupported-format', 'Exam Record on its own')
  })

  test('an unsupported required feature', async () => {
    await rejected({ ...packageOf([{ id: 'chem', record: chemistry() }]), requiredFeatures: ['time-travel'] }, 'unsupported-feature')
  })

  test('limits apply to the package as a whole', async () => {
    const two = packageOf([
      { id: 'a', record: chemistry() },
      { id: 'b', record: chemistry() },
    ])
    const limit = (overrides: Partial<typeof DEFAULT_PACKAGE_IMPORT_LIMITS>) => ({
      limits: { ...DEFAULT_PACKAGE_IMPORT_LIMITS, ...overrides },
    })
    await expect(inspectImportRecord(bytesOf(two), limit({ questions: 6, banks: 2 }))).resolves.toBeDefined()
    await expect(inspectImportRecord(bytesOf(two), limit({ questions: 5 }))).rejects.toMatchObject({ code: 'question-count-limit' })
    await expect(inspectImportRecord(bytesOf(two), limit({ banks: 1 }))).rejects.toMatchObject({ code: 'bank-count-limit' })
    await expect(
      inspectImportRecord(bytesOf(packageOf([{ id: 'a', record: chemistry() }], [examRecord('1', []), examRecord('2', [])])), limit({ exams: 1 })),
    ).rejects.toMatchObject({ code: 'exam-count-limit' })
  })
})
