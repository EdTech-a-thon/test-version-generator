// Rewording a test page's header line, in a real browser.
//
// The line reads as it prints until it is clicked, when it becomes the field;
// the ID beside it is never part of it; and the margin offers the default back.

import { expect, test, type Page } from '@playwright/test'
import { seedAuthoringState } from './seed-authoring'

const QUESTION = {
  id: 'q1',
  type: 'open',
  doc: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Explain osmosis.' }] }],
  },
}

async function openExam(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'persist', { configurable: true, value: async () => true })
  })
  await seedAuthoringState(page, {
    questionBank: { questions: [QUESTION] },
    workingCopy: { title: 'Header', questionIds: ['q1'] },
    dirty: false,
  })
  await expect(page.locator('.exam-question[data-question-id]')).toHaveCount(1)
}

const firstHeader = (page: Page) =>
  page.locator('.exam-workspace .exam-page').first().locator('.page-identity')
const field = (page: Page) => page.getByRole('textbox', { name: 'Header printed on the exam' })

test('the header line is reworded where it prints, and the ID stays beside it', async ({ page }) => {
  await openExam(page)
  const header = firstHeader(page)
  await expect(header).toContainText('Name:')
  await expect(header).toContainText('Class:')

  await header.getByRole('button', { name: 'Edit the header' }).click()
  await expect(field(page)).toBeFocused()
  await expect(field(page)).toHaveValue(/^Name: _+ {2}Class: _+ {2}Date: _+$/)
  await field(page).fill('Student: ________  Period: ____')
  await field(page).press('Enter')
  await expect(field(page)).toHaveCount(0)

  await expect(header).toContainText('Student: ________  Period: ____')
  await expect(header).not.toContainText('Class:')
  await expect(header.locator('.page-id')).toHaveText(/^ID: /)

  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Export' }).getByLabel('Export Preview')
  const printed = preview.locator('.exam-page').first().locator('.page-identity')
  await expect(printed).toContainText('Student: ________  Period: ____')
  await expect(printed).toContainText('ID: ')
})

test('clicking the header line turns it into a field without moving it', async ({ page }) => {
  await openExam(page)
  const header = firstHeader(page)
  const display = header.getByRole('button', { name: 'Edit the header' })
  const before = (await display.boundingBox())!
  const id = (await header.locator('.page-id').boundingBox())!
  await display.click()
  const after = (await field(page).boundingBox())!
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(2)
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2)
  // It fits beside the ID, which stays where it was.
  expect(after.x + after.width).toBeLessThan(id.x)
  expect((await header.locator('.page-id').boundingBox())!.x).toBeCloseTo(id.x, 0)
})

test('the margin restores the default header', async ({ page }) => {
  await openExam(page)
  const header = firstHeader(page)
  await header.getByRole('button', { name: 'Edit the header' }).click()
  await field(page).fill('')
  await field(page).press('Escape')
  await expect(header).not.toContainText('Name:')
  await expect(header.locator('.page-id')).toBeVisible()

  await header.hover()
  await page.getByRole('button', { name: 'Restore the default header' }).click()
  await expect(header).toContainText('Name:')
  await expect(header).toContainText('Date:')
})
