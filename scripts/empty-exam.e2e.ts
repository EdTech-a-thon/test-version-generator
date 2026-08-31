import { expect, test } from '@playwright/test'

test('a blank exam offers Insert question on the page itself', async ({ page }) => {
  await page.goto('/')

  const onPage = page.getByRole('button', { name: 'Insert your first question' })
  await expect(onPage).toBeVisible()

  await onPage.click()
  await expect(page.getByRole('dialog', { name: 'Question editor' })).toBeVisible()
  await page.keyboard.type('Which is a mammal?')
  await page.keyboard.press('Control+Enter')

  // One question in, the placeholder has done its job and is gone; the header
  // button remains the way to add more.
  await expect(page.locator('.exam-question')).toHaveCount(1)
  await expect(onPage).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Insert question' }),
  ).toBeVisible()
})
