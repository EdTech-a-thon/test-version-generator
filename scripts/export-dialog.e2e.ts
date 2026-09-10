import { expect, test, type Page } from '@playwright/test'
import type { ExportHistory } from '../src/export-preparation'
import { seedAuthoringState } from './seed-authoring'

const EXAM = {
  title: 'Biology Quiz',
  questions: [
    {
      id: 'm1',
      type: 'multiple-choice' as const,
      columns: 1 as const,
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Which is a mammal?' }] },
          {
            type: 'multipleChoice',
            content: [
              { type: 'multipleChoiceChoice', attrs: { id: 'c1', correct: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Whale' }] }] },
              { type: 'multipleChoiceChoice', attrs: { id: 'c2', correct: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shark' }] }] },
            ],
          },
        ],
      },
    },
    {
      id: 'o1', type: 'open' as const, columns: 2 as const,
      doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Explain why.' }] }] },
    },
  ],
}

const AUTHORING = {
  questionBank: { questions: EXAM.questions },
  workingCopy: { title: EXAM.title, questionIds: ['m1', 'o1'] },
  dirty: false,
}

async function open(page: Page, authoring = AUTHORING) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'persist', { configurable: true, value: async () => true })
  })
  await seedAuthoringState(page, authoring)
  await page.locator('.exam-page').first().waitFor()
}

const dialogOf = (page: Page) => page.getByRole('dialog', { name: 'Export' })
async function openDialog(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(dialogOf(page)).toBeVisible()
  return dialogOf(page)
}

async function historyOf(page: Page): Promise<ExportHistory> {
  return page.evaluate(async () => {
    const { createExamWorkspaceService } = await import(/* @vite-ignore */ '/src/exam-workspaces.ts') as typeof import('../src/exam-workspaces')
    const workspaces = createExamWorkspaceService()
    const examId = await workspaces.activeId()
    if (!examId) throw new Error('No active Exam workspace')
    return workspaces.backendFor(examId).readExportHistory()
  })
}

async function download(page: Page, format: 'PDF' | 'DOCX' = 'PDF') {
  const dialog = await openDialog(page)
  if (format === 'DOCX') await dialog.getByRole('radio', { name: 'DOCX' }).check()
  const pending = page.waitForEvent('download')
  await dialog.getByRole('button', { name: `Download ${format}` }).click()
  return pending
}

test('Export defaults to PDF with both selected documents and a clean preview', async ({ page }) => {
  await open(page)
  const dialog = await openDialog(page)
  await expect(dialog.getByRole('radio', { name: 'PDF' })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: 'Student test' })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: 'Answer key' })).toBeChecked()
  await expect(dialog.getByLabel('Export Preview').locator('.exam-page')).toHaveCount(2)
  await expect(dialog.getByLabel('Export Preview')).toContainText('Which is a mammal?')
  await expect(dialog.getByLabel('Export Preview').locator('.choice-correctness-marker')).toHaveCount(0)
})

test('format and Content Selection control the artifact and record', async ({ page }) => {
  await open(page)
  const dialog = await openDialog(page)
  await dialog.getByRole('radio', { name: 'DOCX' }).check()
  await dialog.getByRole('checkbox', { name: 'Student test' }).uncheck()
  await expect(dialog.getByLabel('Export Preview').locator('.exam-page')).toHaveCount(1)
  const file = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download DOCX' }).click()
  expect((await file).suggestedFilename()).toBe('Biology Quiz.docx')
  await expect.poll(async () => (await historyOf(page)).records.length).toBe(1)
  expect((await historyOf(page)).records[0]).toMatchObject({
    capturedName: 'Biology Quiz', format: 'docx',
    selection: { test: false, answerKey: true }, questionCount: 2,
  })
})

test('identical exports append distinct records without saving the Working Copy', async ({ page }) => {
  await open(page)
  const title = page.getByRole('textbox', { name: 'Exam name' })
  await title.fill('Unsaved Biology Quiz')
  await expect(page.getByLabel('Working Copy status')).toContainText('Unsaved changes')

  expect((await download(page)).suggestedFilename()).toBe('Unsaved Biology Quiz.pdf')
  expect((await download(page)).suggestedFilename()).toBe('Unsaved Biology Quiz.pdf')
  await expect.poll(async () => (await historyOf(page)).records.length).toBe(2)
  const records = (await historyOf(page)).records
  expect(records[0]!.id).not.toBe(records[1]!.id)
  expect(records.every((record) => record.capturedName === 'Unsaved Biology Quiz')).toBe(true)
  await expect(page.getByLabel('Working Copy status')).toContainText('Unsaved changes')
})

test('Export History is newest-first, read-only, and fixed-format re-export appends an event', async ({ page }) => {
  await open(page)
  await download(page, 'PDF')
  await download(page, 'DOCX')

  await page.getByRole('button', { name: 'Export History' }).click()
  const history = page.getByRole('complementary', { name: 'Export History' })
  await expect(history.locator('.export-history-item')).toHaveCount(2)
  await expect(history.locator('.export-history-item').first()).toContainText('DOCX')
  await history.locator('.export-history-item').first().click()

  const historical = page.getByRole('region', { name: 'Biology Quiz Export Record' })
  await expect(historical).toContainText('Viewing immutable Export Record')
  await expect(historical.getByRole('button', { name: 'Re-export DOCX' })).toBeVisible()
  await expect(historical.getByRole('button', { name: /Use as draft/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()

  const file = page.waitForEvent('download')
  await historical.getByRole('button', { name: 'Re-export DOCX' }).click()
  expect((await file).suggestedFilename()).toBe('Biology Quiz.docx')
  await expect(historical).toBeVisible()
  await expect.poll(async () => (await historyOf(page)).records.length).toBe(3)
  await historical.getByRole('button', { name: 'Back to Exam' }).click()
  await expect(page.locator('.exam-page').first()).toBeVisible()
})

test('Escape closes Export History and restores focus', async ({ page }) => {
  await open(page)
  const button = page.getByRole('button', { name: 'Export History' })
  await button.click()
  await expect(page.getByRole('complementary', { name: 'Export History' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('complementary', { name: 'Export History' })).toBeHidden()
  await expect(button).toBeFocused()
})

test('empty Exams cannot export and Cmd/Ctrl+P opens Export for non-empty Exams', async ({ page }) => {
  await open(page, { questionBank: { questions: [] }, workingCopy: { title: 'Empty', questionIds: [] }, dirty: false })
  const dialog = await openDialog(page)
  await expect(dialog.getByText('Add at least one question', { exact: false }).first()).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Download PDF' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  await open(page)
  await page.keyboard.press('ControlOrMeta+P')
  await expect(dialogOf(page)).toBeVisible()
})
