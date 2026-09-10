import { expect, test, type Page } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { canonicalizeJson } from '../src/question-bank-export'

async function resourceCount(page: Page) {
  return page.evaluate(async () => {
    const { createQuestionBankWorkspaceService } = (await import(
      /* @vite-ignore */ '/src/question-bank-workspaces.ts'
    )) as typeof import('../src/question-bank-workspaces')
    return (await createQuestionBankWorkspaceService().recent()).length
  })
}

async function questionBankPdf(name = 'Portable chemistry') {
  const record = {
    format: 'test-parrot/question-bank',
    formatVersion: '0.1.0',
    generator: { name: 'Independent Generator', version: '1' },
    requiredFeatures: [],
    integrity: { algorithm: 'sha-256', digest: '' },
    bank: {
      name,
      description: 'A shared chemistry bank.',
      author: 'Ada Teacher',
      license: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
      questions: [{
        id: 'q1', type: 'multiple-choice', difficulty: 'easy', topics: ['Atoms'],
        stem: { type: 'document', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Which particle is neutral?' }] }] },
        choices: [
          { id: 'q1-c1', content: { type: 'document', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Proton' }] }] }, correct: false },
          { id: 'q1-c2', content: { type: 'document', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Neutron' }] }] }, correct: true },
        ],
      }],
    },
    media: [],
  }
  const digestless = structuredClone(record)
  delete (digestless.integrity as { digest?: string }).digest
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalizeJson(digestless)))
  record.integrity.digest = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const pdf = await PDFDocument.create()
  pdf.addPage()
  await pdf.attach(new TextEncoder().encode(JSON.stringify(record)), 'pdfcx.json', {
    description: 'pdf-canonical-extraction', mimeType: 'application/json',
  })
  return Buffer.from(await pdf.save({ useObjectStreams: false }))
}

test('imports a validated PDF as a durable independent bank and allows duplicate names', async ({ page }) => {
  await page.goto('/question-banks')
  await expect(page.getByRole('heading', { name: 'All Question Banks' })).toBeVisible()
  const before = await resourceCount(page)
  const trigger = page.getByRole('button', { name: 'Import Question Bank' })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Import Question Bank' })
  await expect(dialog.getByLabel('Question Bank PDF')).toBeFocused()
  await dialog.getByLabel('Question Bank PDF').setInputFiles({ name: 'chemistry.pdf', mimeType: 'application/pdf', buffer: await questionBankPdf() })
  await expect(dialog.getByRole('region', { name: 'Import confirmation' })).toContainText('Record integrity verified')
  await expect(dialog).toContainText('Author identity and the visible PDF pages are not verified')
  await expect(dialog).toContainText('1')
  await dialog.getByLabel('New Question Bank name').fill('My Chemistry')
  await dialog.getByRole('button', { name: 'Import Question Bank' }).click()
  await expect(page).toHaveURL(/\/editor/)
  await expect(page.getByRole('textbox', { name: 'Question Bank name' })).toHaveValue('My Chemistry')
  await expect(page.getByRole('region', { name: 'Question Bank', exact: true })).toContainText('Which particle is neutral?')
  expect(await resourceCount(page)).toBe(before + 1)

  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Question Bank name' })).toHaveValue('My Chemistry')
  await expect(page.getByRole('region', { name: 'Question Bank', exact: true })).toContainText('Which particle is neutral?')

  await page.goto('/question-banks')
  await page.getByRole('button', { name: 'Import Question Bank' }).click()
  const again = page.getByRole('dialog', { name: 'Import Question Bank' })
  await again.getByLabel('Question Bank PDF').setInputFiles({ name: 'chemistry.pdf', mimeType: 'application/pdf', buffer: await questionBankPdf('My Chemistry') })
  await again.getByRole('button', { name: 'Import Question Bank' }).click()
  await expect(page).toHaveURL(/\/editor/)
  await expect(page.getByRole('textbox', { name: 'Question Bank name' })).toHaveValue('My Chemistry')
  await expect.poll(() => resourceCount(page)).toBe(before + 2)
})

test('cancellation and invalid files preserve resources and restore useful focus', async ({ page }) => {
  await page.goto('/question-banks')
  await expect(page.getByRole('heading', { name: 'All Question Banks' })).toBeVisible()
  const before = await resourceCount(page)
  const trigger = page.getByRole('button', { name: 'Import Question Bank' })
  await trigger.click()
  let dialog = page.getByRole('dialog', { name: 'Import Question Bank' })
  await dialog.getByLabel('Question Bank PDF').setInputFiles({ name: 'chemistry.pdf', mimeType: 'application/pdf', buffer: await questionBankPdf() })
  await expect(dialog.getByLabel('New Question Bank name')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
  expect(await resourceCount(page)).toBe(before)

  await trigger.click()
  dialog = page.getByRole('dialog', { name: 'Import Question Bank' })
  await dialog.getByLabel('Question Bank PDF').setInputFiles({ name: 'hostile.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') })
  await expect(dialog.getByRole('alert')).toContainText('not a valid PDF')
  await expect(dialog.getByLabel('Question Bank PDF')).toBeFocused()
  expect(await resourceCount(page)).toBe(before)
})
