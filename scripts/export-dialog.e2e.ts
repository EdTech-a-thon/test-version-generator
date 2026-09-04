import { expect, test, type Page } from '@playwright/test'
import type { PublicationHistory } from '../src/export-preparation'
import { seedAuthoringState } from './seed-authoring'

const EXAM = {
  title: 'Biology Quiz',
  questions: [
    {
      id: 'm1',
      type: 'multiple-choice' as const,
      columns: 1 as const,
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
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Whale' }],
                  },
                ],
              },
              {
                type: 'multipleChoiceChoice',
                attrs: { id: 'c2', correct: false },
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Shark' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    {
      id: 'o1',
      type: 'open' as const,
      columns: 2 as const,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Explain why.' }],
          },
        ],
      },
    },
  ],
}

const AUTHORING = {
  questionBank: { questions: EXAM.questions },
  examDraft: { title: EXAM.title, questionIds: ['m1', 'o1'] },
  dirty: false,
}

async function open(page: Page, persistent = true) {
  await page.addInitScript((granted) => {
    const state = { calls: 0, granted }
    ;(window as unknown as { persistence: typeof state }).persistence = state
    Object.defineProperty(navigator.storage, 'persist', {
      configurable: true,
      value: async () => {
        state.calls += 1
        return state.granted
      },
    })
  }, persistent)
  await seedAuthoringState(page, AUTHORING)
  await page.goto('/')
  await page.locator('.exam-page').first().waitFor()
}

function dialogOf(page: Page) {
  return page.getByRole('dialog', { name: 'Export DOCX' })
}

async function openDialog(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(dialogOf(page)).toBeVisible()
  return dialogOf(page)
}

async function historyOf(page: Page): Promise<PublicationHistory> {
  return page.evaluate(async () => {
    const modulePath = '/src/indexeddb-authoring.ts'
    const { createIndexedDBAuthoringBackend } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import('../src/indexeddb-authoring')
    return createIndexedDBAuthoringBackend().readPublicationHistory()
  })
}

test('Export defaults to one complete friendly-named DOCX with a clean preview', async ({
  page,
}) => {
  await open(page)
  const dialog = await openDialog(page)

  await expect(
    dialog.getByRole('checkbox', { name: 'Student test' }),
  ).toBeChecked()
  await expect(
    dialog.getByRole('checkbox', { name: 'Answer key' }),
  ).toBeChecked()
  await expect(
    dialog.getByRole('spinbutton', { name: 'Versions' }),
  ).toHaveCount(0)
  await expect(dialog.getByText('Randomize', { exact: false })).toHaveCount(0)
  await expect(dialog.getByText('New Version')).toBeVisible()
  await expect(dialog.getByText('Amber Badger', { exact: true })).toBeVisible()
  await expect(
    dialog.getByLabel('Export Preview').locator('.exam-page'),
  ).toHaveCount(2)
  await expect(
    dialog.getByLabel('Export Preview').locator('.question-handles'),
  ).toHaveCount(0)
  await expect(
    dialog.getByRole('button', { name: 'Download DOCX' }),
  ).toBeEnabled()
})

test('test-only, key-only, and both remain selectable', async ({ page }) => {
  await open(page)
  const dialog = await openDialog(page)
  const testBox = dialog.getByRole('checkbox', { name: 'Student test' })
  const keyBox = dialog.getByRole('checkbox', { name: 'Answer key' })
  const preview = dialog.getByLabel('Export Preview').locator('.exam-page')

  await keyBox.uncheck()
  await expect(preview).toHaveCount(1)
  await testBox.uncheck()
  await expect(dialog.getByRole('alert')).toContainText(
    'Choose the student test',
  )
  await expect(
    dialog.getByRole('button', { name: 'Download DOCX' }),
  ).toBeDisabled()
  await keyBox.check()
  await expect(preview).toHaveCount(1)
  await expect(
    dialog.getByRole('button', { name: 'Download DOCX' }),
  ).toBeEnabled()
})

