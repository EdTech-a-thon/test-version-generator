import { expect, test, type Page } from '@playwright/test'

async function seedBanks(page: Page) {
  await page.goto('/about')
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  return page.evaluate(async () => {
    const { createQuestionBankWorkspaceService } = await import(
      /* @vite-ignore */ '/src/question-bank-workspaces.ts'
    ) as typeof import('../src/question-bank-workspaces')
    const ids = ['bank-biology', 'bank-chemistry', 'bank-physics']
    const service = createQuestionBankWorkspaceService({ createId: () => ids.shift()! })
    const biology = await service.create()
    await service.commit(biology.id, { kind: 'rename', name: 'Biology' })
    await service.commit(biology.id, {
      kind: 'create-question',
      question: {
        id: 'question-mitosis', type: 'open', columns: 1, difficulty: 'hard', topics: ['Cells'],
        doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Describe mitosis.' }] }] },
      },
    })
    const chemistry = await service.create()
    await service.commit(chemistry.id, { kind: 'rename', name: 'Chemistry' })
    await service.commit(chemistry.id, {
      kind: 'create-question',
      question: {
        id: 'question-oxygen', type: 'open', columns: 1, difficulty: 'easy', topics: ['Atoms'],
        doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Describe oxygen.' }] }] },
      },
    })
    const physics = await service.create()
    await service.commit(physics.id, { kind: 'rename', name: 'Physics' })
    return { biology: biology.id, chemistry: chemistry.id, physics: physics.id }
  })
}

const bank = (page: Page) => page.getByRole('region', { name: 'Question Bank' })
const search = (page: Page) => page.getByRole('searchbox', { name: 'Search question stems' })

