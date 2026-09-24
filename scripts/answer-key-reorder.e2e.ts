// Reordering the test from its answer key, in a real browser.
//
// The key is the whole exam a few lines a page, so it is where a teacher puts
// questions in order fastest. A line lifted off the key moves its question on
// the test — within its own Question Section, a matching set whole, and a
// selection together — exactly as a question lifted off the test does.

import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedAuthoringState } from './seed-authoring'

const choice = (id: string, correct: boolean) => ({
  type: 'multipleChoiceChoice',
  attrs: { correct, id },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }],
})

/** A Multiple Choice question whose correct answer is `correct`, so the key
 *  line it prints can be told apart from its neighbours'. */
const multipleChoice = (id: string, correct: 'a' | 'b' | 'c' | 'd') => ({
  id,
  type: 'multiple-choice',
  columns: 1,
  doc: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: `Question ${id}` }] },
      {
        type: 'multipleChoice',
        content: (['a', 'b', 'c', 'd'] as const).map((letter) =>
          choice(`${id}-${letter}`, letter === correct)),
      },
    ],
  },
})

const matching = (id: string) => ({
  id,
  type: 'matching',
  columns: 1,
  doc: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: `Question ${id}` }] },
      {
        type: 'matching',
        content: [
          ...[1, 2].map((index) => ({
            type: 'matchingPrompt',
            attrs: { id: `${id}-p${index}`, answer: `${id}-a${index}` },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: `${id} prompt ${index}` }] }],
          })),
          ...[1, 2].map((index) => ({
            type: 'matchingAnswer',
            attrs: { id: `${id}-a${index}` },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: `${id} answer ${index}` }] }],
          })),
        ],
      },
    ],
  },
})

const testQuestions = (page: Page) =>
  page.locator('.exam-question[data-question-id]')
const keyLines = (page: Page) => page.locator('.answer-key-row')

/** Which questions the test prints, in order. */
async function testOrder(page: Page): Promise<string[]> {
  return testQuestions(page).evaluateAll((elements) =>
    [...new Set(elements.map((element) => (element as HTMLElement).dataset.questionId!))])
}

/** Lifts `line` and lets it go just inside `target`'s top or bottom edge. */
async function dragLine(page: Page, line: Locator, target: Locator, edge: 'top' | 'bottom') {
  // The key follows the test, below the fold: bring both ends into view first.
  await target.scrollIntoViewIfNeeded()
  await line.scrollIntoViewIfNeeded()
  const from = (await line.boundingBox())!
  const to = (await target.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  const y = edge === 'top' ? to.y + 2 : to.y + to.height - 2
  await page.mouse.move(to.x + to.width / 2, y, { steps: 10 })
  await page.mouse.up()
}

test('dragging an answer-key line moves its question on the test and in the key', async ({ page }) => {
  await seedAuthoringState(page, {
    questionBank: {
      questions: [multipleChoice('q1', 'a'), multipleChoice('q2', 'b'), multipleChoice('q3', 'c')],
    },
    workingCopy: { title: 'Key reorder', questionIds: ['q1', 'q2', 'q3'] },
    dirty: false,
  })
  await expect(keyLines(page)).toHaveCount(3)
  await expect(keyLines(page).locator('.answer-key-answer')).toHaveText(['A', 'B', 'C'])

  await dragLine(page, keyLines(page).nth(2), keyLines(page).nth(0), 'top')

  await expect.poll(() => testOrder(page)).toEqual(['q3', 'q1', 'q2'])
  await expect(keyLines(page).locator('.answer-key-answer')).toHaveText(['C', 'A', 'B'])
})

test('a selection of answer-key lines moves together', async ({ page }) => {
  await seedAuthoringState(page, {
    questionBank: {
      questions: [multipleChoice('q1', 'a'), multipleChoice('q2', 'b'), multipleChoice('q3', 'c')],
    },
    workingCopy: { title: 'Key reorder', questionIds: ['q1', 'q2', 'q3'] },
    dirty: false,
  })
  await expect(keyLines(page)).toHaveCount(3)

  await keyLines(page).nth(1).click()
  await keyLines(page).nth(2).click({ modifiers: ['Shift'] })
  await dragLine(page, keyLines(page).nth(1), keyLines(page).nth(0), 'top')

  await expect.poll(() => testOrder(page)).toEqual(['q2', 'q3', 'q1'])
})

test('a matching set moves whole, and never into another Question Section', async ({ page }) => {
  await seedAuthoringState(page, {
    questionBank: {
      questions: [multipleChoice('q1', 'a'), matching('m1'), matching('m2')],
    },
    workingCopy: { title: 'Key reorder', questionIds: ['q1', 'm1', 'm2'] },
    dirty: false,
  })
  // One line for the Multiple Choice question, one per prompt for each set.
  await expect(keyLines(page)).toHaveCount(5)

  // m2's second prompt line, dropped above m1's first: the whole of m2 moves.
  await dragLine(page, keyLines(page).nth(4), keyLines(page).nth(1), 'top')
  await expect.poll(() => testOrder(page)).toEqual(['q1', 'm2', 'm1'])
  await expect(keyLines(page)).toHaveCount(5)

  // A matching line let go over the Multiple Choice line changes nothing.
  await dragLine(page, keyLines(page).nth(1), keyLines(page).nth(0), 'top')
  await expect.poll(() => testOrder(page)).toEqual(['q1', 'm2', 'm1'])
})
