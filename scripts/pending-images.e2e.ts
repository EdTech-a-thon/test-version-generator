import { expect, test } from '@playwright/test'
import { assistantPackage, picture, sourceDocument } from './pending-images-fixtures'

/**
 * Importing a converted test's pictures from the teacher's own PDF: drop the
 * PDF, hand the labeled copy and instructions to an assistant, drop back what
 * it wrote, and check its pictures in the Test itself — the tagged ones
 * already there — changing any from the picture.
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
  await expect(dialog.getByRole('heading', { name: 'Converting unit-test.pdf' })).toBeVisible()
  await expect(dialog.getByRole('status')).toHaveText('2 pictures detected in your PDF')

  await dialog.getByRole('button', { name: 'Copy the instructions' }).click()
  await expect(dialog.getByRole('button', { name: 'Copied' })).toBeVisible()
  const instructions = await page.evaluate(() => navigator.clipboard.readText())
  expect(instructions).toContain('- page 1: IMG 1\n- page 2: IMG 2')
  expect(instructions).not.toContain('{{IMAGE_TAGS}}')

  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download the AI-ready PDF' }).click()
  expect((await download).suggestedFilename()).toBe('unit-test (AI-ready).pdf')

  // The import waits while the teacher is in their AI chat, reload and all.
  await page.reload()
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(dialog.getByRole('status')).toHaveText('2 pictures detected in your PDF')

  await dialog.getByLabel('File from your AI').setInputFiles({
    name: 'trading-stations.parrot.json',
    mimeType: 'application/json',
    buffer: assistantPackage(),
  })
  await expect(dialog.getByRole('alert')).toHaveCount(0)

  // The tagged pictures are already in the Test, in place; the rest say so.
  const preview = dialog.getByLabel('Test preview')
  const hint = preview.getByRole('status').filter({ hasText: /picture/ })
  await expect(hint).toHaveText('3 of 5 pictures detected from unit-test.pdf. Click a picture to change it.', { timeout: 30000 })
  const pictureIn = (question: string) => preview.getByRole('button', { name: new RegExp(`^${question}: `) })
  await expect(pictureIn('Question 1')).toHaveAccessibleName('Question 1: IMG 1 from unit-test.pdf. Change picture')
  await expect(pictureIn('Question 1')).toContainText('Detected image · IMG 1')
  await expect(pictureIn('Question 1').locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/)
  await expect(pictureIn('Question 3')).toContainText('Detected image · IMG 2')
  await expect(pictureIn('Question 4')).toHaveAccessibleName('Question 4: picture needed. Change picture')
  await expect(pictureIn('Question 4').getByRole('img', { name: 'Picture needed: page 2' })).toBeVisible()

  // Clicking a picture opens its choices in the rail. Question 2 shares IMG 1
  // with Question 1; it can take another picture on its own.
  await pictureIn('Question 2').click()
  const rail = dialog.getByRole('complementary', { name: 'Picture for Question 2' })
  await expect(rail).toContainText('IMG 1 from unit-test.pdf')
  await rail.getByLabel('Change the other place that uses IMG 1 too').uncheck()
  await expect(rail.getByRole('button', { name: 'Use IMG 1' })).toHaveAttribute('aria-pressed', 'true')
  await rail.getByRole('button', { name: 'Use IMG 2' }).click()
  await expect(pictureIn('Question 2')).toContainText('Detected image · IMG 2')
  await expect(pictureIn('Question 1')).toContainText('Detected image · IMG 1')
  // Putting it back leaves the Test as the AI wrote it.
  await rail.getByRole('button', { name: 'Use IMG 1' }).click()
  await expect(pictureIn('Question 2')).toContainText('Detected image · IMG 1')

  // The line-drawn circuit has no tag: crop it from the page it is on, which
  // opens where the Test was, large enough to crop.
  await pictureIn('Question 4').click()
  const circuit = dialog.getByRole('complementary', { name: 'Picture for Question 4' })
  await circuit.getByRole('button', { name: 'Crop from a page' }).click()
  const cropper = dialog.getByRole('group', { name: 'Crop a picture from a page' })
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
  await expect(cropper).toBeHidden()
  await expect(pictureIn('Question 4')).toContainText('Cropped from page 2')
  await expect(hint).toHaveText('4 of 5 pictures detected from unit-test.pdf. Click a picture to change it.')
  await circuit.getByRole('button', { name: 'Done' }).click()
  await expect(circuit).toBeHidden()

  await dialog.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page).toHaveURL(/\/editor\?exam=/)

  // Four pictures arrived; the cell diagram is still needed.
  const sheet = page.locator('.exam-question')
  await expect(sheet).toHaveCount(5)
  // The circuit took half its page's width, so it takes about that much of
  // the sheet, not all of it.
  const circuitQuestion = sheet.filter({ hasText: 'Describe the circuit drawn below' })
  await expect(circuitQuestion.locator('img')).toBeVisible()
  const lane = (await circuitQuestion.boundingBox())!.width
  const drawn = (await circuitQuestion.locator('img').boundingBox())!.width
  expect(drawn / lane).toBeGreaterThan(0.5)
  expect(drawn / lane).toBeLessThan(0.8)
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
