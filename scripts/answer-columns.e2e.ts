// How many columns a question's answers lay out in.
//
// The count is the teacher's, always: there is no setting that measures the
// answers and decides for them. What a browser has to show is that the menu
// offers only real counts, and that a question written beside another one opens
// laid out the way that one is — which is what makes the setting something a
// teacher touches once rather than once per question.

import { expect, test, type Page } from '@playwright/test'
import { seedAuthoringState } from './seed-authoring'

const choice = (id: string) => ({
  type: 'multipleChoiceChoice',
  attrs: { correct: false, id },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }],
})

const question = (id: string, columns: number) => ({
  id,
  type: 'multiple-choice',
  columns,
  doc: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: `Question ${id}` }] },
      {
        type: 'multipleChoice',
        content: ['a', 'b', 'c', 'd'].map((answer) => choice(`${id}-${answer}`)),
      },
    ],
  },
})

async function openExam(page: Page, columns: number) {
  await seedAuthoringState(page, {
    questionBank: { questions: [question('q1', columns)] },
    examDraft: { title: 'Answer columns', questionIds: ['q1'] },
    dirty: false,
  })
  await page.goto('/')
  await expect(page.locator('.exam-question')).toHaveCount(1)
}

test('the menu offers counts and nothing that decides for itself', async ({ page }) => {
  await openExam(page, 1)

  await page.locator('.exam-question').first().click({ button: 'right' })
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  const answerColumns = page.getByRole('menuitem', { name: 'Answer columns' })
  await expect(answerColumns).toBeFocused()
  await answerColumns.press('ArrowRight')
  await expect(page.getByRole('menuitemradio', { name: '1 column' })).toBeVisible()
  await expect(page.getByRole('menuitemradio', { name: '2 columns' })).toBeVisible()
  await expect(page.getByRole('menuitemradio', { name: '4 columns' })).toBeVisible()
  await expect(page.getByRole('menuitemradio', { name: 'Auto' })).toHaveCount(0)

  await page.getByRole('menuitem', { name: 'Edit question' }).hover()
  await expect(page.getByRole('menuitemradio', { name: '1 column' })).toHaveCount(0)
})

test('a question written below another opens laid out the way that one is', async ({ page }) => {
  await openExam(page, 1)

  await page.locator('.exam-question').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Add question below' }).click()
  await expect(page.getByRole('dialog', { name: 'Question editor' })).toBeVisible()
  await page.keyboard.type('And another one')
  await page.keyboard.press('Control+Enter')
  await expect(page.getByRole('dialog', { name: 'Question editor' })).toBeHidden()

  // Both, not just the seeded one: the layout was inherited rather than reset
  // to whatever a blank question would otherwise carry.
  await expect(page.locator('.choice-grid')).toHaveCount(2)
  await expect(page.locator('.choice-grid[data-columns="1"]')).toHaveCount(2)
})

test('a question with nothing above it opens in two columns', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: 'New question' }).click()
  await page.getByRole('menuitem', { name: 'Multiple choice' }).click()
  await expect(page.getByRole('dialog', { name: 'Question editor' })).toBeVisible()
  await page.keyboard.type('The first question of all')
  await page.keyboard.press('Control+Enter')
  await page.getByRole('button', { name: /^Add .* to the exam$/ }).click()

  await expect(page.locator('.choice-grid[data-columns="2"]')).toHaveCount(1)
})
