import { expect, test } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { canonicalizeJson } from '../src/question-bank-export'

async function resourceCount(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const { createQuestionBankWorkspaceService } = (await import(
      /* @vite-ignore */ '/src/question-bank-workspaces.ts'
    )) as typeof import('../src/question-bank-workspaces')
    return (await createQuestionBankWorkspaceService().recent()).length
  })
}

test('representative invalid and unsupported files show specific errors without changing resources', async ({ page }) => {
  await page.goto('/question-banks')
  await expect(page.getByRole('heading', { name: 'All Question Banks' })).toBeVisible()
  const before = await resourceCount(page)

  await page.getByRole('button', { name: 'Inspect Question Bank PDF' }).click()
  const dialog = page.getByRole('dialog', { name: 'Inspect Question Bank PDF' })
  const chooser = dialog.getByLabel('Question Bank PDF')
  await chooser.setInputFiles({ name: 'hostile.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') })
  await expect(dialog.getByRole('alert')).toContainText('not a valid PDF')
  expect(await resourceCount(page)).toBe(before)

  const record = {
      format: 'test-parrot/question-bank',
      formatVersion: '0.2.0',
      generator: { name: 'Other Generator', version: '1' },
      requiredFeatures: [],
      integrity: { algorithm: 'sha-256', digest: '' },
      bank: { name: 'Unsupported', questions: [] },
      media: [],
    }
  const digestless = structuredClone(record)
  delete (digestless.integrity as { digest?: string }).digest
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalizeJson(digestless)))
  record.integrity.digest = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const pdf = await PDFDocument.create()
  pdf.addPage()
  await pdf.attach(new TextEncoder().encode(JSON.stringify(record)), 'pdfcx.json', {
    description: 'pdf-canonical-extraction',
    mimeType: 'application/json',
  })
  await chooser.setInputFiles({ name: 'unsupported.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save({ useObjectStreams: false })) })
  await expect(dialog.getByRole('alert')).toContainText('format version “0.2.0” is unsupported')
  await expect(dialog.getByRole('alert')).toContainText('Supported versions: 0.1.0')
  expect(await resourceCount(page)).toBe(before)
})
