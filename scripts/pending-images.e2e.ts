import { expect, test } from '@playwright/test'
import { createCanvas } from '@napi-rs/canvas'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

/**
 * Importing a converted test's pictures from the teacher's own PDF: drop the
 * PDF, hand the labeled copy and instructions to an assistant, drop back what
 * it wrote, and resolve every Pending Image — the tagged ones already filled.
 */

function picture(width: number, height: number, seed: number) {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = `rgb(${(seed * 70) % 256}, ${(seed * 130) % 256}, 180)`
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#222'
  context.fillRect(width / 4, height / 4, width / 2, height / 2)
  return new Uint8Array(canvas.toBuffer('image/png'))
}

/** A two-page test with no Test Parrot attachment: a map on page 1, a graph
 *  and a line-drawn diagram (no embedded image, so no tag) on page 2. */
async function sourceDocument() {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const [map, graph] = await Promise.all([pdf.embedPng(picture(120, 80, 1)), pdf.embedPng(picture(120, 80, 2))])
  const first = pdf.addPage([612, 792])
  first.drawText('1. Use the map to name the trading station farthest east.', { x: 60, y: 730, size: 12, font })
  first.drawImage(map, { x: 60, y: 480, width: 300, height: 200 })
  const second = pdf.addPage([612, 792])
  second.drawText('2. Which European power held the most stations on the map?', { x: 60, y: 730, size: 12, font })
  second.drawText('3. Describe the graph of the function shown below.', { x: 60, y: 700, size: 12, font })
  second.drawImage(graph, { x: 60, y: 460, width: 300, height: 200 })
  second.drawText('4. Describe the circuit drawn below.', { x: 60, y: 420, size: 12, font })
  second.drawRectangle({ x: 60, y: 200, width: 300, height: 180, borderColor: rgb(0, 0, 0), borderWidth: 2 })
  second.drawText('5. Label the parts of the cell drawn below.', { x: 60, y: 160, size: 12, font })
  return Buffer.from(await pdf.save())
}

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const doc = (...content: unknown[]) => ({ type: 'document', content })
const map = { type: 'block-image', pending: { image: 1 }, alt: 'Map of trading stations', caption: 'Trading stations c. 1750' }

/** What an assistant would write back for that test. */
function assistantPackage() {
  const questions = [
    { id: 'q1', type: 'short-answer', stem: doc(paragraph('Use the map to name the trading station farthest east.'), map) },
    {
      id: 'q2',
      type: 'multiple-choice',
      stem: doc(map, paragraph('Which European power held the most stations on the map?')),
      choices: [
        { id: 'q2-c1', content: doc(paragraph('Portugal')), correct: true },
        { id: 'q2-c2', content: doc(paragraph('Denmark')), correct: false },
      ],
    },
    {
      id: 'q3',
      type: 'short-answer',
      stem: doc(paragraph('Describe the graph of the function shown below.'), { type: 'block-image', pending: { image: 2 }, alt: 'Graph of a function' }),
    },
    {
      id: 'q4',
      type: 'short-answer',
      stem: doc(paragraph('Describe the circuit drawn below.'), { type: 'block-image', pending: { page: 2 }, alt: 'Circuit diagram' }),
    },
    {
      id: 'q5',
      type: 'short-answer',
      stem: doc(paragraph('Label the parts of the cell drawn below.'), { type: 'block-image', pending: { page: 2 }, alt: 'Cell diagram' }),
    },
  ]
  return Buffer.from(JSON.stringify({
    format: 'test-parrot/package',
    formatVersion: '0.1.0',
    generator: { name: 'Assistant', version: '1' },
    requiredFeatures: [],
    questionBanks: [{
      id: 'history',
      record: {
        format: 'test-parrot/question-bank',
        formatVersion: '0.4.0',
        generator: { name: 'Assistant', version: '1' },
        requiredFeatures: [],
        bank: { name: 'Trading Stations', questions },
        media: [],
      },
    }],
    exams: [{
      format: 'test-parrot/exam',
      formatVersion: '0.1.0',
      name: 'Trading Stations Quiz',
      positions: questions.map(({ id }) => ({ question: { bank: 'history', question: id } })),
    }],
  }))
}

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
  await expect(dialog.getByRole('status').filter({ hasText: 'Found 2 pictures in unit-test.pdf.' })).toBeVisible()

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
  await expect(dialog.getByRole('status').filter({ hasText: 'Found 2 pictures in unit-test.pdf.' })).toBeVisible()

  await dialog.getByLabel('JSON file from your AI assistant').setInputFiles({
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