test('a bank launch is consumed into bank-only mode without drag or Exam authoring', async ({ page }) => {
  const ids = await seedBanks(page)
  await page.goto(`/editor?bank=${ids.biology}`)

  await expect(page).toHaveURL(/\/editor$/)
  await expect(page.getByRole('main', { name: 'Bank-only editor' })).toContainText('No Exam open')
  await expect(page.getByRole('button', { name: 'New Exam' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open existing Exam' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Exam name' })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Biology' })).toHaveAttribute('aria-selected', 'true')
  await expect(bank(page)).toContainText('Describe mitosis.')
  await expect(bank(page).getByRole('listitem')).not.toHaveAttribute('data-draggable')
})

test('the bank picker owns focus and restores it when dismissed', async ({ page }) => {
  const ids = await seedBanks(page)
  await page.goto(`/editor?bank=${ids.biology}`)
  const openBank = page.getByRole('button', { name: 'Open Question Bank' })
  await openBank.click()
  const closePicker = page.getByRole('button', { name: 'Close Question Bank picker' })
  await expect(closePicker).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(openBank).toBeFocused()
  await openBank.click()
  await page.getByRole('dialog', { name: 'Open Question Bank' }).getByRole('button', { name: /Chemistry/ }).click()
  const chemistryTab = page.getByRole('tab', { name: 'Chemistry' })
  await expect(chemistryTab).toBeFocused()
  await expect(bank(page)).toContainText('Describe oxygen.')
})

test('bank tabs support Arrow, Home, and End keyboard navigation', async ({ page }) => {
  const ids = await seedBanks(page)
  await page.goto(`/editor?bank=${ids.biology}`)
  await page.getByRole('button', { name: 'Open Question Bank' }).click()
  await page.getByRole('dialog', { name: 'Open Question Bank' }).getByRole('button', { name: /Chemistry/ }).click()

  const chemistryTab = page.getByRole('tab', { name: 'Chemistry' })
  await chemistryTab.press('ArrowLeft')
  const biologyTab = page.getByRole('tab', { name: 'Biology' })
  await expect(biologyTab).toBeFocused()
  await biologyTab.press('End')
  await expect(chemistryTab).toBeFocused()
  await chemistryTab.press('Home')
  await expect(biologyTab).toBeFocused()
  await biologyTab.press('ArrowRight')
  await expect(chemistryTab).toBeFocused()
})

test('search, difficulty, and topic filters remain independent per bank tab', async ({ page }) => {
  const ids = await seedBanks(page)
  await page.goto(`/editor?bank=${ids.biology}`)
  await page.getByRole('button', { name: 'Open Question Bank' }).click()
  await page.getByRole('dialog', { name: 'Open Question Bank' }).getByRole('button', { name: /Chemistry/ }).click()
  const chemistryTab = page.getByRole('tab', { name: 'Chemistry' })
  await search(page).fill('oxygen')

  const biologyTab = page.getByRole('tab', { name: 'Biology' })
  await biologyTab.click()
  await search(page).fill('mitosis')
  await bank(page).getByRole('button', { name: 'Difficulty' }).click()
  await page.getByRole('group', { name: 'Difficulty' }).getByText('Hard').click()
  await bank(page).getByRole('button', { name: 'Topic' }).click()
  await page.getByRole('group', { name: 'Topic' }).getByText('Cells').click()

  await chemistryTab.click()
  await expect(search(page)).toHaveValue('oxygen')
  await biologyTab.click()
  await expect(search(page)).toHaveValue('mitosis')
  await expect(bank(page).getByRole('button', { name: 'Difficulty' })).toContainText('1')
  await expect(bank(page).getByRole('button', { name: 'Topic' })).toContainText('1')
})

test('a bare editor refresh restores open tabs, the active bank, and its filter', async ({ page }) => {
  const ids = await seedBanks(page)
  await page.goto(`/editor?bank=${ids.biology}`)
  await page.getByRole('button', { name: 'Open Question Bank' }).click()
  await page.getByRole('dialog', { name: 'Open Question Bank' }).getByRole('button', { name: /Chemistry/ }).click()
  await expect(page.getByRole('tab', { name: 'Chemistry' })).toHaveAttribute('aria-selected', 'true')
  await search(page).fill('oxygen')
  await page.reload()
  await expect(page).toHaveURL(/\/editor$/)
  await expect(page.getByRole('tab', { name: 'Chemistry' })).toHaveAttribute('aria-selected', 'true')
  await expect(search(page)).toHaveValue('oxygen')

  await expect(page.getByRole('tab', { name: 'Biology' })).toBeVisible()
})

test('tab browsing and closing do not author an Exam', async ({ page }) => {
  const ids = await seedBanks(page)
  await page.goto(`/editor?bank=${ids.biology}`)
  await page.getByRole('button', { name: 'Open Question Bank' }).click()
  await page.getByRole('dialog', { name: 'Open Question Bank' }).getByRole('button', { name: /Chemistry/ }).click()
  await page.getByRole('button', { name: 'Close Chemistry' }).click()
  await expect(page.getByRole('tab', { name: 'Chemistry' })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Biology' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'Close Biology' }).click()
  await expect(page.getByRole('tab')).toHaveCount(0)
  await expect(page.getByText('No Question Bank is open.')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('main', { name: 'Bank-only editor' })).toContainText('No Exam open')

  const exams = await page.evaluate(async () => {
    const { createExamWorkspaceService } = await import(
      /* @vite-ignore */ '/src/exam-workspaces.ts'
    ) as typeof import('../src/exam-workspaces')
    return createExamWorkspaceService().recent()
  })
  expect(exams).toHaveLength(0)
})

test('starting an Exam from bank-only mode carries the visible bank tabs', async ({ page }) => {
  const ids = await seedBanks(page)
  await page.goto(`/editor?bank=${ids.biology}`)
  await page.getByRole('button', { name: 'Open Question Bank' }).click()
  await page.getByRole('dialog', { name: 'Open Question Bank' }).getByRole('button', { name: /Chemistry/ }).click()

  await page.getByRole('button', { name: 'New Exam' }).click()
  await expect(page).toHaveURL(/\/editor$/)
  await expect(page.getByRole('textbox', { name: 'Exam name' })).toHaveValue('Untitled Exam')
  await expect(page.getByRole('tab', { name: 'Biology' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Chemistry' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
})

test('an Exam can browse bank tabs without changing its saved state or Undo', async ({ page }) => {
  await seedBanks(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'New Exam' }).first().click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Export' })).toBeEnabled()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const previewBefore = await page.getByLabel('Export Preview').innerText()
  await expect(page.getByLabel('Export Preview')).not.toContainText('Describe mitosis.')
  await page.getByRole('dialog', { name: 'Export' }).getByRole('button', { name: 'Cancel' }).click()

  await page.getByRole('button', { name: 'Open Question Bank' }).click()
  const picker = page.getByRole('dialog', { name: 'Open Question Bank' })
  await expect(picker).toContainText('Biology')
  await picker.getByRole('button', { name: /Biology/ }).click()
  await expect(picker).toBeHidden()
  await expect(page.getByRole('tab', { name: 'Biology' })).toHaveAttribute('aria-selected', 'true')
  await expect(bank(page)).toContainText('Describe mitosis.')
  await search(page).fill('mitosis')
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Export' })).toBeEnabled()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(page.getByLabel('Export Preview')).toHaveText(previewBefore)
  await expect(page.getByLabel('Export Preview')).not.toContainText('Describe mitosis.')
})

test('closing an Exam bank tab leaves Questions referenced by the Exam unchanged', async ({ page }) => {
  await seedBanks(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'New Exam' }).first().click()
  await page.getByRole('button', { name: 'Insert your first question' }).click()
  await page.getByRole('menuitem', { name: 'Short answer' }).click()
  await page.keyboard.type('A saved Exam question')
  await page.keyboard.press('Control+Enter')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()

  await page.getByRole('button', { name: 'Open Question Bank' }).click()
  const picker = page.getByRole('dialog', { name: 'Open Question Bank' })
  await picker.getByRole('button', { name: /Biology/ }).click()
  await expect(picker).toBeHidden()
  await page.getByRole('button', { name: 'Close Biology' }).click()

  await expect(page.locator('.exam-question')).toContainText('A saved Exam question')
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
})

test('a missing bank launch reports the problem and restores the last valid workspace', async ({ page }) => {
  const ids = await seedBanks(page)
  await page.goto(`/editor?bank=${ids.biology}`)
  await expect(page.getByRole('tab', { name: 'Biology' })).toBeVisible()
  await page.getByRole('button', { name: 'Open Question Bank' }).click()
  await page.getByRole('dialog', { name: 'Open Question Bank' }).getByRole('button', { name: /Chemistry/ }).click()
  await expect(page.getByRole('tab', { name: 'Chemistry' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'Open Question Bank' }).click()
  await page.getByRole('dialog', { name: 'Open Question Bank' }).getByRole('button', { name: /Physics/ }).click()
  await expect(page.getByRole('tab', { name: 'Physics' })).toHaveAttribute('aria-selected', 'true')
  await page.evaluate(async (bankId) => {
    const { QUESTION_BANK_REGISTRY_STORE, VERSIONED_STORAGE_NAME, VERSIONED_STORAGE_VERSION } = await import(
      /* @vite-ignore */ '/src/storage-schema.ts'
    ) as typeof import('../src/storage-schema')
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(VERSIONED_STORAGE_NAME, VERSIONED_STORAGE_VERSION)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const transaction = request.result.transaction(QUESTION_BANK_REGISTRY_STORE, 'readwrite')
        transaction.objectStore(QUESTION_BANK_REGISTRY_STORE).delete(bankId)
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
      }
    })
  }, ids.chemistry)

  await page.goto('/editor?bank=missing-bank')
  await expect(page).toHaveURL(/\/editor$/)
  await expect(page.getByRole('alert')).toHaveText('That Question Bank is unavailable on this device.')
  await expect(page.getByRole('tab')).toHaveText(['Biology', 'Physics'])
  await expect(page.getByRole('tab', { name: 'Physics' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: 'Chemistry' })).toHaveCount(0)
})
