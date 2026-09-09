import { expect, test, type Page } from '@playwright/test'
import { seedAuthoringState } from './seed-authoring'

const choice = (id: string, text: string, correct = false) => ({
  type: 'multipleChoiceChoice',
  attrs: { id, correct },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

const original = {
  id: 'historical-question',
  type: 'multiple-choice' as const,
  columns: 2 as const,
  doc: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Historical stem' }] },
      { type: 'multipleChoice', content: [choice('a', 'Historical answer A', true), choice('b', 'Historical answer B')] },
    ],
  },
}

const current = {
  ...original,
  columns: 1 as const,
  doc: {
    ...original.doc,
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Current stem',
            marks: [{ type: 'link', attrs: { href: 'https://current.example/stem' } }],
          },
          {
            type: 'image',
            attrs: { src: '/local-images/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', alt: 'Current inline image', ratio: 0.5 },
          },
        ],
      },
      { type: 'multipleChoice', content: [choice('a', 'Current answer A'), choice('b', 'Current answer B', true)] },
    ],
  },
}

async function publish(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('dialog', { name: 'Export' }).getByRole('button', { name: 'Download PDF' }).click()
  await download
}

async function openReview(page: Page) {
  await page.getByRole('button', { name: 'Version History' }).click()
  await page.getByLabel('Version History').locator('.version-history-item').click()
  await page.getByRole('button', { name: 'Use as draft' }).click()
  const replacement = page.getByRole('dialog', { name: 'Replace current draft?' })
  if (await replacement.isVisible()) {
    await replacement.getByRole('button', { name: 'Replace anyway' }).click()
  }
  return page.getByRole('dialog', { name: 'Review questions' })
}

test('Review questions exposes authored old-versus-current content, defaults, cancellation, keyboard access, and Undo', async ({ page }) => {
  await seedAuthoringState(page, {
    questionBank: { questions: [original] },
    examDraft: { title: 'Reconciliation', questionIds: [original.id], choiceOrder: {} },
    dirty: false,
  })
  await publish(page)

  // Change the live Question Content after publication. The review must expose
  // both answer text and correct-answer state, not just matching counts.
  await seedAuthoringState(page, {
    questionBank: { questions: [current] },
    examDraft: { title: 'Changed live draft', questionIds: [current.id], choiceOrder: {} },
    dirty: false,
  })
  await page.reload()
  // The Version History remains in its own stores while authoring is reseeded.
  const review = await openReview(page)
  await expect(review.getByRole('radio', { name: 'Use latest' })).toBeChecked()
  await expect(review.getByText('Changed: content, answers, correctness, media, answer-column layout.')).toBeVisible()
  const comparison = review.getByText('Compare historical and current question')
  await comparison.click()
  await expect(review).toContainText('Historical answer A')
  await expect(review).toContainText('Current answer A')
  await expect(review).toContainText('Answer 1 (correct)')
  await expect(review).toContainText('Answer-column layout: 2 columns')
  await expect(review).toContainText('Answer-column layout: 1 column')
  await expect(review).toContainText('link (href="https://current.example/stem")')
  await expect(review).toContainText('image (alt="Current inline image", ratio=0.5, src="/local-images/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")')
  await page.keyboard.press('Escape')
  await expect(review).toBeHidden()

  const reopened = await openReview(page)
  await expect(reopened.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await reopened.getByRole('button', { name: 'Use as draft' }).focus()
  await page.keyboard.press('Tab')
  await expect(reopened.getByRole('radio', { name: 'Use latest' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(reopened.getByRole('button', { name: 'Use as draft' })).toBeFocused()
  await reopened.getByRole('radio', { name: 'Keep historical as new question' }).check()
  await reopened.getByRole('button', { name: 'Use as draft' }).click()
  await page.getByRole('button', { name: 'Return to Exam Draft' }).click()
  await expect(page.locator('.exam-question')).toContainText('Historical stem')
  await page.keyboard.press('Control+Z')
  await expect(page.locator('.exam-question')).toContainText('Current stem')
})
