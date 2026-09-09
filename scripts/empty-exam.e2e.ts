import { expect, test } from '@playwright/test'

test('Home creates a blank Exam before it offers Insert question on the page', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Recent Exams', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Recent Exams' })).toContainText('No recent Exams')
  await page.getByRole('button', { name: 'New Exam' }).first().click()
  await expect(page).toHaveURL(/\/editor$/)

  const onPage = page.getByRole('button', { name: 'Insert your first question' })
  await expect(onPage).toBeVisible()
  await onPage.click()
  await page.getByRole('menuitem', { name: 'Multiple choice' }).click()
  await expect(page.getByRole('dialog', { name: 'Question editor' })).toBeVisible()
  await page.keyboard.type('Which is a mammal?')
  await page.keyboard.press('Control+Enter')
  await expect(page.locator('.exam-question')).toHaveCount(1)
  await expect(onPage).toHaveCount(0)
  await page.getByRole('button', { name: 'Actions for question 1' }).click()
  await expect(page.getByRole('menuitem', { name: 'Add question below' })).toBeVisible()
})
