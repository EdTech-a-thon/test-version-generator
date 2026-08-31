// The export workflow, in a real browser.
//
// One accessible modal, opened from Export, is now the whole of the export
// interaction: no menu, no options strip beneath the header. These tests drive
// it the way a teacher does — by role and by accessible name — and assert what
// the application actually produced: a native print invocation carrying every
// prepared page, or a real combined Word download.

import { expect, test, type Page } from '@playwright/test'

// One multiple-choice question with two answers and one short-answer question:
// small enough to reason about, and its answer order has exactly two
// arrangements, which is what makes the version-count limit observable.
const EXAM = {
  title: 'Biology Quiz',
  questions: [
    {
      id: 'm1',
      type: 'multiple-choice',
      columns: 1,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Which is a mammal?' }],
          },
          {
            type: 'multipleChoice',
            content: [
              {
                type: 'multipleChoiceChoice',
                attrs: { id: 'c1', correct: true },
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Whale' }] },
                ],
              },
              {
                type: 'multipleChoiceChoice',
                attrs: { id: 'c2', correct: false },
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Shark' }] },
                ],
              },
            ],
          },
        ],
      },
    },
    {
      id: 'o1',
      type: 'open',
      columns: 'auto',
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Explain why.' }] },
        ],
      },
    },
  ],
}

const DRAFT = {
  exam: EXAM,
  versions: [
    {
      id: 'v1',
      letter: 'A',
      questionOrder: ['m1', 'o1'],
      choiceOrder: { m1: ['c1', 'c2'] },
    },
  ],
  currentVersionId: 'v1',
  dirty: false,
}

/** The exam the teacher is looking at, plus a print dialog that counts its
 *  invocations instead of opening. A headless browser has no dialog to open,
 *  and the application keeps its print document mounted until `afterprint`,
 *  which a stub deliberately never fires — exactly what an open dialog does. */
async function open(page: Page, options: { failSaves?: boolean } = {}) {
  await page.addInitScript((draft) => {
    localStorage.setItem('exam-draft-v1', JSON.stringify(draft))
  }, DRAFT)
  await page.addInitScript(() => {
    const counter = { calls: 0 }
    ;(window as unknown as { printCalls: { calls: number } }).printCalls = counter
    window.print = () => {
      counter.calls += 1
    }
  })
  if (options.failSaves) {
    // Saving the exam writes to IndexedDB. A store that cannot be opened is the
    // simplest honest failure: the export must stop rather than publish content
    // that was never saved.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        get: () => ({
          open: () => {
            const request: Record<string, unknown> = {}
            queueMicrotask(() => (request.onerror as (() => void) | undefined)?.())
            return request
          },
        }),
      })
    })
  }
  await page.goto('/')
  await page.locator('.exam-page').first().waitFor()
}

function dialogOf(page: Page) {
  return page.getByRole('dialog', { name: 'Export' })
}

async function openDialog(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(dialogOf(page)).toBeVisible()
  return dialogOf(page)
}

function printCalls(page: Page) {
  return page.evaluate(
    () => (window as unknown as { printCalls: { calls: number } }).printCalls.calls,
  )
}

test('Export opens one dialog on the defaults, and no menu', async ({ page }) => {
  await open(page)
  await expect(page.getByRole('menu', { name: 'Export options' })).toHaveCount(0)

  const dialog = await openDialog(page)
  await expect(dialog.getByRole('radio', { name: 'Print / Save as PDF' })).toBeChecked()
  await expect(dialog.getByRole('radio', { name: 'Word (.docx)' })).not.toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: 'Student test' })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: 'Answer key' })).not.toBeChecked()
  await expect(dialog.getByRole('spinbutton', { name: 'Versions' })).toHaveValue('1')
  await expect(dialog.getByRole('checkbox', { name: 'Shuffle question order' })).not.toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: 'Shuffle answer order' })).not.toBeChecked()
  await expect(dialog.getByRole('button', { name: 'Print', exact: true })).toBeEnabled()
  // The document behind the dialog is not displaced by it.
  await expect(page.locator('.exam-page').first()).toBeVisible()
})

test('one format at a time, and the primary action says which', async ({ page }) => {
  await open(page)
  const dialog = await openDialog(page)

  await dialog.getByRole('radio', { name: 'Word (.docx)' }).check()
  await expect(dialog.getByRole('radio', { name: 'Print / Save as PDF' })).not.toBeChecked()
  await expect(dialog.getByRole('button', { name: 'Download DOCX' })).toBeVisible()

  await dialog.getByRole('radio', { name: 'Print / Save as PDF' }).check()
  await expect(dialog.getByRole('button', { name: 'Print', exact: true })).toBeVisible()
})

test('an export must carry at least one document', async ({ page }) => {
  await open(page)
  const dialog = await openDialog(page)

  await dialog.getByRole('checkbox', { name: 'Student test' }).uncheck()
  await expect(dialog.getByRole('alert')).toContainText('student test')
  await expect(dialog.getByRole('button', { name: 'Print', exact: true })).toBeDisabled()

  await dialog.getByRole('checkbox', { name: 'Answer key' }).check()
  await expect(dialog.getByRole('button', { name: 'Print', exact: true })).toBeEnabled()
})

