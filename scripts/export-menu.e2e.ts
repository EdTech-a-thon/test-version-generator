import { expect, test } from '@playwright/test'

test('Export offers Print and a real DOCX download', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.getByRole('combobox', {
      name: 'Shuffle questions by section — ignores the current selection',
    }),
  ).toHaveCount(0)

  const exportButton = page.getByRole('button', { name: 'Export', exact: true })
  await exportButton.click()
  await expect(page.getByRole('menu', { name: 'Export options' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Print' })).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Download DOCX' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.docx$/)

  const stream = await download.createReadStream()
  const firstChunk = await new Promise<Buffer>((resolve, reject) => {
    stream.once('data', (chunk) => resolve(Buffer.from(chunk)))
    stream.once('error', reject)
  })
  expect([...firstChunk.subarray(0, 2)]).toEqual([0x50, 0x4b])
})
