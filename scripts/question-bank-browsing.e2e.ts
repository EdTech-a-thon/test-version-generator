// Browsing and composing from the Question Bank, in a real browser.
//
// The projection, the search and the filter algebra are proven as pure rules in
// the unit suite. What is proven here is what only a browser can show: what a
// compact row actually says, that a click selects while a double-click or Enter
// opens the popup, that the filter controls narrow the bank the way the rules
// say, and that the keyboard composition path puts a bank question onto the
// Exam Draft through the same authoring operations as everything else.

import { expect, test, type Page } from '@playwright/test'
import { seedAuthoringState } from './seed-authoring'
import type { Question, QuestionType } from '../src/exam'

const choice = (id: string, label: string) => ({
  type: 'multipleChoiceChoice',
  attrs: { correct: id.endsWith('-a'), id },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: label }] }],
})

function question(
  id: string,
  stem: string,
  extra: Partial<Question> & { choices?: string[] } = {},
): Question {
  const { choices, ...rest } = extra
  const content: Record<string, unknown>[] = [
    { type: 'paragraph', content: [{ type: 'text', text: stem }] },
  ]
  if (choices) {
    content.push(
      { type: 'paragraph' },
      {
        type: 'multipleChoice',
        content: choices.map((label, index) =>
          choice(`${id}-${'abcd'[index]}`, label),
        ),
      },
    )
  }
  return {
    id,
    type: (choices ? 'multiple-choice' : 'open') as QuestionType,
    columns: 'auto',
    doc: { type: 'doc', content },
    ...rest,
  }
}

// One bank with something of every kind in it, so a single fixture can carry
// the projection, the filters and the composition tests.
const QUESTIONS: Question[] = [
  question('q1', 'Photosynthesis in leaves', {
    difficulty: 'easy',
    topics: ['Biology'],
    choices: ['Chlorophyll', 'Keratin'],
  }),
  question('q2', 'Mitosis and meiosis', {
    difficulty: 'hard',
    topics: ['Cell division'],
  }),
  question('q3', 'Photosynthesis at night', {
    topics: ['Biology', 'Plants'],
    choices: ['Nothing happens', 'It reverses'],
  }),
  question('q4', 'Read the graph', {
    difficulty: 'medium',
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Read the graph, then evaluate ' },
            { type: 'math_inline', attrs: { value: 'PV = nRT' } },
          ],
        },
        { type: 'image-block', attrs: { src: '/local-images/graph.png' } },
      ],
    },
  }),
]

const bank = (page: Page) => page.getByRole('region', { name: 'Question Bank' })
const rows = (page: Page) => bank(page).getByRole('listitem')
const row = (page: Page, stem: string) =>
  bank(page).getByRole('listitem').filter({ hasText: stem })
const search = (page: Page) =>
  page.getByRole('searchbox', { name: 'Search question stems' })
const examQuestions = (page: Page) => page.locator('.exam-question')
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Question editor' })

async function openBank(page: Page, questionIds: string[] = ['q1', 'q2']) {
  await seedAuthoringState(page, {
    questionBank: { questions: QUESTIONS },
    examDraft: { title: 'Biology quiz', questionIds },
    dirty: false,
  })
  await page.goto('/')
  await expect(rows(page)).toHaveCount(QUESTIONS.length)
}

/** The row's Insert button, offered only while a compatible Exam Draft
 *  question is selected. */
const insertAfter = (page: Page, stem: string) =>
  row(page, stem).getByRole('button', { name: /after the selected question$/ })

/** The row's Replace button, offered on the same terms. */
const replaceSelected = (page: Page, stem: string) =>
  row(page, stem).getByRole('button', { name: /^Replace the selected question/ })

/** Chooses values in one of the bank's filter dropdowns. */
async function filterBy(page: Page, category: string, ...values: string[]) {
  await bank(page).getByRole('button', { name: category, exact: true }).click()
  for (const value of values) {
    await page.getByRole('checkbox', { name: value, exact: true }).check()
  }
  await page.keyboard.press('Escape')
}

