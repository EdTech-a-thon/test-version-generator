import {
  choicesOf,
  columnsOf,
  hasWorkSpace,
  orderedChoices,
  orderedQuestions,
  sectionIdOf,
  sectionsOf,
  takesWorkSpace,
  workSpaceOf,
  type Arrangement,
  type Exam,
  type Question,
} from './exam'
import type { PreparedExport } from './export-preparation'
import {
  QUESTION_BANK_FORMAT_VERSION,
  prepareQuestionBankExport,
  type QuestionBankMediaLoader,
} from './question-bank-export'
import type { QuestionBankResource } from './question-bank-workspaces'
import {
  EXAM_FORMAT,
  EXAM_FORMAT_VERSION,
  PACKAGE_FORMAT,
  PACKAGE_FORMAT_VERSION,
  type ExamRecord,
  type ExamRecordPosition,
  type ExamRecordSection,
  type TestParrotPackage,
} from './package-import'

/**
 * The Test Parrot Package an Exam PDF carries: one Exam Record for exactly
 * what that export printed, and for each bank the Exam draws on a Question
 * Bank Record holding only the Questions it uses.
 *
 * Only a PDF whose Content Selection includes the answer key carries one — a
 * Question Bank Record holds the answers, so a student-only PDF must not —
 * and a DOCX never does, because a teacher's Word edits would leave it stale.
 * The package is kept on the Export Record beside its Layout Plans rather
 * than in them, so the Export Fingerprint and print/DOCX parity, which are
 * about pages, never see it.
 */

export function carriesExamPackage(prepared: PreparedExport): boolean {
  return prepared.record.format === 'pdf' && prepared.record.selection.answerKey
}

/** The bank a Question belongs to, or null for one no bank owns. */
export type QuestionOwner = (questionId: string) => Promise<QuestionBankResource | null>

export async function examPackage({
  exam,
  arrangement,
  ownerOf,
  loadMedia,
}: {
  exam: Exam
  arrangement: Arrangement
  ownerOf: QuestionOwner
  loadMedia?: QuestionBankMediaLoader
}): Promise<TestParrotPackage> {
  const printed = orderedQuestions(exam, arrangement)
  const owners = await Promise.all(printed.map((question) => ownerOf(question.id)))

  // Group by owning bank, in the order the Exam first uses each. A Question
  // no bank owns still printed, so it travels in a bank named for the Exam.
  const groups: { bank: Omit<QuestionBankResource, 'questions'>; questions: Question[] }[] = []
  const groupOf = new Map<string, (typeof groups)[number]>()
  printed.forEach((question, index) => {
    const owner = owners[index]
    const key = owner?.id ?? ''
    let group = groupOf.get(key)
    if (!group) {
      const bank: Omit<QuestionBankResource, 'questions'> = owner
        ? {
            id: owner.id,
            name: owner.name,
            createdAt: owner.createdAt,
            lastUpdatedAt: owner.lastUpdatedAt,
            ...(owner.description !== undefined ? { description: owner.description } : {}),
            ...(owner.author !== undefined ? { author: owner.author } : {}),
            ...(owner.license !== undefined ? { license: { ...owner.license } } : {}),
          }
        : { id: '', name: exam.title, createdAt: '', lastUpdatedAt: '' }
      group = { bank, questions: [] }
      groupOf.set(key, group)
      groups.push(group)
    }
    group.questions.push(question)
  })

  // The record exporter numbers Questions and answers by position, so where
  // each printed Question landed is read back off that numbering.
  const recordIds = new Map<string, { bank: string; question: string; answers: Map<string, string> }>()
  const questionBanks = await Promise.all(groups.map(async (group, groupIndex) => {
    const bankId = `bank-${groupIndex + 1}`
    const prepared = await prepareQuestionBankExport({ ...group.bank, questions: group.questions }, loadMedia)
    group.questions.forEach((question, questionIndex) => {
      const record = prepared.record.bank.questions[questionIndex]!
      const recordAnswers = record.choices ?? record.wordBank ?? []
      recordIds.set(question.id, {
        bank: bankId,
        question: record.id,
        answers: new Map(choicesOf(question).map((choice, answerIndex) => [choice.id, recordAnswers[answerIndex]!.id])),
      })
    })
    return { id: bankId, record: prepared.record }
  }))

  // A Multipart question travels as a bare position. Its Parts' answer order, answer
  // columns and Work Space are not carried yet — Exam Record 0.1.0 keys
  // presentation by Question and has nowhere to put a Part's — so the
  // imported Exam gives each Part its defaults.
  // Every Section travels, empty ones included, in print order, with its
  // wording in full — an empty string is a part the teacher cleared. A
  // Section has no type. `sectionsOf` has already folded an Exam's legacy
  // per-type wording into its derived Sections.
  const sections = sectionsOf(exam)
  const sectionIndex = new Map(sections.map((section, index) => [section.id, index]))
  const positions = printed.map((question): ExamRecordPosition => {
    const ids = recordIds.get(question.id)!
    const space = workSpaceOf(exam, question.id)
    return {
      question: { bank: ids.bank, question: ids.question },
      section: sectionIndex.get(sectionIdOf(exam, question))!,
      ...(question.type === 'multiple-choice' ? { columns: columnsOf(question) } : {}),
      ...(question.type === 'multiple-choice' || question.type === 'matching'
        ? { answerOrder: orderedChoices(question, arrangement).map(({ id }) => ids.answers.get(id)!) }
        : {}),
      ...(takesWorkSpace(question.type) && hasWorkSpace(space) ? { workSpace: { ...space } } : {}),
    }
  })
  const examRecord: ExamRecord = {
    format: EXAM_FORMAT,
    formatVersion: EXAM_FORMAT_VERSION,
    name: exam.title,
    sections: sections.map(({ title, instructions }): ExamRecordSection => ({ title, instructions })),
    ...(exam.headingSize && exam.headingSize !== 'normal' ? { headingSize: exam.headingSize } : {}),
    ...(exam.textSize && exam.textSize !== 'normal' ? { textSize: exam.textSize } : {}),
    ...(exam.header ? { header: { ...exam.header } } : {}),
    positions,
  }
  return {
    format: PACKAGE_FORMAT,
    formatVersion: PACKAGE_FORMAT_VERSION,
    generator: { name: 'Test Parrot', version: QUESTION_BANK_FORMAT_VERSION },
    requiredFeatures: [],
    questionBanks,
    exams: [examRecord],
  }
}

/** The prepared export with its package recorded, when it carries one. A
 *  package that cannot be built — a Question a bank could not share yet, an
 *  image that will not load — leaves the PDF without one rather than
 *  stopping an export that would otherwise print. */
export async function withExamPackage(
  prepared: PreparedExport,
  source: { exam: Exam; arrangement: Arrangement; ownerOf: QuestionOwner; loadMedia?: QuestionBankMediaLoader },
): Promise<PreparedExport> {
  if (!carriesExamPackage(prepared)) return prepared
  try {
    const carried = await examPackage(source)
    return { ...prepared, record: { ...prepared.record, examPackage: JSON.stringify(carried) } }
  } catch (error) {
    console.warn('This PDF will not carry its Exam for import', error)
    return prepared
  }
}
