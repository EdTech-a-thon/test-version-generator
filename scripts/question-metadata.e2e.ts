// Classifying a question in the popup.
//
// Difficulty and Topics are edited beside the rich-text authoring the popup has
// always offered, so what is checked here is the part only a browser can show:
// that the controls are there, that a Topic chip commits the way a teacher
// expects, and that a save carries all of it into the Question Bank.

import { expect, test, type Page } from '@playwright/test'

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Question editor' })
const bank = (page: Page) => page.getByRole('region', { name: 'Question Bank' })
const bankRows = (page: Page) => bank(page).getByRole('listitem')
const topicInput = (page: Page) => page.getByRole('textbox', { name: 'Add a Topic' })
const chips = (page: Page) => dialog(page).getByRole('listitem')

test('a question is classified and saved with its Difficulty and Topics', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: 'New question' }).click()
  await expect(dialog(page)).toBeVisible()
  await page.keyboard.type('Which gas do plants take in?')
  await dialog(page).getByLabel('Difficulty').selectOption('Hard')
  await topicInput(page).fill('Photosynthesis')
  await topicInput(page).press('Enter')
  await page.getByRole('button', { name: 'Save question' }).click()

  await expect(dialog(page)).toBeHidden()
  const row = bankRows(page).first()
  await expect(row).toContainText('Which gas do plants take in?')
  await expect(row).toContainText('Hard')
  await expect(row).toContainText('Photosynthesis')

  // Reopening shows what was saved rather than starting over.
  await page.getByRole('button', { name: /^Edit / }).click()
  await expect(dialog(page).getByLabel('Difficulty')).toHaveValue('hard')
  await expect(chips(page)).toHaveText(['Photosynthesis'])
})

test('Enter and comma each commit a trimmed Topic chip', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: 'New question' }).click()
  await topicInput(page).fill('  Cell division  ')
  await topicInput(page).press('Enter')
  await topicInput(page).pressSequentially('Mitosis,')
  await topicInput(page).fill('   ')
  await topicInput(page).press('Enter')

  await expect(chips(page)).toHaveText(['Cell division', 'Mitosis'])
  await expect(topicInput(page)).toHaveValue('')

  await dialog(page).getByRole('button', { name: 'Clear Topic Cell division' }).click()
  await expect(chips(page)).toHaveText(['Mitosis'])

  // Casing and spelling are the teacher's: two spellings are two Topics.
  await topicInput(page).fill('mitosis')
  await topicInput(page).press('Enter')
  await expect(chips(page)).toHaveText(['Mitosis', 'mitosis'])
})

test('an unclassified question still saves, stem and all', async ({ page }) => {
  await page.goto('/')

  // Nothing typed anywhere: the permissive save behaviour is unchanged by
  // Difficulty and Topics being available.
  await page.getByRole('button', { name: 'New question' }).click()
  await page.getByRole('button', { name: 'Save question' }).click()

  await expect(dialog(page)).toBeHidden()
  await expect(bankRows(page)).toHaveCount(1)
  await expect(bankRows(page).first()).toContainText('Untitled question')
})