test('a compact row shows the stem, its classification and nothing hidden', async ({ page }) => {
  await openBank(page)

  // Newest first, and filtering never gets to rewrite that.
  await expect(rows(page).nth(0)).toContainText('Read the graph')
  await expect(rows(page).nth(3)).toContainText('Photosynthesis in leaves')

  const leaves = row(page, 'Photosynthesis in leaves')
  await expect(leaves).toContainText('Multiple choice')
  await expect(leaves).toContainText('Easy')
  await expect(leaves).toContainText('Biology')
  await expect(leaves).toContainText('In exam')
  // Answer choices and their correctness stay behind the popup.
  await expect(bank(page)).not.toContainText('Chlorophyll')
  await expect(bank(page)).not.toContainText('Keratin')

  // Content a single line cannot carry is a badge instead.
  const graph = row(page, 'Read the graph')
  await expect(graph).toContainText('Math')
  await expect(graph).toContainText('Image')
  await expect(graph).not.toContainText('nRT')
  await expect(graph).toContainText('Short answer')
})

test('a click selects a row while a double-click, Enter or Edit opens the popup', async ({ page }) => {
  await openBank(page)

  await row(page, 'Mitosis and meiosis').click()
  await expect(row(page, 'Mitosis and meiosis')).toHaveAttribute('aria-current', 'true')
  await expect(dialog(page)).toBeHidden()

  await row(page, 'Mitosis and meiosis').dblclick()
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page)).toContainText('Mitosis and meiosis')
  await page.getByRole('button', { name: 'Cancel' }).click()

  await row(page, 'Photosynthesis at night').focus()
  await page.keyboard.press('Enter')
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page)).toContainText('Photosynthesis at night')
  await page.getByRole('button', { name: 'Cancel' }).click()

  await row(page, 'Read the graph').getByRole('button', { name: /^Edit / }).click()
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page)).toContainText('Read the graph')
})

test('search matches stems only, and clearing it restores the bank', async ({ page }) => {
  await openBank(page)

  await search(page).fill('PHOTOSYNTHESIS')
  await expect(rows(page)).toHaveCount(2)
  await expect(rows(page).nth(0)).toContainText('Photosynthesis at night')
  await expect(rows(page).nth(1)).toContainText('Photosynthesis in leaves')

  // An answer choice is not the stem, so it is not searched.
  await search(page).fill('Chlorophyll')
  await expect(rows(page)).toHaveCount(0)
  await expect(bank(page)).toContainText('No questions match')

  await bank(page).getByRole('button', { name: 'Clear filters' }).click()
  await expect(search(page)).toHaveValue('')
  await expect(rows(page)).toHaveCount(QUESTIONS.length)
  await expect(rows(page).nth(0)).toContainText('Read the graph')
})

test('filter values combine with OR inside a category and AND across them', async ({ page }) => {
  await openBank(page)

  await filterBy(page, 'Difficulty', 'Easy', 'Hard')
  await expect(rows(page)).toHaveCount(2)
  await expect(rows(page).nth(0)).toContainText('Mitosis and meiosis')
  await expect(rows(page).nth(1)).toContainText('Photosynthesis in leaves')

  await filterBy(page, 'Question Type', 'Multiple choice')
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).nth(0)).toContainText('Photosynthesis in leaves')

  await bank(page).getByRole('button', { name: 'Clear filters' }).click()
  await filterBy(page, 'Difficulty', 'Unspecified')
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).nth(0)).toContainText('Photosynthesis at night')

  await bank(page).getByRole('button', { name: 'Clear filters' }).click()
  await filterBy(page, 'Topic', 'Plants')
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).nth(0)).toContainText('Photosynthesis at night')

  await bank(page).getByRole('button', { name: 'Clear filters' }).click()
  await search(page).fill('photosynthesis')
  await filterBy(page, 'Topic', 'Cell division')
  await expect(rows(page)).toHaveCount(0)
})

