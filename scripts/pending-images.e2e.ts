import { expect, test } from '@playwright/test'
import { assistantPackage, picture, sourceDocument } from './pending-images-fixtures'

/**
 * Importing a converted test's pictures from the teacher's own PDF: drop the
 * PDF, hand the labeled copy and instructions to an assistant, drop back what
 * it wrote, and resolve every Pending Image — the tagged ones already filled.
 */

test('a converted test gets its pictures from the teacher’s own PDF', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/question-banks')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Import' })

  await dialog.getByLabel('Your test PDF or a Test Parrot file').setInputFiles({
    name: 'unit-test.pdf',
    mimeType: 'application/pdf',
    buffer: await sourceDocument(),
  })
  await expect(dialog.getByRole('status')).toHaveText('Pictures detected in your PDF')
  await expect(dialog).toContainText('Test Parrot found 2 pictures in unit-test.pdf.')

  await dialog.getByRole('button', { name: 'Copy instructions' }).click()
  await expect(dialog.getByRole('button', { name: 'Copied' })).toBeVisible()
  const instructions = await page.evaluate(() => navigator.clipboard.readText())
  expect(instructions).toContain('- page 1: IMG 1\n- page 2: IMG 2')
  expect(instructions).not.toContain('{{IMAGE_TAGS}}')

  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download labeled PDF' }).click()
  expect((await download).suggestedFilename()).toBe('unit-test (labeled).pdf')

  // The import waits while the teacher is in their AI chat, reload and all.
  await page.reload()
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(dialog.getByRole('status')).toHaveText('Pictures detected in your PDF')

  await dialog.getByLabel('File from your AI').setInputFiles({
    name: 'trading-stations.parrot.json',
    mimeType: 'application/json',
    buffer: assistantPackage(),
  })
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Resolve Images' }).click()

  const resolve = dialog.getByRole('region', { name: 'Resolve Images' })
  const row = (name: string) => resolve.getByRole('listitem', { name, exact: true })
  await expect(row('Question 1')).toContainText('IMG 1 from unit-test.pdf')
  await expect(row('Question 2')).toContainText('IMG 1 from unit-test.pdf')
  await expect(row('Question 3')).toContainText('IMG 2 from unit-test.pdf')
  await expect(row('Question 1').getByRole('img', { name: 'Map of trading stations' })).toBeVisible()
  await expect(row('Question 4')).toContainText('Picture needed (page 2)')
  await expect(resolve.getByRole('status')).toContainText('3 of 5 pictures ready.')

  // The line-drawn circuit has no tag: crop it from the page it is on.
  await row('Question 4').getByRole('button', { name: 'Crop from a page' }).click()
  const cropper = row('Question 4').getByRole('group', { name: 'Crop a picture from a page' })
  await expect(cropper).toContainText('Page 2 of 2')
  const pageImage = cropper.getByRole('img', { name: 'Page 2' })
  await expect(pageImage.locator('img')).toBeVisible()
  await pageImage.scrollIntoViewIfNeeded()
  const box = (await pageImage.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.08, box.y + box.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.76, { steps: 5 })
  await page.mouse.up()
  await cropper.getByRole('button', { name: 'Use this crop' }).click()
  await expect(row('Question 4')).toContainText('Cropped from page 2')
  await expect(resolve.getByRole('status')).toContainText('4 of 5 pictures ready.')

  await dialog.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page).toHaveURL(/\/editor\?exam=/)

  // Four pictures arrived; the cell diagram is still needed.
  const sheet = page.locator('.exam-question')
  await expect(sheet).toHaveCount(5)
  const needed = page.locator('.exam-question').filter({ hasText: 'Label the parts of the cell' })
  await expect(needed.getByRole('img', { name: 'Picture needed: page 2' })).toBeVisible()
  await expect(page.getByRole('img', { name: /^Picture needed/ })).toHaveCount(1)

  // The Exam cannot be exported with a hole in it, and says which Question.
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const exporting = page.getByRole('dialog', { name: 'Export' })
  await expect(exporting.getByRole('alert')).toHaveText('Question 5 still needs a picture. Resolve it before exporting.')
  await expect(exporting.getByRole('button', { name: /^Download / })).toBeDisabled()
  await exporting.getByRole('button', { name: 'Cancel' }).click()

  // In the question editor it is a “picture needed” block, and saving keeps it.
  await needed.dblclick()
  const editor = page.getByRole('dialog', { name: 'Question editor' })
  await expect(editor.getByRole('group', { name: 'Picture needed: page 2' })).toBeVisible()
  await editor.locator('.milkdown').getByText('Label the parts of the cell').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' carefully')
  await editor.getByRole('button', { name: 'Save question' }).click()
  await expect(editor).toBeHidden()
  await page.reload()
  await expect(needed).toContainText('carefully')
  await expect(needed.getByRole('img', { name: 'Picture needed: page 2' })).toBeVisible()

  // Resolved later from that block with an uploaded file, the Exam exports.
  await needed.dblclick()
  await editor.getByRole('group', { name: 'Picture needed: page 2' }).getByRole('button', { name: 'Resolve' }).click()
  const later = page.getByRole('dialog', { name: 'Resolve Images' })
  await later.getByLabel('Upload a picture for This picture').setInputFiles({
    name: 'cell.png',
    mimeType: 'image/png',
    buffer: Buffer.from(picture(90, 60, 5)),
  })
  await expect(later.getByRole('listitem', { name: 'This picture' })).toContainText('Uploaded cell.png')
  await later.getByRole('button', { name: 'Use these pictures' }).click()
  await expect(later).toBeHidden()
  await expect(editor.getByRole('group', { name: 'Picture needed: page 2' })).toHaveCount(0)
  await editor.getByRole('button', { name: 'Save question' }).click()
  await expect(editor).toBeHidden()
  await expect(page.getByRole('img', { name: /^Picture needed/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(exporting.getByRole('button', { name: /^Download / })).toBeEnabled()
})
