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

const AUTHORING_WITH_LINK = {
  ...AUTHORING,
  questionBank: {
    questions: EXAM.questions.map((question) =>
      question.id === 'm1'
        ? {
            ...question,
            doc: {
              ...question.doc,
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'Linked question',
                      marks: [
                        {
                          type: 'link',
                          attrs: { href: '/preview-link-target' },
                        },
                      ],
                    },
                  ],
                },
                ...question.doc.content.slice(1),
              ],
            },
          }
        : question,
    ),
  },
}

async function open(
  page: Page,
  persistent = true,
  authoring = AUTHORING,
) {
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
  await seedAuthoringState(page, authoring)
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

/** Hold the first publication after packaging, while the dialog is preparing. */
async function holdPersistentStorage(page: Page) {
  await page.evaluate(() => {
    let release: ((granted: boolean) => void) | undefined
    const pending = new Promise<boolean>((resolve) => {
      release = resolve
    })
    Object.defineProperty(navigator.storage, 'persist', {
      configurable: true,
      value: () => pending,
    })
    ;(window as typeof window & { releaseExportPersistence?: () => void })
      .releaseExportPersistence = () => release?.(true)
  })
}

async function releasePersistentStorage(page: Page) {
  await page.evaluate(() => {
    ;(window as typeof window & { releaseExportPersistence?: () => void })
      .releaseExportPersistence?.()
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
  await expect(dialog.locator('.export-version-state')).toContainText('New Version')
  await expect(dialog.getByText('Amber Badger', { exact: true })).toBeVisible()
  await expect(dialog.locator('.export-format')).toContainText('FormatDOCX')
  const preview = dialog.getByLabel('Export Preview')
  await expect(preview.locator('.exam-page')).toHaveCount(2)
  await expect(preview).toContainText('Which is a mammal?')
  // Correctness is useful authoring feedback, but neither a student-facing
  // preview nor the document it represents may disclose it.
  await expect(
    page.locator('.exam-question[data-question-id="m1"] .choice-correctness-marker'),
  ).toHaveAccessibleName('Correct answer')
  await expect(preview.locator('.choice-correctness-marker')).toHaveCount(0)
  await expect(
    preview.locator('.question-handles, .exam-question--selected, [data-drop]'),
  ).toHaveCount(0)
  const previewQuestion = preview.locator('.exam-question').first()
  // The inert paper is deliberately not hoverable. Inspect its styles without
  // dispatching a pointer event that inert content correctly rejects.
  await expect(previewQuestion).toHaveCSS('cursor', 'default')
  await expect(previewQuestion).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(previewQuestion).toHaveCSS('box-shadow', 'none')
  await expect(
    dialog.getByRole('button', { name: 'Download DOCX' }),
  ).toBeEnabled()
})

test('Export lays the preview left of the format and content controls on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await open(page)
  const dialog = await openDialog(page)

  const geometry = await dialog.locator('.export-publication-body').evaluate((body) => {
    const preview = body.querySelector<HTMLElement>('.export-preview')!
    const controls = body.querySelector<HTMLElement>('.export-controls')!
    const previewBounds = preview.getBoundingClientRect()
    const controlsBounds = controls.getBoundingClientRect()
    return {
      previewLeft: previewBounds.left,
      previewRight: previewBounds.right,
      controlsLeft: controlsBounds.left,
      controlsTop: controlsBounds.top,
      previewTop: previewBounds.top,
    }
  })

  expect(geometry.previewLeft).toBeLessThan(geometry.controlsLeft)
  expect(geometry.previewRight).toBeLessThanOrEqual(geometry.controlsLeft + 1)
  expect(geometry.previewTop).toBe(geometry.controlsTop)
  await expect(dialog.locator('.export-format')).toContainText('FormatDOCX')
})

test('Export keeps its preview available in a narrow stacked layout', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 })
  await open(page)
  const dialog = await openDialog(page)
  const preview = dialog.getByLabel('Export Preview')

  await expect(preview).toBeVisible()
  await expect(preview.locator('.exam-page')).toHaveCount(2)
  const geometry = await dialog.locator('.export-publication-body').evaluate((body) => {
    const preview = body.querySelector<HTMLElement>('.export-preview')!
    const controls = body.querySelector<HTMLElement>('.export-controls')!
    return {
      previewTop: preview.getBoundingClientRect().top,
      controlsTop: controls.getBoundingClientRect().top,
    }
  })
  expect(geometry.previewTop).toBeLessThan(geometry.controlsTop)
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

