// Classifying a question in the popup.
//
// Difficulty and Topics are the question's front matter, above the rich-text
// authoring the popup has always offered. What is checked here is the part only
// a browser can show: that a blank field is the ordinary state, that choosing
// filters and commits the way a teacher expects, and that a save carries all of
// it into the Question Bank.

import { expect, test, type Page } from '@playwright/test'

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Question editor' })
const bank = (page: Page) => page.getByRole('region', { name: 'Question Bank' })
const bankRows = (page: Page) => bank(page).getByRole('listitem')

/** One front-matter row, closed. */
const field = (page: Page, label: string) =>
  dialog(page).getByRole('button', { name: label, exact: true })

/** The box inside an open front-matter row. */
const search = (page: Page, label: string) =>
  dialog(page).getByRole('textbox', { name: `Filter ${label}` })

/** The bank's New question, and the Question Section it asks for. */
async function newQuestion(page: Page, type = 'Multiple choice') {
  await page.getByRole('button', { name: 'New question' }).click()
  await page.getByRole('menuitem', { name: type }).click()
  await expect(dialog(page)).toBeVisible()
}

test('a question is classified and saved with its Difficulty and Topics', async ({ page }) => {
  await page.goto('/')
  await newQuestion(page)
  await page.keyboard.type('Which gas do plants take in?')

  // Both rows open blank: neither property is required.
  await expect(field(page, 'Difficulty')).toContainText('Empty')
  await expect(field(page, 'Topics')).toContainText('Empty')

  await field(page, 'Difficulty').click()
  await page.getByRole('button', { name: 'Hard', exact: true }).click()
  // Single-select: choosing closes the row, and the value is on it.
  await expect(search(page, 'Difficulty')).toHaveCount(0)
  await expect(field(page, 'Difficulty')).toContainText('Hard')

  await field(page, 'Topics').click()
  await search(page, 'Topics').fill('Photosynthesis')
  await search(page, 'Topics').press('Enter')
  await expect(field(page, 'Topics')).toContainText('Photosynthesis')

  await page.getByRole('button', { name: 'Save question' }).click()
  await expect(dialog(page)).toBeHidden()

  const row = bankRows(page).first()
  await expect(row).toContainText('Which gas do plants take in?')
  await expect(row).toContainText('Hard')
  await expect(row).toContainText('Photosynthesis')

  // Reopening shows what was saved rather than starting over.
  await page.getByRole('button', { name: /^Edit / }).click()
  await expect(field(page, 'Difficulty')).toContainText('Hard')
  await expect(field(page, 'Topics')).toContainText('Photosynthesis')
})

test('typing filters the Topics on offer, and writes one that is not there', async ({ page }) => {
  await page.goto('/')

  // A first question puts two Topics into the bank for a second one to reuse.
  await newQuestion(page)
  await page.keyboard.type('Cells')
  await field(page, 'Topics').click()
  for (const topic of ['Cell division', 'Mitosis']) {
    await search(page, 'Topics').fill(topic)
    await search(page, 'Topics').press('Enter')
  }
  await expect(field(page, 'Topics')).toContainText(['Cell division', 'Mitosis'].join(''))
  await page.getByRole('button', { name: 'Save question' }).click()

  await newQuestion(page)
  await field(page, 'Topics').click()

  // What the bank already knows is offered, and typing narrows it.
  await expect(dialog(page).getByRole('button', { name: 'Cell division' })).toBeVisible()
  await search(page, 'Topics').fill('mito')
  await expect(dialog(page).getByRole('button', { name: 'Cell division' })).toHaveCount(0)
  await dialog(page).getByRole('button', { name: 'Mitosis', exact: true }).click()

  // Multi-select stays open, so choosing several is one visit.
  await expect(search(page, 'Topics')).toBeVisible()

  // Casing and spelling are the teacher's: a near-miss is a new Topic, not a
  // correction of the one already there.
  await search(page, 'Topics').fill('  mitosis  ')
  await search(page, 'Topics').press('Enter')
  await expect(field(page, 'Topics')).toContainText('Mitosismitosis')
})

test('an unclassified question still saves, stem and all', async ({ page }) => {
  await page.goto('/')

  // Nothing chosen anywhere: the permissive save behaviour is unchanged by
  // Difficulty and Topics being available.
  await newQuestion(page)
  await page.getByRole('button', { name: 'Save question' }).click()

  await expect(dialog(page)).toBeHidden()
  await expect(bankRows(page)).toHaveCount(1)
})

test('a question is created as a Short Answer question, and stays one', async ({ page }) => {
  await page.goto('/')
  await newQuestion(page, 'Short answer')

  // The type is stated rather than offered: it was settled at creation.
  await expect(dialog(page)).toContainText('Short answer')
  await expect(dialog(page).getByRole('combobox')).toHaveCount(0)
  await page.keyboard.type('Explain osmosis')
  await page.getByRole('button', { name: 'Save question' }).click()

  await expect(bankRows(page).first()).toContainText('Short answer')
})
