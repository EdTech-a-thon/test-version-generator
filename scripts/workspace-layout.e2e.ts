// The shape of the authoring workspace, in a real browser.
//
// Geometry is the claim here, so it is measured rather than asserted by role:
// that the two panes open at an even split, that the divider moves, that the
// bank gets out of the way when the sheet needs the room — and, throughout, that
// the sheet is still a sheet. The paper keeps the exact size `export-plan.ts`
// packed against; a pane too narrow for it scrolls, because a page scaled to fit
// would be showing a layout the printer will not produce.

import { expect, test, type Page } from '@playwright/test'
import { seedAuthoringState } from './seed-authoring'
import { PAGE_WIDTH } from '../src/export-plan'
import type { Question } from '../src/exam'

const QUESTIONS: Question[] = [
  {
    id: 'q1',
    type: 'open',
    columns: 'auto',
    doc: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Explain osmosis' }] }],
    },
  },
]

const workspace = (page: Page) => page.locator('.authoring-workspace')
const bank = (page: Page) => page.getByRole('region', { name: 'Question Bank' })
const sheet = (page: Page) => page.locator('.exam-page').first()
const divider = (page: Page) => page.getByRole('separator', { name: 'Resize the Question Bank' })
const hideBank = (page: Page) => page.getByRole('button', { name: 'Hide the Question Bank' })
const showBank = (page: Page) => page.getByRole('button', { name: 'Show the Question Bank' })

async function openWorkspace(page: Page) {
  await seedAuthoringState(page, {
    questionBank: { questions: QUESTIONS },
    examDraft: { title: 'Layout', questionIds: ['q1'] },
    dirty: false,
  })
  await page.goto('/')
  await expect(page.locator('.exam-question[data-question-id]')).toHaveCount(1)
}

/** How wide the Question Bank pane is, as a share of the whole workspace. */
async function bankShare(page: Page): Promise<number> {
  const whole = (await workspace(page).boundingBox())!
  const pane = (await bank(page).boundingBox())!
  return pane.width / whole.width
}

test('the workspace opens at an even split and the divider moves it', async ({ page }) => {
  await openWorkspace(page)

  expect(await bankShare(page)).toBeGreaterThan(0.45)
  expect(await bankShare(page)).toBeLessThan(0.55)

  const whole = (await workspace(page).boundingBox())!
  const handle = (await divider(page).boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 200)
  await page.mouse.down()
  await page.mouse.move(whole.x + whole.width * 0.3, handle.y + 200, { steps: 8 })
  await page.mouse.up()

  const narrowed = await bankShare(page)
  expect(narrowed).toBeGreaterThan(0.25)
  expect(narrowed).toBeLessThan(0.35)
  // The paper is not the thing that gave way: it is exactly the sheet the
  // export was packed against, whatever the split does.
  expect(Math.round((await sheet(page).boundingBox())!.width)).toBe(PAGE_WIDTH)
})

test('the divider is resizable from the keyboard', async ({ page }) => {
  await openWorkspace(page)

  await divider(page).focus()
  const before = await bankShare(page)
  for (let press = 0; press < 5; press += 1) await page.keyboard.press('ArrowLeft')

  expect(await bankShare(page)).toBeLessThan(before - 0.1)
  await expect(divider(page)).toHaveAttribute('aria-valuenow', '30')
})

test('a pane too narrow for the sheet scrolls rather than shrinking it', async ({ page }) => {
  await openWorkspace(page)

  // Give the bank most of the workspace, so the Exam Draft pane is narrower
  // than a piece of US Letter paper.
  await divider(page).focus()
  for (let press = 0; press < 8; press += 1) await page.keyboard.press('ArrowRight')

  expect(Math.round((await sheet(page).boundingBox())!.width)).toBe(PAGE_WIDTH)
  const scrolls = await page.locator('.exam-workspace').evaluate(
    (node) => node.scrollWidth > node.clientWidth,
  )
  expect(scrolls).toBe(true)
  // Nothing has been scaled to make it fit.
  const transform = await sheet(page).evaluate((node) => getComputedStyle(node).transform)
  expect(transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)').toBe(true)
})

test('the Question Bank collapses so the paper stays usable, and comes back', async ({ page }) => {
  await openWorkspace(page)

  await hideBank(page).click()

  await expect(bank(page)).toHaveCount(0)
  await expect(showBank(page)).toBeVisible()
  // The sheet keeps its own size; what it gains is room around it.
  expect(Math.round((await sheet(page).boundingBox())!.width)).toBe(PAGE_WIDTH)
  const whole = (await workspace(page).boundingBox())!
  const pane = (await page.locator('.exam-workspace').boundingBox())!
  expect(pane.width).toBeGreaterThan(whole.width * 0.9)

  await showBank(page).click()
  await expect(bank(page)).toBeVisible()
  expect(await bankShare(page)).toBeGreaterThan(0.45)
})

test('a narrow screen opens with the Question Bank out of the way', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 })
  await openWorkspace(page)

  await expect(bank(page)).toHaveCount(0)
  await expect(showBank(page)).toBeVisible()
  expect(Math.round((await sheet(page).boundingBox())!.width)).toBe(PAGE_WIDTH)

  // Available, not imposed: the teacher can still bring the bank back.
  await showBank(page).click()
  await expect(bank(page)).toBeVisible()
})

test('pane width and collapse are transient, not authoring data', async ({ page }) => {
  await openWorkspace(page)
  const undo = page.getByRole('button', { name: 'Undo' })
  await expect(undo).toBeDisabled()

  await divider(page).focus()
  await page.keyboard.press('ArrowLeft')
  await hideBank(page).click()

  // Neither is a change to the exam, so neither is undoable and neither dirties
  // anything.
  await expect(undo).toBeDisabled()

  await page.reload()
  await expect(page.locator('.exam-question[data-question-id]')).toHaveCount(1)
  await expect(bank(page)).toBeVisible()
  expect(await bankShare(page)).toBeGreaterThan(0.45)
  expect(await bankShare(page)).toBeLessThan(0.55)
})

test('focus, selection, the modal and the workspace shortcuts survive the split', async ({ page }) => {
  await openWorkspace(page)

  const question = page.locator('.exam-question[data-question-id]').first()
  await question.click()
  await expect(question).toHaveClass(/exam-question--selected/)
  await page.keyboard.press('Escape')
  await expect(question).not.toHaveClass(/exam-question--selected/)

  await question.dblclick()
  await expect(page.getByRole('dialog', { name: 'Question editor' })).toBeVisible()
  await page.keyboard.type(' now')
  await page.keyboard.press('Control+Enter')
  await expect(page.getByRole('dialog', { name: 'Question editor' })).toBeHidden()
  await expect(question).toContainText('now')

  await page.keyboard.press('Control+z')
  await expect(question).not.toContainText('now')
})

test('narrowing puts the bank away; widening does not argue with the teacher', async ({ page }) => {
  await openWorkspace(page)
  await expect(bank(page)).toBeVisible()

  await page.setViewportSize({ width: 700, height: 900 })
  await expect(showBank(page)).toBeVisible()

  // Brought back by hand on a narrow screen, and left alone when the window
  // grows again: widening is not a request to see the bank.
  await showBank(page).click()
  await expect(bank(page)).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(bank(page)).toBeVisible()

  // And a deliberate collapse survives a window that grows.
  await hideBank(page).click()
  await expect(showBank(page)).toBeVisible()
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(showBank(page)).toBeVisible()
})
