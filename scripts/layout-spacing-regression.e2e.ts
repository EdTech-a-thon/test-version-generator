import { expect, test } from '@playwright/test'

const choice = (id: string) => ({
  type: 'multipleChoiceChoice',
  attrs: { correct: false, id },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }],
})

const multipleChoice = (id: string, blankLines: number) => ({
  id,
  type: 'multiple-choice',
  columns: 1,
  doc: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: `Question ${id}` }] },
      ...Array.from({ length: blankLines }, () => ({ type: 'paragraph' })),
      { type: 'multipleChoice', content: [choice(`${id}-a`), choice(`${id}-b`)] },
    ],
  },
})

test('default and authored exam spacing remain distinct', async ({ page }) => {
  const questions = [
    multipleChoice('compact', 1),
    multipleChoice('spaced', 2),
    ...Array.from({ length: 12 }, (_unused, index) =>
      multipleChoice(`filler-${index}`, 0),
    ),
    {
      id: 'open',
      type: 'open',
      columns: 'auto',
      doc: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Explain.' }] }],
      },
    },
  ]
  const ids = questions.map((question) => question.id)
  const draft = {
    exam: { title: 'Spacing repro', questions },
    versions: [{ id: 'v1', letter: 'A', questionOrder: ids, choiceOrder: {} }],
    currentVersionId: 'v1',
    dirty: false,
  }
  await page.addInitScript((initialDraft) => {
    localStorage.setItem('exam-draft-v1', JSON.stringify(initialDraft))
  }, draft)

  await page.goto('/')

  const renderedQuestions = page.locator('.exam-question')
  await expect(renderedQuestions.nth(0).locator('.question-stem p')).toHaveCount(1)
  await expect(renderedQuestions.nth(1).locator('.question-stem p')).toHaveCount(2)

  const sectionMargin = await page.locator('.exam-section').first().evaluate((section) =>
    Number.parseFloat(getComputedStyle(section).marginTop),
  )
  expect(sectionMargin).toBeGreaterThanOrEqual(16)

  const laterHeader = page.locator('.page-header--later').first()
  await expect(laterHeader).toBeVisible()
  expect(await laterHeader.evaluate((header) => header.getBoundingClientRect().height))
    .toBeGreaterThanOrEqual(42)
})
