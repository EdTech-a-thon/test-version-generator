import { expect, test } from '@playwright/test'

test('Save, local recovery, and Discard keep an Exam Working Copy distinct from its saved Exam', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Exam' }).first().click()
  const name = page.getByRole('textbox', { name: 'Exam name' })
  await name.fill('Saved composition')

  await page.keyboard.press('Control+S')
  const workingCopyStatus = page.getByLabel('Working Copy status')
  await expect(workingCopyStatus).toHaveText('Saved')
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()

  await name.fill('Recovered Working Copy')
  await expect(workingCopyStatus).toHaveText('Unsaved changes · backed up locally')

  await page.reload()
  await expect(name).toHaveValue('Recovered Working Copy')
  await expect(workingCopyStatus).toHaveText('Unsaved changes · backed up locally')

  await page.getByRole('button', { name: 'Discard changes' }).click()
  await expect(name).toHaveValue('Saved composition')
  await expect(workingCopyStatus).toHaveText('Saved')
})
