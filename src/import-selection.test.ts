import { describe, expect, test } from 'bun:test'
import type { ImportProposal, ProposedBank, ProposedExam } from './package-import'
import {
  deniedBanksOf,
  hasAllowedItems,
  importActionLabel,
  importCounts,
  initialSelection,
  setBankAllowed,
  setBankTarget,
  setExamAllowed,
} from './import-selection'

function bank(id: string, name: string, exams: string[]): ProposedBank {
  return {
    id,
    exams,
    record: { bank: { name, questions: [] } },
    summary: { bankName: name },
  } as unknown as ProposedBank
}

function exam(key: string, banks: string[]): ProposedExam {
  return { key, name: key, formatVersion: '0.1.0', positions: [], banks }
}

// Two banks feeding three Exams: Exam 1 uses both, Exam 2 only chem, Exam 3
// only phys. A third bank feeds nothing.
const proposal: ImportProposal = {
  source: { format: 'test-parrot/package', formatVersion: '0.1.0' },
  banks: [
    bank('chem', 'Chemistry', ['exam-1', 'exam-2']),
    bank('phys', 'Physics', ['exam-1', 'exam-3']),
    bank('spare', 'Spare', []),
  ],
  exams: [exam('exam-1', ['chem', 'phys']), exam('exam-2', ['chem']), exam('exam-3', ['phys'])],
}

describe('the initial selection', () => {
  test('allows everything and sends every bank to a new bank named from its record', () => {
    expect(initialSelection(proposal)).toEqual({
      banks: {
        chem: { allowed: true, target: { kind: 'new', name: 'Chemistry' } },
        phys: { allowed: true, target: { kind: 'new', name: 'Physics' } },
        spare: { allowed: true, target: { kind: 'new', name: 'Spare' } },
      },
      exams: { 'exam-1': { allowed: true }, 'exam-2': { allowed: true }, 'exam-3': { allowed: true } },
    })
  })

  test('sends every bank to the drop target when there is one', () => {
    const selection = initialSelection(proposal, { targetBankId: 'local-bank' })
    for (const id of ['chem', 'phys', 'spare']) {
      expect(selection.banks[id]).toEqual({ allowed: true, target: { kind: 'existing', bankId: 'local-bank' } })
    }
  })
})

describe('the dependency rules', () => {
  test('denying a bank denies every Exam that uses it, and says why', () => {
    const selection = setBankAllowed(proposal, initialSelection(proposal), 'chem', false)

    expect(selection.banks.chem!.allowed).toBe(false)
    expect(selection.banks.phys!.allowed).toBe(true)
    expect(selection.exams).toEqual({
      'exam-1': { allowed: false },
      'exam-2': { allowed: false },
      'exam-3': { allowed: true },
    })
    expect(deniedBanksOf(proposal, selection, 'exam-1')).toEqual(['chem'])
    expect(deniedBanksOf(proposal, selection, 'exam-3')).toEqual([])
  })

  test('allowing an Exam allows every bank it uses', () => {
    let selection = initialSelection(proposal)
    selection = setBankAllowed(proposal, selection, 'chem', false)
    selection = setBankAllowed(proposal, selection, 'phys', false)
    selection = setExamAllowed(proposal, selection, 'exam-1', true)

    expect(selection.banks.chem!.allowed).toBe(true)
    expect(selection.banks.phys!.allowed).toBe(true)
    expect(selection.exams['exam-1']!.allowed).toBe(true)
    // Re-allowing a bank does not bring back the other Exams it had denied.
    expect(selection.exams['exam-2']!.allowed).toBe(false)
    expect(selection.exams['exam-3']!.allowed).toBe(false)
  })

  test('denying an Exam leaves its banks alone', () => {
    const selection = setExamAllowed(proposal, initialSelection(proposal), 'exam-1', false)
    expect(selection.banks.chem!.allowed).toBe(true)
    expect(selection.banks.phys!.allowed).toBe(true)
  })

  test('nothing allowed means nothing to import', () => {
    let selection = initialSelection(proposal)
    expect(hasAllowedItems(selection)).toBe(true)
    for (const id of ['chem', 'phys', 'spare']) selection = setBankAllowed(proposal, selection, id, false)
    expect(hasAllowedItems(selection)).toBe(false)
  })
})

describe("a bank's target", () => {
  test('changes between a new bank and an existing one', () => {
    let selection = initialSelection(proposal)
    selection = setBankTarget(selection, 'chem', { kind: 'existing', bankId: 'local-bank' })
    expect(selection.banks.chem!.target).toEqual({ kind: 'existing', bankId: 'local-bank' })
    selection = setBankTarget(selection, 'chem', { kind: 'new', name: 'Renamed' })
    expect(selection.banks.chem!.target).toEqual({ kind: 'new', name: 'Renamed' })
    expect(selection.banks.phys!.target).toEqual({ kind: 'new', name: 'Physics' })
  })
})

describe('the import counts', () => {
  const only = (banks: number, exams: number): ImportProposal => ({
    ...proposal,
    banks: proposal.banks.slice(0, banks).map((item) => ({ ...item, exams: [] })),
    exams: proposal.exams.slice(0, exams).map((item) => ({ ...item, banks: [] })),
  })

  test('name what the confirm button imports, calling an Exam a Test', () => {
    const label = (item: ImportProposal) => importActionLabel(item, initialSelection(item))
    expect(label(only(1, 0))).toBe('Import Question Bank')
    expect(label(only(1, 1))).toBe('Import Question Bank and Test')
    expect(label(only(3, 2))).toBe('Import 3 Question Banks and 2 Tests')
    expect(label(only(2, 0))).toBe('Import 2 Question Banks')
    expect(label(only(1, 3))).toBe('Import 1 Question Bank and 3 Tests')
    expect(label(only(2, 1))).toBe('Import 2 Question Banks and 1 Test')
  })

  test('follow the selection, and the file when nothing is allowed', () => {
    let selection = setExamAllowed(proposal, initialSelection(proposal), 'exam-2', false)
    selection = setBankAllowed(proposal, selection, 'spare', false)
    expect(importCounts(proposal, selection)).toEqual({ banks: 2, exams: 2 })
    expect(importActionLabel(proposal, selection)).toBe('Import 2 Question Banks and 2 Tests')
    for (const id of ['chem', 'phys']) selection = setBankAllowed(proposal, selection, id, false)
    expect(importCounts(proposal, selection)).toEqual({ banks: 3, exams: 3 })
  })
})
