import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { choicesOf, type Question } from './exam'
import { createExamWorkspaceService } from './exam-workspaces'
import { initialSelection, setBankAllowed, setBankTarget, setExamAllowed } from './import-selection'
import { inspectImportRecord, type ImportProposal } from './package-import'
import { createQuestionBankWorkspaceService } from './question-bank-workspaces'

// Every test starts from empty storage.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

const examples = join(import.meta.dir, '..', 'public', 'formats', 'package', '0.1.0', 'examples')
const inspect = async (name: string) => inspectImportRecord(await Bun.file(join(examples, name)).bytes())

function services() {
  const banks = createQuestionBankWorkspaceService()
  const exams = createExamWorkspaceService()
  return { banks, exams }
}

async function examState(exams: ReturnType<typeof createExamWorkspaceService>, id: string) {
  const backend = exams.backendFor(id)
  return { working: await backend.read(), saved: await backend.readSaved() }
}

const answerTexts = (question: Question, order?: readonly string[]) => {
  const choices = choicesOf(question)
  const ordered = order ? order.map((id) => choices.find((choice) => choice.id === id)!) : choices
  return ordered.map((choice) => JSON.stringify(choice.node).match(/"text":"([^"]+)"/)![1])
}

describe('committing an import', () => {
  test('a bare record creates one new bank and no Exam', async () => {
    const { banks, exams } = services()
    const proposal = await inspect('bank-only.json')
    const result = await banks.commitImport(proposal, initialSelection(proposal))

    expect(result.createdExamIds).toEqual([])
    expect(result.updatedBankIds).toEqual([])
    expect(result.createdBankIds).toHaveLength(1)
    const bank = await banks.read(result.createdBankIds[0]!)
    expect(bank).toMatchObject({ name: 'Cells' })
    expect(bank!.questions.map(({ type }) => type)).toEqual([
      'multiple-choice', 'multiple-choice', 'true-false', 'matching', 'open',
    ])
    expect(await exams.recent()).toEqual([])
  })

  test('a new bank takes the teacher’s name', async () => {
    const { banks } = services()
    const proposal = await inspect('bank-only.json')
    const selection = setBankTarget(initialSelection(proposal), 'cells', { kind: 'new', name: '  Biology 7  ' })
    const { createdBankIds } = await banks.commitImport(proposal, selection)
    expect((await banks.read(createdBankIds[0]!))!.name).toBe('Biology 7')
  })

  test('merging appends fresh Questions and keeps the target bank’s details', async () => {
    const { banks } = services()
    const proposal = await inspect('bank-only.json')
    const first = await banks.commitImport(proposal, initialSelection(proposal))
    const targetId = first.createdBankIds[0]!
    const before = (await banks.read(targetId))!
    await banks.commit(targetId, { kind: 'rename', name: 'My Biology' })
    await banks.commit(targetId, { kind: 'update-provenance', provenance: { author: 'Me' } })

    const second = await banks.commitImport(proposal, initialSelection(proposal, { targetBankId: targetId }))

    expect(second).toMatchObject({ createdBankIds: [], updatedBankIds: [targetId] })
    const after = (await banks.read(targetId))!
    expect(after).toMatchObject({ name: 'My Biology', author: 'Me' })
    // The same five Questions again, as five new ones: nothing deduplicated.
    expect(after.questions).toHaveLength(10)
    expect(after.questions.slice(0, 5).map(({ id }) => id)).toEqual(before.questions.map(({ id }) => id))
    expect(new Set(after.questions.map(({ id }) => id)).size).toBe(10)
    expect(after.lastUpdatedAt >= before.lastUpdatedAt).toBe(true)
  })

  test('an Exam references the new Questions with columns, answer order and Work Space applied', async () => {
    const { banks, exams } = services()
    const proposal = await inspect('bank-and-exam.json')
    const result = await banks.commitImport(proposal, initialSelection(proposal))

    expect(result.createdExamIds).toHaveLength(1)
    const examId = result.createdExamIds[0]!
    const bank = (await banks.read(result.createdBankIds[0]!))!
    const [q1, q2, q3, q4, q5] = bank.questions
    const { working, saved } = await examState(exams, examId)

    expect(working!.dirty).toBe(false)
    expect(saved!.workingCopy).toEqual(working!.workingCopy)
    const copy = working!.workingCopy
    expect(copy.title).toBe('Cells Unit Test')
    expect(copy.questionIds).toEqual([q2!.id, q1!.id, q3!.id, q4!.id, q5!.id])
    expect(copy.columns).toEqual({ [q2!.id]: 4, [q1!.id]: 2 })
    expect(answerTexts(q2!, copy.choiceOrder![q2!.id])).toEqual(['Cell membrane', 'Cell wall', 'Chloroplast', 'Cytoplasm'])
    expect(answerTexts(q4!, copy.choiceOrder![q4!.id])).toEqual(['Stores water', 'Holds DNA', 'Builds proteins'])
    expect(copy.choiceOrder![q1!.id]).toBeUndefined()
    expect(copy.workSpace).toEqual({ [q5!.id]: { height: 128, style: 'lines', fill: false } })
    expect(working!.questionBank.questions.map(({ id }) => id).sort()).toEqual(copy.questionIds.slice().sort())

    const [recent] = await exams.recent()
    expect(recent).toMatchObject({ id: examId, title: 'Cells Unit Test', questionCount: 5, unsaved: false })
    // The Exam opens with its bank as its one tab.
    expect(await banks.workspace({ examId })).toMatchObject({ openBankIds: [bank.id], activeBankId: bank.id })
  })

  test('an Exam imported beside a merged bank uses the Questions just appended', async () => {
    const { banks, exams } = services()
    const bankOnly = await inspect('bank-only.json')
    const targetId = (await banks.commitImport(bankOnly, initialSelection(bankOnly))).createdBankIds[0]!
    const proposal = await inspect('bank-and-exam.json')

    const result = await banks.commitImport(proposal, initialSelection(proposal, { targetBankId: targetId }))

    const appended = (await banks.read(targetId))!.questions.slice(5).map(({ id }) => id)
    const { working } = await examState(exams, result.createdExamIds[0]!)
    expect([...working!.workingCopy.questionIds].sort()).toEqual([...appended].sort())
  })

  test('positions without answer columns follow the rule for adding a Question', async () => {
    const { banks, exams } = services()
    // Version A: one Multiple Choice with no columns, so it takes one.
    const proposal = await inspect('two-versions.json')
    const result = await banks.commitImport(proposal, initialSelection(proposal))
    for (const examId of result.createdExamIds) {
      const { working } = await examState(exams, examId)
      const [first] = working!.workingCopy.questionIds
      expect(working!.workingCopy.columns).toEqual({ [first!]: 1 })
    }

    // A later Multiple Choice without columns takes the one before it.
    const chained: ImportProposal = {
      ...proposal,
      exams: [{
        ...proposal.exams[0]!,
        positions: [
          { question: { bank: 'cells', question: 'q1' }, columns: 4 },
          { question: { bank: 'cells', question: 'q2' } },
        ],
      }],
    }
    const chainedResult = await banks.commitImport(chained, initialSelection(chained))
    const { working } = await examState(exams, chainedResult.createdExamIds[0]!)
    expect(Object.values(working!.workingCopy.columns!)).toEqual([4, 4])
  })

  test('denied banks and Exams are not imported', async () => {
    const { banks, exams } = services()
    const proposal = await inspect('several-banks.json')
    let selection = initialSelection(proposal)
    selection = setBankAllowed(proposal, selection, 'forces', false)

    const result = await banks.commitImport(proposal, selection)

    expect(result.createdExamIds).toEqual([])
    expect((await banks.recent()).map(({ name }) => name)).toEqual(['Cells'])
    expect(await exams.recent()).toEqual([])

    const onlyBanks = setExamAllowed(proposal, initialSelection(proposal), 'exam-1', false)
    const second = await banks.commitImport(proposal, onlyBanks)
    expect(second.createdBankIds).toHaveLength(2)
    expect(second.createdExamIds).toEqual([])
  })

  test('an Exam drawing on two banks opens with both as tabs', async () => {
    const { banks } = services()
    const proposal = await inspect('several-banks.json')
    const result = await banks.commitImport(proposal, initialSelection(proposal))
    const [cellsId, forcesId] = result.createdBankIds
    const workspace = await banks.workspace({ examId: result.createdExamIds[0]! })
    // In the order the Exam first uses them: Forces, then Cells.
    expect(workspace).toMatchObject({ openBankIds: [forcesId, cellsId], activeBankId: forcesId })
  })

  test('a failure partway through changes nothing', async () => {
    const { banks, exams } = services()
    const proposal = await inspect('several-banks.json')
    // Cells goes to a new bank and is written first; Forces names a bank that
    // does not exist, which fails inside the same commit.
    const selection = setBankTarget(initialSelection(proposal), 'forces', { kind: 'existing', bankId: 'gone' })

    await expect(banks.commitImport(proposal, selection)).rejects.toThrow('no longer on this device')

    expect(await banks.recent()).toEqual([])
    expect(await exams.recent()).toEqual([])
    const databases = (await indexedDB.databases()).map(({ name }) => name)
    expect(databases.some((name) => name?.includes('-exam-'))).toBe(false)
  })
})
