// Editing an Exam's page header where it prints, in a real browser.
//
// A double-click opens the header the way a word processor does; what is typed
// there is what the output prints, the paper's ID included; the first page can
// have a header of its own; a removed header takes no room and a double-click
// in the margin brings it back. Opening a header and leaving it as it was does
// not make the Exam unsaved.

import { expect, test, type Page } from '@playwright/test'
import { seedAuthoringState } from './seed-authoring'

const open = (id: string, text: string) => ({
  id,
  type: 'open',
  columns: 2,
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
})

async function openExam(page: Page, questionCount = 1) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'persist', { configurable: true, value: async () => true })
  })
  const questions = Array.from({ length: questionCount }, (_unused, index) =>
    open(`o${index + 1}`, `Question ${index + 1}`))
  await seedAuthoringState(page, {
    questionBank: { questions },
    workingCopy: {
      title: 'Header test',
      questionIds: questions.map(({ id }) => id),
      // Tall work space pushes the second question onto a later page.
      workSpace: Object.fromEntries(questions.map(({ id }) => [id, { height: 640, style: 'blank', fill: false }])),
    },
    dirty: false,
  })
  await expect(page.locator('.exam-question[data-question-id]').first()).toBeVisible()
}

const firstHeader = (page: Page) => page.locator('.exam-page').first().locator('.page-header')
const toolbar = (page: Page) => page.getByRole('toolbar', { name: /header.* tools$/i })
const editorText = (page: Page) => page.locator('.header-editor .ProseMirror')
const save = (page: Page) => page.getByRole('button', { name: 'Save', exact: true })

/** What the Export Preview prints at the top of a test page. */
async function previewHeader(page: Page, index = 0) {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Export' }).getByLabel('Export Preview')
  await expect(preview).toBeVisible()
  return preview.locator('.exam-page').nth(index).locator('.page-header')
}

test('a double-click opens the default header for editing, and leaving it alone changes nothing', async ({ page }) => {
  await openExam(page)
  await expect(firstHeader(page)).toContainText('Class:')
  await save(page).click()
  await expect(save(page)).toBeDisabled()

  await firstHeader(page).dblclick({ position: { x: 10, y: 10 } })
  await expect(toolbar(page)).toBeVisible()
  await expect(toolbar(page)).toContainText('First-page header')
  await expect(editorText(page)).toContainText('Name:')
  await expect(editorText(page)).toContainText('Class:')
  await expect(editorText(page).locator('.header-id-chip')).toHaveCount(1)

  await page.keyboard.press('Escape')
  await expect(toolbar(page)).toHaveCount(0)
  await expect(save(page)).toBeDisabled()
})

test('what is typed in the header is what the paper prints, its ID filled in, and it survives a reload', async ({ page }) => {
  await openExam(page)
  await firstHeader(page).dblclick({ position: { x: 10, y: 10 } })
  await editorText(page).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Springfield High, version ')
  await toolbar(page).getByRole('button', { name: 'Insert ID' }).click()
  await toolbar(page).getByRole('button', { name: 'Done' }).click()

  await expect(save(page)).toBeEnabled()
  await expect(firstHeader(page)).toContainText('Springfield High, version ID: A')
  await expect(firstHeader(page)).not.toContainText('Class:')
  // The title keeps its own line under the header.
  await expect(firstHeader(page).getByRole('textbox', { name: 'Title printed on the exam' })).toHaveValue('Header test')

  const printed = await previewHeader(page)
  await expect(printed).toContainText('Springfield High, version ID: A')
  await page.keyboard.press('Escape')

  await page.reload()
  await expect(firstHeader(page)).toContainText('Springfield High, version ID: A')
})

test('the first page can have a header of its own', async ({ page }) => {
  await openExam(page, 2)
  const laterHeader = page.locator('.exam-page').nth(1).locator('.page-header')

  await laterHeader.dblclick({ position: { x: 10, y: 10 } })
  await expect(toolbar(page)).toContainText('Header on later pages')
  await editorText(page).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Every later page')
  await toolbar(page).getByRole('button', { name: 'Done' }).click()
  await expect(laterHeader).toContainText('Every later page')
  // The first page keeps the default's first-page header of its own.
  await expect(firstHeader(page)).toContainText('Class:')

  // Turned off, every page prints the one header.
  await firstHeader(page).dblclick({ position: { x: 10, y: 10 } })
  await toolbar(page).getByLabel('Different first page').uncheck()
  await toolbar(page).getByRole('button', { name: 'Done' }).click()
  await expect(firstHeader(page)).toContainText('Every later page')
})

test('a removed header takes no room, and a double-click in the margin brings one back', async ({ page }) => {
  await openExam(page)
  const before = (await page.locator('.exam-page').first().locator('.page-content').boundingBox())!.y

  await firstHeader(page).dblclick({ position: { x: 10, y: 10 } })
  await toolbar(page).getByRole('button', { name: 'Remove header' }).click()
  await expect(toolbar(page)).toHaveCount(0)
  await expect(firstHeader(page)).not.toContainText('Name:')
  // Only the title line is left above the questions.
  await expect.poll(async () =>
    (await page.locator('.exam-page').first().locator('.page-content').boundingBox())!.y).toBeLessThan(before)

  const sheet = (await page.locator('.exam-page').first().boundingBox())!
  await page.mouse.dblclick(sheet.x + sheet.width / 2, sheet.y + 20)
  await expect(toolbar(page)).toBeVisible()
})

test('a header table prints without borders until the teacher turns them on', async ({ page }) => {
  await openExam(page)
  await firstHeader(page).dblclick({ position: { x: 10, y: 10 } })
  // The default header's blanks are a table; the caret starts inside it.
  await editorText(page).locator('td, th').first().click()
  const borders = toolbar(page).getByRole('button', { name: 'Show borders' })
  await expect(borders).toHaveAttribute('aria-pressed', 'false')
  await borders.click()
  await expect(borders).toHaveAttribute('aria-pressed', 'true')
  await toolbar(page).getByRole('button', { name: 'Done' }).click()

  await expect(firstHeader(page).locator('table.doc-table')).toHaveCount(1)
  await expect(firstHeader(page).locator('table.doc-table--borderless')).toHaveCount(0)
})
