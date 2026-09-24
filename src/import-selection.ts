import type { ImportProposal } from './package-import'

/**
 * What a teacher has chosen to bring in from one import proposal: which banks
 * and Exams are allowed, and where each allowed bank goes.
 *
 * Pure logic, so the dialog renders it and the commit applies it without
 * either re-deriving the dependency rules. Those rules keep one invariant —
 * an allowed Exam's banks are always allowed — from both directions: denying
 * a bank denies the Exams that use it, and allowing an Exam allows the banks
 * it uses.
 */

export type BankTarget =
  | { kind: 'new'; name: string }
  | { kind: 'existing'; bankId: string }

export type ImportSelection = {
  banks: Record<string, { allowed: boolean; target: BankTarget }>
  exams: Record<string, { allowed: boolean }>
}

/** Everything allowed. Each bank goes to a new bank named from its record,
 *  or — when the file was dropped on a bank — into that bank. */
export function initialSelection(
  proposal: ImportProposal,
  options: { targetBankId?: string } = {},
): ImportSelection {
  return {
    banks: Object.fromEntries(proposal.banks.map((bank) => [
      bank.id,
      {
        allowed: true,
        target: options.targetBankId
          ? { kind: 'existing', bankId: options.targetBankId }
          : { kind: 'new', name: bank.record.bank.name },
      },
    ])),
    exams: Object.fromEntries(proposal.exams.map((exam) => [exam.key, { allowed: true }])),
  }
}

export function setBankAllowed(
  proposal: ImportProposal,
  selection: ImportSelection,
  bankId: string,
  allowed: boolean,
): ImportSelection {
  const current = selection.banks[bankId]
  if (!current) return selection
  const banks = { ...selection.banks, [bankId]: { ...current, allowed } }
  if (allowed) return { ...selection, banks }
  const dependents = new Set(proposal.banks.find(({ id }) => id === bankId)?.exams ?? [])
  const exams = Object.fromEntries(Object.entries(selection.exams).map(([key, exam]) => [
    key,
    dependents.has(key) ? { allowed: false } : exam,
  ]))
  return { banks, exams }
}

export function setExamAllowed(
  proposal: ImportProposal,
  selection: ImportSelection,
  examKey: string,
  allowed: boolean,
): ImportSelection {
  if (!selection.exams[examKey]) return selection
  const exams = { ...selection.exams, [examKey]: { allowed } }
  if (!allowed) return { ...selection, exams }
  const needed = new Set(proposal.exams.find(({ key }) => key === examKey)?.banks ?? [])
  const banks = Object.fromEntries(Object.entries(selection.banks).map(([id, bank]) => [
    id,
    needed.has(id) ? { ...bank, allowed: true } : bank,
  ]))
  return { banks, exams }
}

export function setBankTarget(
  selection: ImportSelection,
  bankId: string,
  target: BankTarget,
): ImportSelection {
  const current = selection.banks[bankId]
  if (!current) return selection
  return { ...selection, banks: { ...selection.banks, [bankId]: { ...current, target } } }
}

/** The denied banks an Exam needs — why a denied Exam is denied, when it is
 *  because of its banks rather than the teacher's own choice. */
export function deniedBanksOf(
  proposal: ImportProposal,
  selection: ImportSelection,
  examKey: string,
): string[] {
  const exam = proposal.exams.find(({ key }) => key === examKey)
  return (exam?.banks ?? []).filter((id) => !selection.banks[id]?.allowed)
}

export function hasAllowedItems(selection: ImportSelection): boolean {
  return Object.values(selection.banks).some(({ allowed }) => allowed)
    || Object.values(selection.exams).some(({ allowed }) => allowed)
}

function counted(count: number, singular: string): string {
  return count === 1 ? singular : `${count} ${singular}s`
}

/** “Import Question Bank”, “Import Question Bank and Exam”, “Import 3
 *  Question Banks and 2 Exams”: what the selection will bring in, or what the
 *  file holds while nothing is allowed. */
export function importTitle(proposal: ImportProposal, selection: ImportSelection): string {
  const allowedBanks = Object.values(selection.banks).filter(({ allowed }) => allowed).length
  const allowedExams = Object.values(selection.exams).filter(({ allowed }) => allowed).length
  const [banks, exams] = hasAllowedItems(selection)
    ? [allowedBanks, allowedExams]
    : [proposal.banks.length, proposal.exams.length]
  const parts = [
    ...(banks > 0 ? [counted(banks, 'Question Bank')] : []),
    ...(exams > 0 ? [counted(exams, 'Exam')] : []),
  ]
  return `Import ${parts.join(' and ')}`
}