test('browsing the Question Bank is not an authoring action', async ({ page }) => {
  await openBank(page)
  const undo = page.getByRole('button', { name: 'Undo' })
  await expect(undo).toBeDisabled()

  await search(page).fill('photosynthesis')
  await filterBy(page, 'Topic', 'Biology')
  await row(page, 'Photosynthesis at night').click()

  // Nothing to undo: search, filters and row selection are transient UI state.
  await expect(undo).toBeDisabled()

  // And they are not remembered, because they were never authoring data.
  await page.reload()
  await expect(rows(page)).toHaveCount(QUESTIONS.length)
  await expect(search(page)).toHaveValue('')
})

test('an empty Question Bank reads differently from one nothing matches', async ({ page }) => {
  await page.goto('/')
  await expect(bank(page)).toContainText('No questions yet')

  await openBank(page)
  await search(page).fill('nothing whatsoever')
  await expect(bank(page)).toContainText('No questions match')
  await expect(bank(page)).not.toContainText('No questions yet')
})

test('a selected bank question is inserted after a selected Exam Draft question', async ({ page }) => {
  await openBank(page)
  await expect(examQuestions(page)).toHaveCount(2)

  // q1 is the Multiple Choice question on the exam; q3 is an unused one.
  await examQuestions(page).first().click()
  await insertAfter(page, 'Photosynthesis at night').click()

  await expect(examQuestions(page)).toHaveCount(3)
  await expect(examQuestions(page).nth(0)).toContainText('Photosynthesis in leaves')
  await expect(examQuestions(page).nth(1)).toContainText('Photosynthesis at night')
  // Referenced, not copied: still four bank records, and no second way to add.
  await expect(rows(page)).toHaveCount(QUESTIONS.length)
  await expect(row(page, 'Photosynthesis at night')).toContainText('In exam')
  await expect(
    row(page, 'Photosynthesis at night').getByRole('button', { name: /to the exam$/ }),
  ).toHaveCount(0)

  await page.keyboard.press('Control+z')
  await expect(examQuestions(page)).toHaveCount(2)
})

test('a selected bank question replaces a selected Exam Draft question', async ({ page }) => {
  await openBank(page)

  await examQuestions(page).first().click()
  await replaceSelected(page, 'Photosynthesis at night').click()

  await expect(examQuestions(page)).toHaveCount(2)
  await expect(examQuestions(page).nth(0)).toContainText('Photosynthesis at night')
  // Replaced out, not deleted: the question is back in the bank, unchanged and
  // available to compose with again.
  await expect(rows(page)).toHaveCount(QUESTIONS.length)
  await expect(row(page, 'Photosynthesis in leaves')).not.toContainText('In exam')
  await expect(
    row(page, 'Photosynthesis in leaves').getByRole('button', { name: /to the exam$/ }),
  ).toBeVisible()

  await page.keyboard.press('Control+z')
  await expect(examQuestions(page).nth(0)).toContainText('Photosynthesis in leaves')
})

test('composition stops being offered once its target leaves the Exam Draft', async ({ page }) => {
  await openBank(page)

  await examQuestions(page).first().click()
  await insertAfter(page, 'Photosynthesis at night').click()
  await expect(examQuestions(page)).toHaveCount(3)

  await page.keyboard.press('Control+z')
  await expect(examQuestions(page)).toHaveCount(2)

  // Undo took the incoming question back off the exam. A selection outlives it,
  // but a question that is not on the Exam Draft names no position on it, so
  // there is nothing to compose against.
  await expect(insertAfter(page, 'Photosynthesis at night')).toHaveCount(0)
  await expect(replaceSelected(page, 'Photosynthesis at night')).toHaveCount(0)
})

test('composition is not offered across Question Sections or for a question already on the exam', async ({ page }) => {
  await openBank(page)

  // A Multiple Choice question is selected on the exam, so a Short Answer bank
  // question offers no way to reach it.
  await examQuestions(page).first().click()
  await expect(insertAfter(page, 'Mitosis and meiosis')).toHaveCount(0)
  await expect(replaceSelected(page, 'Mitosis and meiosis')).toHaveCount(0)

  // Nor does a question already on the Exam Draft: a reference occurs once.
  await expect(insertAfter(page, 'Photosynthesis in leaves')).toHaveCount(0)
  await expect(replaceSelected(page, 'Photosynthesis in leaves')).toHaveCount(0)
})
