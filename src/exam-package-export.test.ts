import { describe, expect, test } from 'bun:test'
import {
  choicesOf,
  orderedChoices,
  orderedQuestions,
  type Arrangement,
  type Exam,
  type Question,
} from './exam'
import { unmeasured } from './export-plan'
import { prepareExport, prepareHistoricalExport, EMPTY_EXPORT_HISTORY, type ExportConfiguration } from './export-preparation'
import { printFingerprint } from './print-fingerprint'
import { createPublicationPdf, type PdfFontLoader } from './pdf-export'
import { withExamPackage } from './exam-package-export'
import { initialSelection } from './import-selection'
import { planImport } from './package-commit'
import { inspectImportFile } from './package-import'
import { selectedExam } from './selected-exam'
import type { QuestionBankResource } from './question-bank-workspaces'

const fontFiles = {
  regular: 'FreeSerif.ttf',
  bold: 'FreeSerifBold.ttf',
  italic: 'FreeSerifItalic.ttf',
  boldItalic: 'FreeSerifBoldItalic.ttf',
  mono: 'FreeMono.ttf',
} as const
const fonts: PdfFontLoader = async (style) =>
  Bun.file(new URL(`../public/fonts/${fontFiles[style]}`, import.meta.url).pathname).arrayBuffer()
const noImages = async () => null

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })

function multipleChoice(id: string, stem: string, answers: string[]): Question {
  return {
    id,
    type: 'multiple-choice',
    columns: 2,
    doc: {
      type: 'doc',
      content: [paragraph(stem), {
        type: 'multipleChoice',
        content: answers.map((answer, index) => ({
          type: 'multipleChoiceChoice',
          attrs: { id: `${id}-choice-${index}`, correct: index === 0 },
          content: [paragraph(answer)],
        })),
      }],
    },
  }
}

function matching(id: string): Question {
  return {
    id,
    type: 'matching',
    columns: 1,
    doc: {
      type: 'doc',
      content: [paragraph('Match each term.'), {
        type: 'matching',
        content: [
          { type: 'matchingPrompt', attrs: { id: `${id}-p1`, answer: `${id}-a2` }, content: [paragraph('Nucleus')] },
          { type: 'matchingPrompt', attrs: { id: `${id}-p2`, answer: `${id}-a1` }, content: [paragraph('Ribosome')] },
          { type: 'matchingAnswer', attrs: { id: `${id}-a1` }, content: [paragraph('Builds proteins')] },
          { type: 'matchingAnswer', attrs: { id: `${id}-a2` }, content: [paragraph('Holds DNA')] },
          { type: 'matchingAnswer', attrs: { id: `${id}-a3` }, content: [paragraph('Stores water')] },
        ],
      }],
    },
  }
}

function shortAnswer(id: string, stem: string): Question {
  return { id, type: 'open', columns: 1, doc: { type: 'doc', content: [paragraph(stem)] } }
}

const cellsQuestion = multipleChoice('cells-1', 'Which organelle releases energy?', ['Mitochondrion', 'Nucleus', 'Ribosome', 'Vacuole'])
const unusedQuestion = multipleChoice('cells-unused', 'Never printed', ['A', 'B'])
const matchingQuestion = matching('cells-2')
const forcesQuestion = shortAnswer('forces-1', 'Describe what a newton measures.')
const forcesSecond = multipleChoice('forces-2', 'Which is a unit of force?', ['Newton', 'Joule'])

const bank = (id: string, name: string, questions: Question[]): QuestionBankResource => ({
  id, name, createdAt: '2026-01-01T00:00:00.000Z', lastUpdatedAt: '2026-01-01T00:00:00.000Z', questions,
})
const cells = bank('cells', 'Cells', [cellsQuestion, unusedQuestion, matchingQuestion])
const forces = bank('forces', 'Forces', [forcesQuestion, forcesSecond])
const ownerOf = async (questionId: string) =>
  [cells, forces].find((candidate) => candidate.questions.some(({ id }) => id === questionId)) ?? null

// A Working Copy as the editor presents it: columns set on the sheet, answers
// shuffled, and room for work below the Short Answer.
const exam: Exam = {
  title: 'Cells and Forces',
  questions: [
    { ...cellsQuestion, columns: 4 },
    matchingQuestion,
    forcesQuestion,
    { ...forcesSecond, columns: 1 },
  ],
  workSpace: { 'forces-1': { height: 96, style: 'lines', fill: false } },
}
const arrangement: Arrangement = {
  id: 'exam-draft',
  letter: 'A',
  questionOrder: ['forces-2', 'cells-1', 'cells-2', 'forces-1'],
  choiceOrder: {
    'cells-1': ['cells-1-choice-2', 'cells-1-choice-0', 'cells-1-choice-3', 'cells-1-choice-1'],
    'cells-2': ['cells-2-a3', 'cells-2-a1', 'cells-2-a2'],
  },
}