test('Version History browses newest stored plans and re-exports without changing history', async ({
  page,
}) => {
  await open(page)

  let dialog = await openDialog(page)
  let download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download DOCX' }).click()
  await download

  await page.getByRole('textbox', { name: 'Exam name' }).fill('Second Biology Quiz')
  dialog = await openDialog(page)
  download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download DOCX' }).click()
  await download

  const historyBeforeReExport = structuredClone(await historyOf(page))
  const liveQuestions = page.locator('.draft-document:not([hidden]) .exam-question')
  // Keep a selected draft question while inspecting history. Delete,
  // Backspace, undo, and redo must not reach this hidden selection.
  await liveQuestions.nth(0).click()
  const draftBeforeBrowsing = await page.locator('.draft-document').evaluate((draft) => draft.innerHTML)
  const draftTitleBeforeBrowsing = await page.getByRole('textbox', { name: 'Exam name' }).inputValue()
  await page.getByRole('button', { name: 'Version History' }).click()
  await page.keyboard.press('Delete')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Control+Z')
  await page.keyboard.press('Control+Shift+Z')
  await expect(page.locator('.draft-document')).toHaveJSProperty('innerHTML', draftBeforeBrowsing)
  // The exposed edge of the draft is inert while the drawer is open: pointer
  // selection, context menu, and double-click editing cannot reach it.
  await liveQuestions.nth(0).click({ force: true })
  await liveQuestions.nth(0).dblclick({ force: true })
  await liveQuestions.nth(0).click({ button: 'right', force: true })
  await expect(page.getByRole('dialog', { name: 'Question editor' })).toHaveCount(0)
  await expect(page.locator('.context-menu')).toHaveCount(0)
  await expect(page.locator('.draft-document')).toHaveJSProperty('innerHTML', draftBeforeBrowsing)
  await expect(page.getByRole('textbox', { name: 'Exam name' })).toHaveValue(draftTitleBeforeBrowsing)
  // Pointer attempts do not take a history item's keyboard activation away.
  await page.getByLabel('Version History').locator('.version-history-item').first().focus()
  // The same commands are also suppressed after selection hides the drawer.
  await page.keyboard.press('Enter')
  const initialBackToDraft = page.getByRole('button', { name: 'Back to draft' })
  await expect(initialBackToDraft).toBeFocused()
  await page.keyboard.press('Delete')
  await expect(page.locator('.draft-document')).toHaveJSProperty('innerHTML', draftBeforeBrowsing)
  await page.keyboard.press('Backspace')
  await expect(page.locator('.draft-document')).toHaveJSProperty('innerHTML', draftBeforeBrowsing)
  await page.keyboard.press('Control+Z')
  await expect(page.locator('.draft-document')).toHaveJSProperty('innerHTML', draftBeforeBrowsing)
  await page.keyboard.press('Control+Shift+Z')
  await expect(page.locator('.draft-document')).toHaveJSProperty('innerHTML', draftBeforeBrowsing)
  await initialBackToDraft.click()

  await liveQuestions.nth(0).click()
  await page.keyboard.press('Delete')
  await liveQuestions.nth(0).click()
  await page.keyboard.press('Delete')
  await expect(liveQuestions).toHaveCount(0)
  // The current draft can now be empty: historical export still has its own
  // stored plans, revisions, and Media Assets to use.
  const draftTitle = page.getByRole('textbox', { name: 'Exam name' })
  await draftTitle.focus()

  await page.getByRole('button', { name: 'Version History' }).click()
  const history = page.getByLabel('Version History')
  const versions = history.locator('.version-history-item')
  await expect(versions.nth(0)).toBeFocused()
  await expect(versions).toHaveCount(2)
  await expect(versions.nth(0)).toContainText('Amber Falcon')
  await expect(versions.nth(1)).toContainText('Amber Badger')
  await expect(versions.nth(0)).toContainText('2 questions')

  // Keyboard selection moves focus out of the drawer before that drawer hides.
  await page.keyboard.press('Enter')
  const backToDraft = page.getByRole('button', { name: 'Back to draft' })
  await expect(backToDraft).toBeVisible()
  await expect(backToDraft).toBeFocused()
  await expect(page.locator('.historical-document')).toContainText('Second Biology Quiz')

  // The historical document is a clean read-only view; authoring controls,
  // including the live draft title, are unavailable while it is in front.
  await expect(page.getByRole('textbox', { name: 'Exam name' })).toBeDisabled()
  await expect(page.locator('.historical-document')).toContainText('Second Biology Quiz')

  // Reopening History while browsing must not replace the remembered draft
  // target. Keyboard selection returns focus to the historical document.
  await page.getByRole('button', { name: 'Version History' }).click()
  await expect(versions.nth(0)).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(backToDraft).toBeFocused()

  await page.getByRole('button', { name: 'Historical Export', exact: true }).click()
  dialog = dialogOf(page)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Re-export existing Version')).toBeVisible()
  await expect(dialog.getByText('Amber Falcon', { exact: true })).toBeVisible()
  download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download DOCX' }).click()
  await download
  // Historical export is read-only: no Version, revision, plan, metadata, or
  // order changes while its DOCX is assembled from stored records.
  expect(await historyOf(page)).toEqual(historyBeforeReExport)

  await backToDraft.click()
  await expect(draftTitle).toHaveValue('Second Biology Quiz')
  await expect(draftTitle).toBeFocused()
  // The same mounted draft document returns; it was not reconstructed from
  // history and remains empty after its live Remove action.
  await expect(page.locator('.draft-document:not([hidden]) .exam-question')).toHaveCount(0)
})

