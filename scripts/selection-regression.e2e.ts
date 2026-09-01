import { expect, test, type Page } from '@playwright/test'
import { seedAuthoringState } from './seed-authoring'

const choice = (id: string) => ({
  type: 'multipleChoiceChoice',
  attrs: { correct: false, id },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }],
})

const question = (id: string) => ({
  id,
  type: 'multiple-choice',
  columns: 1,
  doc: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: `Question ${id}` }] },
      { type: 'multipleChoice', content: ['a', 'b', 'c', 'd'].map((choiceId) => choice(`${id}-${choiceId}`)) },
    ],
  },
})

async function openSelectedQuestions(page: Page) {
  await seedAuthoringState(page, {
    questionBank: { questions: [question('q1'), question('q2'), question('q3')] },
    examDraft: { title: 'Selection repro', questionIds: ['q1', 'q2'] },
    dirty: false,
  })

  await page.goto('/')
  const questions = page.locator('.exam-question')
  await expect(questions).toHaveCount(2)
  await questions.nth(0).click()
  await questions.nth(1).click({ modifiers: ['Shift'] })
  await expect(questions.nth(0)).toHaveClass(/exam-question--selected/)
  await expect(questions.nth(1)).toHaveClass(/exam-question--selected/)
  return questions
}

test('Shift-selecting questions does not select their text', async ({ page }) => {
  await openSelectedQuestions(page)

  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')
})

test('Remove takes every selected question off the Exam Draft, not out of the bank', async ({ page }) => {
  const questions = await openSelectedQuestions(page)

  await questions.nth(1).click({ button: 'right' })
  await expect(page.locator('[data-column-layout]')).toHaveCount(3)
  await expect(page.locator('[data-column-layout="1"]')).toBeVisible()
  await expect(page.locator('[data-column-layout="2"]')).toBeVisible()
  await expect(page.locator('[data-column-layout="4"]')).toBeVisible()
  const selectedFormat = page.getByRole('menuitemradio', { name: '1 column' })
  await expect(selectedFormat).toHaveAttribute('aria-checked', 'true')
  await expect(selectedFormat.locator('.context-menu-dot')).toBeVisible()
  // Nothing in this workspace offers permanent deletion.
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Remove' }).click()

  await expect(questions).toHaveCount(0)
  // Every question is still canonical Question Content, ready to be added back.
  const bank = page.getByRole('region', { name: 'Question Bank' })
  await expect(bank.getByRole('listitem')).toHaveCount(3)
  await expect(bank.getByText('In exam')).toHaveCount(0)
})
