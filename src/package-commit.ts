import {
  DEFAULT_EXAM_TITLE,
  snapWorkSpaceHeight,
  type ColumnSetting,
  type Question,
  type WorkSpace,
} from './exam'
import type { SavedState } from './exam-store'
import type { ImportSelection } from './import-selection'
import type { ImportProposal } from './package-import'
import { createWorkingCopy } from './question-bank'
import { UNTITLED_QUESTION_BANK } from './question-bank-workspaces'
import {
  importedQuestionIdentities,
  type ImportedQuestionIdentity,
  type ParsedQuestionBankRecord,
} from './question-bank-import'

/**
 * What one import writes, worked out before anything is written: the banks to
 * create, the Questions to append to existing banks, the Media Assets to
 * store, and each Exam's saved state. The storage service applies a plan in
 * one go; planning is pure so the id mapping and the Exam defaults can be
 * read and tested without storage.
 */

export type PlannedBank = {
  /** The package-local bank id this came from. */
  source: string
  /** The local bank the Questions land in: a fresh id, or the existing
   *  bank's. */
  bankId: string
  /** Present for a new bank, absent when appending to an existing one — an
   *  existing bank keeps its own name and provenance. */
  created?: {
    name: string
    description?: string
    author?: string
    license?: { name: string; url?: string }
  }
  questions: Question[]
}

export type PlannedExam = {
  source: string
  examId: string
  saved: SavedState
  /** The local banks this Exam's Questions came from, in order of first
   *  use: the tabs its editor opens with. */
  bankIds: string[]
}

export type ImportPlan = {
  banks: PlannedBank[]
  media: ParsedQuestionBankRecord['media']
  exams: PlannedExam[]
}

/** Every Question and answer gets a fresh identity, nothing is deduplicated,
 *  and only allowed items appear. A selection whose allowed Exam needs a
 *  denied bank is refused rather than half-applied. */
export function planImport(
  proposal: ImportProposal,
  selection: ImportSelection,
  createId: () => string = () => crypto.randomUUID(),
): ImportPlan {
  const identities = new Map<string, Map<string, ImportedQuestionIdentity>>()
  const localBankIds = new Map<string, string>()
  const banks: PlannedBank[] = []
  const media = new Map<string, ParsedQuestionBankRecord['media'][number]>()
  for (const bank of proposal.banks) {
    const chosen = selection.banks[bank.id]
    if (!chosen?.allowed) continue
    const imported = importedQuestionIdentities(bank.record, createId)
    identities.set(bank.id, imported)
    const bankId = chosen.target.kind === 'existing' ? chosen.target.bankId : createId()
    localBankIds.set(bank.id, bankId)
    const { record } = bank
    banks.push({
      source: bank.id,
      bankId,
      ...(chosen.target.kind === 'new'
        ? {
            created: {
              name: chosen.target.name.trim() || UNTITLED_QUESTION_BANK,
              ...(record.bank.description !== undefined ? { description: record.bank.description } : {}),
              ...(record.bank.author !== undefined ? { author: record.bank.author } : {}),
              ...(record.bank.license !== undefined ? { license: { ...record.bank.license } } : {}),
            },
          }
        : {}),
      questions: [...imported.values()].map(({ question }) => question),
    })
    for (const asset of record.media) media.set(asset.id, asset)
  }

  const exams = proposal.exams.flatMap((exam): PlannedExam[] => {
    if (!selection.exams[exam.key]?.allowed) return []
    const missing = exam.banks.filter((id) => !identities.has(id))
    if (missing.length > 0) {
      throw new Error(`“${exam.name}” needs a Question Bank that is not being imported: ${missing.join(', ')}.`)
    }
    const questions: Question[] = []
    const columns: Record<string, ColumnSetting> = {}
    const choiceOrder: Record<string, string[]> = {}
    const workSpace: Record<string, WorkSpace> = {}
    // The rule a teacher adding a Question meets: a Multiple Choice Question
    // takes the layout of the one before it, and the first takes one column.
    let previousColumns: ColumnSetting | undefined
    for (const position of exam.positions) {
      const { question, answers } = identities.get(position.question.bank)!.get(position.question.question)!
      questions.push(question)
      if (question.type === 'multiple-choice') {
        previousColumns = position.columns ?? previousColumns ?? 1
        columns[question.id] = previousColumns
      }
      if (position.answerOrder) {
        choiceOrder[question.id] = position.answerOrder.map((id) => answers.get(id)!)
      }
      if (position.workSpace) {
        workSpace[question.id] = {
          height: snapWorkSpaceHeight(position.workSpace.height),
          style: position.workSpace.style,
          fill: position.workSpace.fill,
        }
      }
    }
    const workingCopy = {
      ...createWorkingCopy(exam.name.trim() || DEFAULT_EXAM_TITLE),
      questionIds: questions.map(({ id }) => id),
      choiceOrder,
      ...(Object.keys(columns).length > 0 ? { columns } : {}),
      ...(Object.keys(workSpace).length > 0 ? { workSpace } : {}),
      ...(exam.sectionHeadings ? { sectionHeadings: exam.sectionHeadings } : {}),
      ...(exam.headingSize ? { headingSize: exam.headingSize } : {}),
      ...(exam.textSize ? { textSize: exam.textSize } : {}),
      ...(exam.header ? { header: exam.header } : {}),
    }
    return [{
      source: exam.key,
      examId: createId(),
      saved: { questionBank: { questions }, workingCopy },
      bankIds: exam.banks.map((id) => localBankIds.get(id)!),
    }]
  })

  return { banks, media: [...media.values()], exams }
}
