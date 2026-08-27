import { expect, test } from '@playwright/test'

test('the rendered exam preserves authored spaces and blank lines', async ({ page }) => {
  const draft = {
    exam: {
      title: 'Whitespace repro',
      questions: [
        {
          id: 'q1',
          type: 'open',
          columns: 'auto',
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Show  your  work' }],
              },
              { type: 'paragraph' },
              { type: 'paragraph' },
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Answer' }],
              },
            ],
          },
        },
      ],
    },
    versions: [
      {
        id: 'v1',
        letter: 'A',
        questionOrder: ['q1'],
        choiceOrder: {},
      },
    ],
    currentVersionId: 'v1',
    dirty: false,
  }
  await page.addInitScript((initialDraft) => {
    localStorage.setItem('exam-draft-v1', JSON.stringify(initialDraft))
  }, draft)

  await page.goto('/')

  const stem = page.locator('.question-stem')
  await expect(stem.locator('p')).toHaveCount(4)
  await expect(stem.locator('p').first()).toHaveText('Show  your  work')
  await expect
    .poll(() => stem.evaluate((element) => getComputedStyle(element).whiteSpace))
    .toBe('pre-wrap')

  const blankLineHeights = await stem.locator('p').evaluateAll((paragraphs) =>
    paragraphs.slice(1, 3).map((paragraph) => paragraph.getBoundingClientRect().height),
  )
  expect(blankLineHeights.every((height) => height > 0)).toBe(true)
})