test('Use as draft confirms replacement, preserves Cancel, and restores the historical arrangement', async ({ page }) => {
  await open(page)
  const dialog = await openDialog(page)
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download DOCX' }).click()
  await download

  const questions = page.locator('.draft-document:not([hidden]) .exam-question')
  const historicalAnswers = await questions.nth(0).locator('.choice-body').allTextContents()
  await page.getByRole('button', { name: 'Actions for question 1' }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('menuitem', { name: 'Vary' }).press('ArrowRight')
  await page.getByRole('menuitem', { name: 'Shuffle answer order' }).press('Enter')
  const liveAnswers = await questions.nth(0).locator('.choice-body').allTextContents()
  expect(liveAnswers).not.toEqual(historicalAnswers)
  await page.getByRole('textbox', { name: 'Exam name' }).fill('Renamed live draft')
  const bankBeforeConfirmation = await page.locator('.question-bank-authoring').evaluate((bank) => bank.innerHTML)

  await page.getByRole('button', { name: 'Version History' }).click()
  await page.getByLabel('Version History').locator('.version-history-item').click()
  const useAsDraft = page.getByRole('button', { name: 'Use as draft' })
  await useAsDraft.click()
  const confirmation = page.getByRole('dialog', { name: 'Replace current draft?' })
  await expect(confirmation).toBeVisible()
  await page.keyboard.press('Control+P')
  await expect(confirmation).toBeVisible()
  await expect(dialogOf(page)).toHaveCount(0)
  await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(confirmation.getByRole('button', { name: 'Replace anyway' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(useAsDraft).toBeFocused()

  await page.getByRole('button', { name: 'Back to draft' }).click()
  await expect(page.getByRole('textbox', { name: 'Exam name' })).toHaveValue('Renamed live draft')
  expect(await questions.nth(0).locator('.choice-body').allTextContents()).toEqual(liveAnswers)
  await expect(page.locator('.question-bank-authoring')).toHaveJSProperty('innerHTML', bankBeforeConfirmation)
  await page.getByRole('button', { name: 'Version History' }).click()
  await page.getByLabel('Version History').locator('.version-history-item').click()

  await useAsDraft.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(confirmation.getByRole('button', { name: 'Replace anyway' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(useAsDraft).toBeFocused()
  await page.getByRole('button', { name: 'Back to draft' }).click()
  expect(await questions.nth(0).locator('.choice-body').allTextContents()).toEqual(historicalAnswers)
  await page.keyboard.press('Control+Z')
  expect(await questions.nth(0).locator('.choice-body').allTextContents()).toEqual(liveAnswers)
  await expect(page.getByRole('textbox', { name: 'Exam name' })).toHaveValue('Renamed live draft')
})

test('Use as draft exports the live draft without replacing the selected Version', async ({ page }) => {
  await open(page)
  const initialDialog = await openDialog(page)
  const firstDownload = page.waitForEvent('download')
  await initialDialog.getByRole('button', { name: 'Download DOCX' }).click()
  await firstDownload

  await page.getByRole('textbox', { name: 'Exam name' }).fill('Current draft export')
  const draftBeforeExport = await page.locator('.draft-document').evaluate((draft) => draft.innerHTML)
  const bankBeforeExport = await page.locator('.question-bank-authoring').evaluate((bank) => bank.innerHTML)
  const historyBeforeExport = structuredClone(await historyOf(page))

  await page.getByRole('button', { name: 'Version History' }).click()
  await page.getByLabel('Version History').locator('.version-history-item').click()
  const useAsDraft = page.getByRole('button', { name: 'Use as draft' })
  await useAsDraft.click()
  const confirmation = page.getByRole('dialog', { name: 'Replace current draft?' })
  await expect(confirmation).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(confirmation.getByRole('button', { name: 'Export current draft' })).toBeFocused()
  await page.keyboard.press('Enter')
  const exportDialog = dialogOf(page)
  await expect(exportDialog).toBeVisible()
  await expect(exportDialog.getByText('New Version')).toBeVisible()
  const download = page.waitForEvent('download')
  await exportDialog.getByRole('button', { name: 'Download DOCX' }).click()
  await download
  await expect(useAsDraft).toBeFocused()

  const historyAfterExport = await historyOf(page)
  expect(historyAfterExport.versions).toHaveLength(historyBeforeExport.versions.length + 1)
  expect(historyAfterExport.versions[0]).toEqual(historyBeforeExport.versions[0])
  await expect(page.locator('.historical-document')).toBeVisible()
  await page.getByRole('button', { name: 'Back to draft' }).click()
  await expect(page.locator('.draft-document')).toHaveJSProperty('innerHTML', draftBeforeExport)
  await expect(page.locator('.question-bank-authoring')).toHaveJSProperty('innerHTML', bankBeforeExport)
})

test('Use as draft compares with an older Version that was re-exported last', async ({ page }) => {
  await open(page)
  let dialog = await openDialog(page)
  let download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download DOCX' }).click()
  await download

  const title = page.getByRole('textbox', { name: 'Exam name' })
  await title.fill('Newer Version')
  dialog = await openDialog(page)
  download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download DOCX' }).click()
  await download

  // This reuses the first Version but is still the last successful live-draft
  // export, so it becomes the confirmation comparison point.
  await title.fill('Biology Quiz')
  dialog = await openDialog(page)
  await expect(dialog.getByText('Re-export existing Version')).toBeVisible()
  download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download DOCX' }).click()
  await download

  // Return to the newer Version's title. Comparing against append-only history
  // would incorrectly treat this as unchanged; it differs from the re-export.
  await title.fill('Newer Version')
  await page.getByRole('button', { name: 'Version History' }).click()
  await page.getByLabel('Version History').locator('.version-history-item').nth(1).click()
  await page.getByRole('button', { name: 'Use as draft' }).click()
  await expect(page.getByRole('dialog', { name: 'Replace current draft?' })).toBeVisible()

  // The checkpoint belongs to publication, not the title edit's undo history.
  // Undo twice returns to Version 2's draft while Version 1 remains the last
  // successful export, so Use as Draft must still demand confirmation.
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Back to draft' }).click()
  await page.keyboard.press('Control+Z')
  await page.keyboard.press('Control+Z')
  await expect(title).toHaveValue('Newer Version')
  await page.getByRole('button', { name: 'Version History' }).click()
  await page.getByLabel('Version History').locator('.version-history-item').nth(1).click()
  await page.getByRole('button', { name: 'Use as draft' }).click()
  await expect(page.getByRole('dialog', { name: 'Replace current draft?' })).toBeVisible()
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

test('preparation locks dismissal and controls while announcing progress accessibly', async ({
  page,
}) => {
  await open(page, true, AUTHORING_WITH_LINK)
  await holdPersistentStorage(page)
  const dialog = await openDialog(page)
  const download = page.waitForEvent('download')
  const previewLink = dialog.locator('.export-preview a')

  // Preview content represents paper rather than offering an alternate
  // navigation surface, so even authored links cannot interrupt publication.
  await expect(previewLink).toHaveCount(1)
  await expect(dialog.locator('.export-preview')).toHaveAttribute('inert', '')

  await dialog.getByRole('button', { name: 'Download DOCX' }).click()

  const status = dialog.getByRole('status', {
    name: 'Export preparation status',
  })
  await expect(status).toContainText('Resolving Version identity')
  await expect(status).toHaveAttribute('aria-live', 'polite')
  await expect(dialog.getByRole('checkbox', { name: 'Student test' })).toBeDisabled()
  await expect(dialog.getByRole('checkbox', { name: 'Answer key' })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  await expect(
    dialog.getByRole('button', { name: 'Preparing…' }),
  ).toBeDisabled()

  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await page.locator('.dialog-backdrop').click({ position: { x: 5, y: 5 } })
  await expect(dialog).toBeVisible()

  // A forced pointer event reaches the link's coordinates; inert content still
  // cannot receive it or navigate away from the locked dialog.
  await dialog.locator('.export-preview a').click({ force: true })
  expect(page.url()).not.toContain('/preview-link-target')
  await page.keyboard.press('Tab')
  await expect(dialog).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog).toBeFocused()

  await releasePersistentStorage(page)
  await download
  await expect(dialog).toBeHidden()
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
  await dialog.getByRole('checkbox', { name: 'Student test' }).uncheck()
  await dialog.getByRole('button', { name: 'Download DOCX' }).click()

  await expect(dialog.getByRole('alert')).toContainText(
    'no download was started',
  )
  await expect(dialog).toBeVisible()
  // The failed attempt stays in the same clean preview configuration, ready
  // for a retry rather than silently returning to the default selection.
  await expect(
    dialog.getByRole('checkbox', { name: 'Student test' }),
  ).not.toBeChecked()
  await expect(
    dialog.getByRole('checkbox', { name: 'Answer key' }),
  ).toBeChecked()
  await expect(
    dialog.getByLabel('Export Preview').locator('.exam-page'),
  ).toHaveCount(1)
  // Recovery returns focus to the enabled controls, which keeps both tab
  // directions inside the dialog instead of falling through to its opener.
  const studentTest = dialog.getByRole('checkbox', { name: 'Student test' })
  await expect(studentTest).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(
    dialog.getByRole('button', { name: 'Download DOCX' }),
  ).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(studentTest).toBeFocused()
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
  const dialog = dialogOf(page)
  await expect(dialog).toBeVisible()
  // The dialog starts in its configuration and keeps focus inside it.
  await expect(
    dialog.getByRole('checkbox', { name: 'Student test' }),
  ).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(
    dialog.getByRole('button', { name: 'Download DOCX' }),
  ).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(
    dialog.getByRole('checkbox', { name: 'Student test' }),
  ).toBeFocused()
  expect(
    await page.evaluate(
      () =>
        !document.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'p',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        ),
    ),
  ).toBe(true)
  await page.keyboard.press('Escape')
  await expect(exportButton).toBeFocused()

  await page.locator('.exam-question[data-question-id]').first().dblclick()
  await expect(page.getByRole('dialog', { name: 'Question editor' })).toBeVisible()
  expect(
    await page.evaluate(
      () =>
        !document.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'p',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        ),
    ),
  ).toBe(true)
  await page.keyboard.press('Escape')

  await openDialog(page)
  await dialogOf(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(exportButton).toBeFocused()

  await openDialog(page)
  await page.locator('.dialog-backdrop').click({ position: { x: 5, y: 5 } })
  await expect(exportButton).toBeFocused()
})
