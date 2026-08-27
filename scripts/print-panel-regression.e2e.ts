import { expect, test } from '@playwright/test'

test('Escape closes the print options panel', async ({ page }) => {
  await page.goto('/')

  // Keep Undo focusable so a misplaced focus-restoration ref cannot pass by
  // merely leaving focus on the Print button.
  await page.getByRole('textbox', { name: 'Exam name' }).fill('Edited exam')
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled()

  const exportButton = page.getByRole('button', { name: 'Export', exact: true })
  await exportButton.click()
  await page.getByRole('menuitem', { name: 'Print' }).click()
  await expect(page.getByRole('region', { name: 'Print options' })).toBeVisible()

  await page.keyboard.press('Escape')

  await expect(page.getByRole('region', { name: 'Print options' })).toBeHidden()
  await expect(exportButton).toBeFocused()
})
