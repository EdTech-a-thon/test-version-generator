// Replacing selected Exam Draft questions from the existing context menu.
//
// Matching and atomicity live at the ExamStore seam. This browser check covers
// what only the rendered workspace can prove: selection scope, keyboard access,
// incoming selection, the visible result summary, and Undo from the toolbar.

import { expect, test, type Page } from '@playwright/test'
import { createQuestion, type Difficulty, type Question } from '../src/exam'
import type { AuthoringState } from '../src/exam-store'
import { seedAuthoringState } from './seed-authoring'

function namedQuestion(
  stem: string,
  difficulty: Difficulty,
  topics: string[],
): Question {
  const question = createQuestion('multiple-choice')
  question.doc.content![0] = {
    type: 'paragraph',
    content: [{ type: 'text', text: stem }],
  }
  return { ...question, difficulty, topics }
}

async function seedEquivalentPools(page: Page) {
  const outgoing = [
    namedQuestion('Original cells', 'hard', ['Biology']),
    namedQuestion('Original angles', 'medium', ['Geometry']),
  ]
  const incoming = [
    namedQuestion('Replacement cells', 'hard', ['Biology']),
    namedQuestion('Replacement angles', 'medium', ['Geometry']),
  ]
  const state: AuthoringState = {
    questionBank: { questions: [...outgoing, ...incoming] },
    examDraft: {
      title: 'Equivalent questions',
      questionIds: outgoing.map(({ id }) => id),
    },
    dirty: false,
  }
  await seedAuthoringState(page, state)
  await page.reload()
}

test('keyboard Replace with equivalents acts on the selection, reports it, and undoes once', async ({
  page,
}) => {
  await seedEquivalentPools(page)
  const questions = page.locator('.exam-question')
  await expect(questions).toHaveCount(2)

  await questions.nth(0).click()
  await questions.nth(1).click({ modifiers: ['Control'] })
  await expect(page.locator('.exam-question--selected')).toHaveCount(2)

  const actions = page.getByRole('button', { name: 'Actions for question 1' })
  await actions.focus()
  await actions.press('Enter')
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowUp')
  const replace = page.getByRole('menuitem', { name: 'Replace with equivalents' })
  await expect(replace).toBeFocused()
  await replace.press('Enter')

  await expect(questions.nth(0)).toContainText('Replacement cells')
  await expect(questions.nth(1)).toContainText('Replacement angles')
  const summary = page.getByRole('status')
  await expect(summary).toHaveText('Replaced 2 questions; 0 unmatched.')
  await expect(summary).toBeHidden({ timeout: 5_000 })
  await expect(page.locator('.exam-question--selected')).toHaveCount(2)

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(questions.nth(0)).toContainText('Original cells')
  await expect(questions.nth(1)).toContainText('Original angles')
  await expect(page.locator('.exam-question--selected')).toHaveCount(0)
})

test('opening the menu from an unselected question acts on that question alone', async ({
  page,
}) => {
  await seedEquivalentPools(page)
  const questions = page.locator('.exam-question')
  await questions.nth(0).click()
  await expect(page.locator('.exam-question--selected')).toHaveCount(1)

  await page.getByRole('button', { name: 'Actions for question 2' }).click()
  await page.getByRole('menuitem', { name: 'Replace with equivalents' }).click()

  await expect(questions.nth(0)).toContainText('Original cells')
  await expect(questions.nth(1)).toContainText('Replacement angles')
  await expect(page.getByRole('status')).toHaveText('Replaced 1 question; 0 unmatched.')
  await expect(page.locator('.exam-question--selected')).toHaveCount(1)
  await expect(questions.nth(1)).toHaveClass(/exam-question--selected/)
})
