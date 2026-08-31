import { expect, test, type Page } from '@playwright/test'

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
  const draft = {
    exam: { title: 'Selection repro', questions: [question('q1'), question('q2')] },
    versions: [{
      id: 'v1',
      letter: 'A',
      questionOrder: ['q1', 'q2'],
      choiceOrder: {},
    }],
    currentVersionId: 'v1',
    dirty: false,
  }
  await page.addInitScript((initialDraft) => {
    Math.random = () => 0
    localStorage.setItem('exam-draft-v1', JSON.stringify(initialDraft))
  }, draft)

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

test('answer shuffling applies to every selected multiple-choice question', async ({ page }) => {
  const questions = await openSelectedQuestions(page)
  const before = await questions.allTextContents()

  await questions.nth(1).click({ button: 'right' })
  await expect(page.locator('[data-column-layout]')).toHaveCount(3)
  await expect(page.locator('[data-column-layout="1"]')).toBeVisible()
  await expect(page.locator('[data-column-layout="2"]')).toBeVisible()
  await expect(page.locator('[data-column-layout="4"]')).toBeVisible()
  const selectedFormat = page.getByRole('menuitemradio', { name: '1 column' })
  await expect(selectedFormat).toHaveAttribute('aria-checked', 'true')
  await expect(selectedFormat.locator('.context-menu-dot')).toBeVisible()
  await page.getByRole('menuitem', { name: 'Shuffle answer order' }).click()

  await expect.poll(() => questions.allTextContents()).not.toEqual(before)
  const after = await questions.allTextContents()
  expect(after[0]).not.toBe(before[0])
  expect(after[1]).not.toBe(before[1])
})