function prepared(configuration: ExportConfiguration) {
  return prepareExport({
    examId: 'exam-1',
    exam,
    arrangement,
    configuration,
    history: EMPTY_EXPORT_HISTORY,
    measure: unmeasured,
    createdAt: '2026-09-24T00:00:00.000Z',
    createId: () => 'record-1',
  })
}

const text = (question: Question) => JSON.stringify(question.doc).match(/"text":"([^"]+)"/)![1]
const answerTexts = (question: Question, order: Arrangement) =>
  orderedChoices(question, order).map((choice) => JSON.stringify(choice.node).match(/"text":"([^"]+)"/)![1])

/** What a sheet prints, reduced to what a teacher would compare by eye. */
function printed(sheet: Exam, order: Arrangement) {
  return orderedQuestions(sheet, order).map((question) => ({
    type: question.type,
    stem: text(question),
    columns: question.type === 'multiple-choice' ? question.columns : undefined,
    answers: choicesOf(question).length ? answerTexts(question, order) : [],
    workSpace: sheet.workSpace?.[question.id],
  }))
}

describe('an Exam PDF carrying its Exam', () => {
  test('re-importing an answer-key PDF reproduces exactly what it printed', async () => {
    const withPackage = await withExamPackage(
      prepared({ format: 'pdf', selection: { test: true, answerKey: true } }),
      { exam, arrangement, ownerOf, loadMedia: noImages },
    )
    const pdf = await createPublicationPdf(withPackage.documents, noImages, fonts, withPackage.record.examPackage)

    const proposal = await inspectImportFile(pdf)

    // Each owning bank holds only the Questions this Exam uses.
    expect(proposal.banks.map(({ record }) => ({
      name: record.bank.name,
      questions: record.bank.questions.length,
    }))).toEqual([
      { name: 'Forces', questions: 2 },
      { name: 'Cells', questions: 2 },
    ])
    expect(JSON.stringify(proposal)).not.toContain('Never printed')
    expect(proposal.exams).toHaveLength(1)

    let next = 0
    const plan = planImport(proposal, initialSelection(proposal), () => `local-${next++}`)
    const { exam: imported, arrangement: importedOrder } = selectedExam(
      plan.exams[0]!.saved.questionBank,
      plan.exams[0]!.saved.workingCopy,
    )
    expect(imported.title).toBe('Cells and Forces')
    expect(printed(imported, importedOrder)).toEqual(printed(exam, arrangement))
  })

  test('a student-only PDF and a DOCX carry nothing, and the pages are unchanged', async () => {
    const studentOnly = await withExamPackage(
      prepared({ format: 'pdf', selection: { test: true, answerKey: false } }),
      { exam, arrangement, ownerOf, loadMedia: noImages },
    )
    expect(studentOnly.record.examPackage).toBeUndefined()
    const pdf = await createPublicationPdf(studentOnly.documents, noImages, fonts, studentOnly.record.examPackage)
    await expect(inspectImportFile(pdf)).rejects.toMatchObject({ code: 'missing-attachment' })

    const docx = await withExamPackage(
      prepared({ format: 'docx', selection: { test: true, answerKey: true } }),
      { exam, arrangement, ownerOf, loadMedia: noImages },
    )
    expect(docx.record.examPackage).toBeUndefined()

    const before = prepared({ format: 'pdf', selection: { test: true, answerKey: true } })
    const after = await withExamPackage(before, { exam, arrangement, ownerOf, loadMedia: noImages })
    expect(after.record.examPackage).toBeDefined()
    expect(printFingerprint(after.documents)).toEqual(printFingerprint(before.documents))
    expect(after.record.plans).toEqual(before.record.plans)
  })

  test('a historical re-export embeds the record’s own package', async () => {
    const original = await withExamPackage(
      prepared({ format: 'pdf', selection: { test: true, answerKey: true } }),
      { exam, arrangement, ownerOf, loadMedia: noImages },
    )
    const again = prepareHistoricalExport({
      record: original.record,
      createdAt: '2026-09-25T00:00:00.000Z',
      createId: () => 'record-2',
    })
    expect(again.record.examPackage).toBe(original.record.examPackage)
  })
})
