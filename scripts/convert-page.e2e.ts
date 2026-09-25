import { expect, test } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { assistantPackage, picture, sourceDocument } from './pending-images-fixtures'

/**
 * Converting a test starts from one drop zone, and shows only the path the
 * dropped file needs.
 */

async function textOnlyPdf() {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  pdf.addPage([612, 792]).drawText('1. Name the largest planet.', { x: 60, y: 730, size: 12, font })
  return Buffer.from(await pdf.save())
}

test('the convert page asks only for the test, then shows the path it needs', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/get-started/convert')
  await expect(page.getByText('Drop your PDF here to get started')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy instructions' })).toHaveCount(0)
  const steps = page.getByRole('region', { name: 'Convert your test' })

  // A PDF with pictures goes to the AI as a labeled copy.
  await page.getByLabel('Your test').setInputFiles({ name: 'unit-test.pdf', mimeType: 'application/pdf', buffer: await sourceDocument() })
  await expect(steps.getByRole('status')).toHaveText('Pictures detected in your PDF')
  await expect(steps).toContainText('Test Parrot found 2 pictures in unit-test.pdf.')
  await expect(steps.getByRole('button', { name: 'Download labeled PDF' })).toBeVisible()
  await expect(steps).toContainText('attach the labeled PDF (not your original)')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Starting over with a PDF that has no pictures needs no labeled copy.
  await steps.getByRole('button', { name: 'Start over with another file' }).click()
  await page.getByLabel('Your test').setInputFiles({ name: 'planets.pdf', mimeType: 'application/pdf', buffer: await textOnlyPdf() })
  await expect(steps.getByRole('status')).toHaveText('No pictures in your PDF')
  await expect(steps.getByRole('button', { name: 'Download labeled PDF' })).toHaveCount(0)
  await steps.getByRole('button', { name: 'Copy instructions' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('found no embedded pictures in this document')

  // A photo is converted as it is, and its pictures are cropped after.
  await steps.getByRole('button', { name: 'Start over with another file' }).click()
  await page.getByLabel('Your test').setInputFiles({ name: 'quiz-photo.png', mimeType: 'image/png', buffer: Buffer.from(picture(600, 800, 3)) })
  await expect(steps.getByRole('status')).toHaveText('A photo of your test')
  await expect(steps).toContainText('attach your photo')
  await steps.getByRole('button', { name: 'Copy instructions' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('There is no labeled copy of this source')

  const photoPackage = JSON.parse(assistantPackage().toString())
  const questions = photoPackage.questionBanks[0].record.bank.questions
  photoPackage.questionBanks[0].record.bank.questions = [{
    ...questions[0],
    stem: { type: 'document', content: [questions[0].stem.content[0], { type: 'block-image', pending: { page: 1 }, alt: 'Map' }] },
  }]
  photoPackage.exams[0].positions = [{ question: { bank: 'history', question: 'q1' } }]
  await steps.getByLabel('File from your AI').setInputFiles({ name: 'quiz.parrot.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(photoPackage)) })
  const dialog = page.getByRole('dialog', { name: 'Import' })
  await dialog.getByRole('button', { name: 'Resolve Images' }).click()
  const row = dialog.getByRole('listitem', { name: 'Question 1', exact: true })
  await row.getByRole('button', { name: 'Crop from a page' }).click()
  await expect(row).toContainText('Page 1 of 1')
  await row.getByRole('button', { name: 'Use the whole page' }).click()
  await expect(row).toContainText('Cropped from page 1')
})