test('publication commits once, reuses its identity, and leaves the Exam Draft unchanged', async ({
  page,
}) => {
  await open(page)
  let dialog = await openDialog(page)

  const firstDownload = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download DOCX' }).click()
  expect((await firstDownload).suggestedFilename()).toBe(
    'Biology Quiz-Amber Badger.docx',
  )
  await expect(dialogOf(page)).toBeHidden()

  let history = await historyOf(page)
  expect(history.versions).toHaveLength(1)
  expect(history.revisions).toHaveLength(2)
  expect(history.plans.map((plan) => plan.stream).sort()).toEqual([
    'answer-key',
    'test',
  ])
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { persistence: { calls: number } }).persistence
          .calls,
    ),
  ).toBe(1)
  await expect(page.locator('.exam-question')).toHaveCount(2)
  await expect(page.locator('.exam-question').first()).toContainText(
    'Which is a mammal?',
  )

  dialog = await openDialog(page)
  await expect(dialog.getByText('Re-export existing Version')).toBeVisible()
  await expect(dialog.getByText('Amber Badger', { exact: true })).toBeVisible()
  const secondDownload = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download DOCX' }).click()
  expect((await secondDownload).suggestedFilename()).toBe(
    'Biology Quiz-Amber Badger.docx',
  )
  history = await historyOf(page)
  expect(history.versions).toHaveLength(1)
  expect(history.revisions).toHaveLength(2)
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { persistence: { calls: number } }).persistence
          .calls,
    ),
  ).toBe(1)
})

test('persistent-storage denial is explained separately from publication failure', async ({
  page,
}) => {
  await open(page, false)
  const dialog = await openDialog(page)
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download DOCX' }).click()
  await download

  await expect(page.getByRole('status')).toContainText(
    'Persistent storage was not granted',
  )
  expect((await historyOf(page)).versions).toHaveLength(1)
})

test('an IndexedDB transaction failure creates neither history nor download', async ({
  page,
}) => {
  await open(page)
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add
    IDBObjectStore.prototype.add = function (
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === 'versions') {
        throw new DOMException('Injected publication failure', 'DataCloneError')
      }
      return original.call(this, value, key)
    }
  })
  const dialog = await openDialog(page)
  await dialog.getByRole('button', { name: 'Download DOCX' }).click()

  await expect(dialog.getByRole('alert')).toContainText(
    'no download was started',
  )
  await expect(dialog).toBeVisible()
  expect((await historyOf(page)).versions).toHaveLength(0)
})

test('quota failure is reported separately and creates no Version', async ({
  page,
}) => {
  await open(page)
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add
    IDBObjectStore.prototype.add = function (
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === 'versions') {
        throw new DOMException('Injected quota failure', 'QuotaExceededError')
      }
      return original.call(this, value, key)
    }
  })
  const dialog = await openDialog(page)
  await dialog.getByRole('button', { name: 'Download DOCX' }).click()

  await expect(dialog.getByRole('alert')).toContainText(
    'Browser storage is full',
  )
  expect((await historyOf(page)).versions).toHaveLength(0)
})

test('unresolved required media blocks publication with the affected question', async ({
  page,
}) => {
  const broken = structuredClone(AUTHORING)
  broken.questionBank.questions[0]!.doc.content.splice(1, 0, {
    type: 'image-block',
    attrs: { src: `/local-images/${'f'.repeat(64)}` },
  } as never)
  await seedAuthoringState(page, broken)
  await page.goto('/')
  const dialog = await openDialog(page)
  await dialog.getByRole('button', { name: 'Download DOCX' }).click()

  await expect(dialog.getByRole('alert')).toContainText('question 1')
  expect((await historyOf(page)).versions).toHaveLength(0)
})

test('an empty Exam Draft is blocked with an actionable message', async ({
  page,
}) => {
  await page.goto('/')
  const dialog = await openDialog(page)

  await expect(dialog.getByRole('alert')).toContainText(
    'Add at least one question',
  )
  await expect(
    dialog.getByRole('button', { name: 'Download DOCX' }),
  ).toBeDisabled()
})

test('Cmd/Ctrl+P routes to Export, and every dismissal restores focus', async ({
  page,
}) => {
  await open(page)
  const exportButton = page.getByRole('button', {
    name: 'Export',
    exact: true,
  })

  await page.keyboard.press('Control+P')
  await expect(dialogOf(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(exportButton).toBeFocused()

  await openDialog(page)
  await dialogOf(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(exportButton).toBeFocused()

  await openDialog(page)
  await page.locator('.dialog-backdrop').click({ position: { x: 5, y: 5 } })
  await expect(exportButton).toBeFocused()
})
