import { expect, test } from '@playwright/test'

test('Ctrl/Cmd+Z undo and Ctrl/Cmd+Shift+Z redo workspace edits', async ({ page }) => {
  await page.goto('/')
  const title = page.getByRole('textbox', { name: 'Exam name' })
  const original = await title.inputValue()

  await title.fill('Control shortcut edit')
  await page.keyboard.press('Control+z')
  await expect(title).toHaveValue(original)
  await page.keyboard.press('Control+Shift+z')
  await expect(title).toHaveValue('Control shortcut edit')

  await title.fill('Command shortcut edit')
  await page.keyboard.press('Meta+z')
  await expect(title).toHaveValue('Control shortcut edit')
})

test('Ctrl/Cmd+Enter saves the question dialog', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: 'Insert question' }).click()
  await expect(page.getByRole('dialog', { name: 'Question editor' })).toBeVisible()
  await page.keyboard.press('Control+Enter')
  await expect(page.getByRole('dialog', { name: 'Question editor' })).toBeHidden()
  await expect(page.locator('.exam-question')).toHaveCount(1)

  await page.getByRole('button', { name: 'Insert question' }).click()
  await page.keyboard.press('Meta+Enter')
  await expect(page.getByRole('dialog', { name: 'Question editor' })).toBeHidden()
  await expect(page.locator('.exam-question')).toHaveCount(2)
})