test('the version count is checked against what this exam can produce', async ({ page }) => {
  await open(page)
  const dialog = await openDialog(page)
  const count = dialog.getByRole('spinbutton', { name: 'Versions' })
  const primary = dialog.getByRole('button', { name: 'Print', exact: true })

  await count.fill('3')
  await dialog.getByRole('checkbox', { name: 'Shuffle answer order' }).check()
  // Two answers arrange two ways, so a third version cannot be distinct.
  await expect(dialog.getByRole('alert')).toContainText('2 unique versions')
  await expect(primary).toBeDisabled()
  // The impossible count stays on screen rather than being corrected silently.
  await expect(count).toHaveValue('3')

  await count.fill('2')
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(primary).toBeEnabled()
})

test('Cancel, Escape and the backdrop all return focus to Export', async ({ page }) => {
  await open(page)
  const exportButton = page.getByRole('button', { name: 'Export', exact: true })

  await openDialog(page)
  await dialogOf(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(dialogOf(page)).toBeHidden()
  await expect(exportButton).toBeFocused()

  await openDialog(page)
  await page.keyboard.press('Escape')
  await expect(dialogOf(page)).toBeHidden()
  await expect(exportButton).toBeFocused()

  await openDialog(page)
  await page.locator('.dialog-backdrop').click({ position: { x: 5, y: 5 } })
  await expect(dialogOf(page)).toBeHidden()
  await expect(exportButton).toBeFocused()
})

test('focus is trapped inside the open dialog', async ({ page }) => {
  await open(page)
  const dialog = await openDialog(page)
  const first = dialog.getByRole('radio', { name: 'Print / Save as PDF' })
  const last = dialog.getByRole('button', { name: 'Print', exact: true })

  await expect(first).toBeFocused()
  await first.focus()
  await page.keyboard.press('Shift+Tab')
  await expect(last).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(first).toBeFocused()
})

test('Print sends every prepared version to the browser', async ({ page }) => {
  await open(page)
  const dialog = await openDialog(page)

  await dialog.getByRole('checkbox', { name: 'Answer key' }).check()
  await dialog.getByRole('spinbutton', { name: 'Versions' }).fill('2')
  await dialog.getByRole('checkbox', { name: 'Shuffle answer order' }).check()
  await dialog.getByRole('button', { name: 'Print', exact: true }).click()

  await expect(dialogOf(page)).toBeHidden()
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeFocused()
  await expect
    .poll(() => printCalls(page))
    .toBe(1)

  // Two student tests then two answer keys, each one sheet, each naming its
  // own version.
  const pages = page.locator('.print-output .exam-page')
  await expect(pages).toHaveCount(4)
  expect(
    await page.locator('.print-output .page-id').allTextContents(),
  ).toEqual(['ID: A', 'ID: B', 'ID: A', 'ID: B'])
  await expect(page.locator('.print-output .answer-key-heading')).toHaveCount(2)
})

test('one primary activation cannot start two print operations', async ({ page }) => {
  await open(page)
  const dialog = await openDialog(page)
  const primary = dialog.getByRole('button', { name: 'Print', exact: true })

  await primary.dblclick()
  await expect(dialogOf(page)).toBeHidden()
  await expect.poll(() => printCalls(page)).toBe(1)
})

test('Word downloads one combined file named for its versions', async ({ page }) => {
  await open(page)
  const dialog = await openDialog(page)

  await dialog.getByRole('radio', { name: 'Word (.docx)' }).check()
  await dialog.getByRole('checkbox', { name: 'Answer key' }).check()
  await dialog.getByRole('spinbutton', { name: 'Versions' }).fill('2')
  await dialog.getByRole('checkbox', { name: 'Shuffle answer order' }).check()

  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download DOCX' }).click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toBe('Biology Quiz-versions-A-B.docx')
  const stream = await download.createReadStream()
  const firstChunk = await new Promise<Buffer>((resolve, reject) => {
    stream.once('data', (chunk) => resolve(Buffer.from(chunk)))
    stream.once('error', reject)
  })
  expect([...firstChunk.subarray(0, 2)]).toEqual([0x50, 0x4b])
  await expect(dialogOf(page)).toBeHidden()
})

test('a save failure stops the export and keeps the configuration', async ({ page }) => {
  await open(page, { failSaves: true })
  const dialog = await openDialog(page)

  await dialog.getByRole('checkbox', { name: 'Answer key' }).check()
  await dialog.getByRole('button', { name: 'Print', exact: true }).click()

  await expect(dialog.getByRole('alert')).toContainText('could not be saved')
  await expect(dialog).toBeVisible()
  // Nothing was published, and the teacher's settings are still there to retry.
  expect(await printCalls(page)).toBe(0)
  await expect(dialog.getByRole('checkbox', { name: 'Answer key' })).toBeChecked()
  await expect(dialog.getByRole('button', { name: 'Print', exact: true })).toBeEnabled()
})

test('randomizing one version is allowed and simply changes nothing', async ({ page }) => {
  await open(page)
  const dialog = await openDialog(page)

  // Chosen before the count, and left on: one version has nothing to vary, so
  // the export goes ahead as Version A rather than refusing or warning.
  await dialog.getByRole('checkbox', { name: 'Shuffle answer order' }).check()
  await expect(dialog.getByRole('spinbutton', { name: 'Versions' })).toHaveValue('1')
  await expect(dialog.getByRole('button', { name: 'Print', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Print', exact: true }).click()

  await expect(dialogOf(page)).toBeHidden()
  await expect.poll(() => printCalls(page)).toBe(1)
  const pages = page.locator('.print-output .exam-page')
  await expect(pages).toHaveCount(1)
  expect(await page.locator('.print-output .page-id').allTextContents()).toEqual(['ID: A'])
  // Version A keeps the arrangement on screen: the correct answer is still A.
  await expect(page.locator('.print-output .choice-letter').first()).toHaveText('A.')
})
