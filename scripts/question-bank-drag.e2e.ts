// Composing an Exam Draft with the pointer, in a real browser.
//
// The drop rule itself is a pure function proven in `src/workspace-drag.test.ts`,
// and what each authoring action does to the Question Bank and the Exam Draft is
// proven at the store. What is proven here is the part only a browser has: that
// a gesture starting in one pane reaches a target in the other, that the three
// zones of a rendered question are where the rule says they are, that an
// incompatible target offers nothing and does nothing, and that a drop is one
// undoable authoring action whose result is selected, revealed and highlighted.

import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedAuthoringState } from './seed-authoring'
import { DRAFT_STORAGE_KEY } from '../src/exam-store'
import type { Question, QuestionType } from '../src/exam'

const choice = (id: string, label: string) => ({
  type: 'multipleChoiceChoice',
  attrs: { correct: id.endsWith('-a'), id },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: label }] }],
})

function question(id: string, stem: string, type: QuestionType): Question {
  const content: Record<string, unknown>[] = [
    { type: 'paragraph', content: [{ type: 'text', text: stem }] },
  ]
  if (type === 'multiple-choice') {
    content.push(
      { type: 'paragraph' },
      {
        type: 'multipleChoice',
        content: [choice(`${id}-a`, 'First'), choice(`${id}-b`, 'Second')],
      },
    )
  }
  return { id, type, columns: 'auto', doc: { type: 'doc', content } }
}

const QUESTIONS: Question[] = [
  question('mc1', 'Cell membranes', 'multiple-choice'),
  question('mc2', 'Enzyme kinetics', 'multiple-choice'),
  question('sa1', 'Explain osmosis', 'open'),
  question('mcSpare', 'Spare choice question', 'multiple-choice'),
  question('saSpare', 'Spare short answer', 'open'),
]

const bank = (page: Page) => page.getByRole('region', { name: 'Question Bank' })
const bankRow = (page: Page, stem: string) =>
  bank(page).getByRole('listitem').filter({ hasText: stem })
// Only real rendered questions: the off-screen measuring host and the drag
// preview both hold `.exam-question` markup, and neither is on the page.
const EXAM_QUESTION = '.exam-question[data-question-id]'
const examQuestions = (page: Page) => page.locator(EXAM_QUESTION)
const rendered = (page: Page, id: string) =>
  page.locator(`.exam-question[data-question-id="${id}"]`)

/** The rendered Exam Draft, in the order it prints. */
async function renderedIds(page: Page): Promise<string[]> {
  return await page.locator(EXAM_QUESTION).evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLElement).dataset.questionId ?? ''),
  )
}

async function openWorkspace(
  page: Page,
  questionIds: string[] = ['mc1', 'mc2', 'sa1'],
) {
  await seedAuthoringState(page, {
    questionBank: { questions: QUESTIONS },
    examDraft: { title: 'Biology quiz', questionIds },
    dirty: false,
  })
  await page.goto('/')
  await expect(examQuestions(page)).toHaveCount(questionIds.length)
}

type Zone = 'top' | 'centre' | 'bottom'

/** A point inside a rendered question, in one of its three drop zones. The
 *  edges are a bounded band, so 4px in is always inside one. */
async function zonePoint(target: Locator, zone: Zone) {
  const box = (await target.boundingBox())!
  return {
    x: box.x + box.width / 2,
    y:
      zone === 'top'
        ? box.y + 4
        : zone === 'bottom'
          ? box.y + box.height - 4
          : box.y + box.height / 2,
  }
}

/** Picks a Question Bank row up and holds it over a point, without releasing. */
async function pickUp(page: Page, stem: string, point: { x: number; y: number }) {
  const box = (await bankRow(page, stem).boundingBox())!
  await page.mouse.move(box.x + 30, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(point.x, point.y, { steps: 10 })
}

/** One whole bank-to-draft gesture, released in the named zone. */
async function dragBankRowOnto(page: Page, stem: string, target: Locator, zone: Zone) {
  await pickUp(page, stem, await zonePoint(target, zone))
  // The target may have moved under the pointer while the preview was picked
  // up; aim once more before releasing so the release point is the tested one.
  const point = await zonePoint(target, zone)
  await page.mouse.move(point.x, point.y)
  await page.mouse.up()
}

test('the bottom edge of a rendered question Inserts after it', async ({ page }) => {
  await openWorkspace(page)

  await dragBankRowOnto(page, 'Spare choice question', rendered(page, 'mc1'), 'bottom')

  await expect(examQuestions(page)).toHaveCount(4)
  expect(await renderedIds(page)).toEqual(['mc1', 'mcSpare', 'mc2', 'sa1'])
  // Referenced, not copied: still five bank records, and the incoming one is
  // marked as being on the exam.
  await expect(bank(page).getByRole('listitem')).toHaveCount(QUESTIONS.length)
  await expect(bankRow(page, 'Spare choice question')).toContainText('In exam')
})

test('the top edge of a rendered question Inserts before it', async ({ page }) => {
  await openWorkspace(page)

  await dragBankRowOnto(page, 'Spare choice question', rendered(page, 'mc1'), 'top')

  // The first position in a Question Section: the one no "after" can name.
  expect(await renderedIds(page)).toEqual(['mcSpare', 'mc1', 'mc2', 'sa1'])
})

test('the centre of a rendered question Replaces it', async ({ page }) => {
  await openWorkspace(page)

  await dragBankRowOnto(page, 'Spare choice question', rendered(page, 'mc2'), 'centre')

  // In the outgoing question's exact place, and the same number of questions.
  expect(await renderedIds(page)).toEqual(['mc1', 'mcSpare', 'sa1'])
  // Replaced out, not deleted: the Question Content is unchanged in the bank
  // and available to compose with again.
  await expect(bank(page).getByRole('listitem')).toHaveCount(QUESTIONS.length)
  await expect(bankRow(page, 'Enzyme kinetics')).not.toContainText('In exam')
  await expect(bankRow(page, 'Enzyme kinetics')).toContainText('Enzyme kinetics')
  await expect(
    bankRow(page, 'Enzyme kinetics').getByRole('button', { name: /to the exam$/ }),
  ).toBeVisible()
})

test('feedback tells insertion, replacement, an invalid target and dragging apart', async ({ page }) => {
  await openWorkspace(page)
  const preview = page.locator('.question-drag-preview')
  const root = page.locator('html')

  await pickUp(page, 'Spare choice question', await zonePoint(rendered(page, 'mc1'), 'top'))

  // Active dragging: a page-owned preview, never the browser's, and the lifted
  // row dimmed in place so it stays findable underneath.
  await expect(preview).toBeVisible()
  await expect(bankRow(page, 'Spare choice question')).toHaveAttribute('data-dragging', 'true')
  await expect(rendered(page, 'mc1')).toHaveAttribute('data-drop', 'before')
  await expect(preview).toHaveAttribute('data-intent-label', 'Insert')

  const centre = await zonePoint(rendered(page, 'mc1'), 'centre')
  await page.mouse.move(centre.x, centre.y)
  await expect(rendered(page, 'mc1')).toHaveAttribute('data-drop', 'replace')
  await expect(preview).toHaveAttribute('data-intent-label', 'Replace')

  const bottom = await zonePoint(rendered(page, 'mc1'), 'bottom')
  await page.mouse.move(bottom.x, bottom.y)
  await expect(rendered(page, 'mc1')).toHaveAttribute('data-drop', 'after')

  // A Short Answer position is in another Question Section, so it exposes no
  // active drop state at all; the cursor is what says the gesture cannot land.
  const wrongSection = await zonePoint(rendered(page, 'sa1'), 'centre')
  await page.mouse.move(wrongSection.x, wrongSection.y)
  await expect(page.locator(`${EXAM_QUESTION}[data-drop]`)).toHaveCount(0)
  await expect(root).toHaveAttribute('data-drag-intent', 'none')
  await expect(preview).toHaveAttribute('data-intent-label', '')
  expect(
    await rendered(page, 'sa1').evaluate((node) => getComputedStyle(node).cursor),
  ).toBe('no-drop')

  // Releasing there changes nothing at all — not the exam, and not the history.
  await page.mouse.up()
  expect(await renderedIds(page)).toEqual(['mc1', 'mc2', 'sa1'])
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
  await expect(preview).toHaveCount(0)
})

test('a Question Bank question already on the exam offers no gesture', async ({ page }) => {
  await openWorkspace(page)

  // A reference occurs at most once, so the row that is on the exam is not a
  // drag source: pressing and moving it selects it and nothing more.
  await expect(bankRow(page, 'Cell membranes')).not.toHaveAttribute('data-draggable', 'true')
  await expect(bankRow(page, 'Spare choice question')).toHaveAttribute('data-draggable', 'true')

  await pickUp(page, 'Cell membranes', await zonePoint(rendered(page, 'mc2'), 'centre'))
  await expect(page.locator('.question-drag-preview')).toHaveCount(0)
  await page.mouse.up()

  expect(await renderedIds(page)).toEqual(['mc1', 'mc2', 'sa1'])
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
})

const emptySectionOffer = (page: Page) => page.locator('.exam-draft-empty-section')

test('an empty Question Section offers a first-question drop target', async ({ page }) => {
  // Multiple Choice questions only: the Short Answer section is not drawn on
  // the sheet at all, because a section is derived from the questions in it.
  await openWorkspace(page, ['mc1', 'mc2'])
  await expect(emptySectionOffer(page)).toHaveCount(0)

  const box = (await bankRow(page, 'Spare short answer').boundingBox())!
  await page.mouse.move(box.x + 30, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 200, box.y + 60, { steps: 6 })

  await expect(emptySectionOffer(page)).toContainText('Drop to add the first question')
  const offer = (await emptySectionOffer(page).boundingBox())!
  await page.mouse.move(offer.x + offer.width / 2, offer.y + offer.height / 2, { steps: 6 })
  await expect(emptySectionOffer(page)).toHaveAttribute('data-active', 'true')
  await page.mouse.up()

  expect(await renderedIds(page)).toEqual(['mc1', 'mc2', 'saSpare'])
  // The offer is gone with the gesture, and the section it opened is now drawn.
  await expect(emptySectionOffer(page)).toHaveCount(0)
})

test('an empty Exam Draft offers its placeholder as the first-question drop target', async ({ page }) => {
  await openWorkspace(page, [])

  // A blank sheet already draws where the first question goes, so that is what
  // a gesture aims at — not a second offer pinned somewhere else.
  const placeholder = page.getByRole('button', { name: 'Insert your first question' })
  await expect(placeholder).toBeVisible()
  await expect(emptySectionOffer(page)).toHaveCount(0)

  const box = (await bankRow(page, 'Spare choice question').boundingBox())!
  await page.mouse.move(box.x + 30, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 200, box.y + 60, { steps: 6 })

  const offer = (await placeholder.boundingBox())!
  await page.mouse.move(offer.x + offer.width / 2, offer.y + offer.height / 2, { steps: 6 })
  await expect(placeholder).toHaveAttribute('data-active', 'true')
  await page.mouse.up()

  expect(await renderedIds(page)).toEqual(['mcSpare'])
  // Its job done, the placeholder is gone.
  await expect(placeholder).toHaveCount(0)
})

test('a bank-to-draft drop is exactly one undoable action, and redoes', async ({ page }) => {
  await openWorkspace(page)
  const undo = page.getByRole('button', { name: 'Undo' })
  await expect(undo).toBeDisabled()

  await dragBankRowOnto(page, 'Spare choice question', rendered(page, 'mc1'), 'bottom')
  expect(await renderedIds(page)).toEqual(['mc1', 'mcSpare', 'mc2', 'sa1'])

  await page.keyboard.press('Control+z')
  expect(await renderedIds(page)).toEqual(['mc1', 'mc2', 'sa1'])
  // One gesture, one step: a second undo has nothing of this drop left to take.
  await expect(undo).toBeDisabled()

  await page.keyboard.press('Control+Shift+z')
  expect(await renderedIds(page)).toEqual(['mc1', 'mcSpare', 'mc2', 'sa1'])
})

test('dragging inside the Exam Draft reorders and never Replaces', async ({ page }) => {
  await openWorkspace(page)

  const target = rendered(page, 'mc2')
  const box = (await rendered(page, 'mc1').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  const centre = await zonePoint(target, 'centre')
  await page.mouse.move(centre.x, centre.y, { steps: 10 })

  // The source pane is what gives the gesture its meaning: from within the Exam
  // Draft the centre of a question is a placement like any other, so there is
  // no Replace anywhere on it.
  await expect(target).toHaveAttribute('data-drop', 'after')
  await expect(page.locator(`${EXAM_QUESTION}[data-drop="replace"]`)).toHaveCount(0)
  await page.mouse.up()

  expect(await renderedIds(page)).toEqual(['mc2', 'mc1', 'sa1'])
  // A reorder, not a composition: the same three questions on the exam.
  await expect(bank(page).getByText('In exam')).toHaveCount(3)
})

test('a reordering drag stays inside its own Question Section', async ({ page }) => {
  await openWorkspace(page)

  const box = (await rendered(page, 'mc1').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  const shortAnswer = await zonePoint(rendered(page, 'sa1'), 'centre')
  await page.mouse.move(shortAnswer.x, shortAnswer.y, { steps: 10 })

  await expect(page.locator(`${EXAM_QUESTION}[data-drop]`)).toHaveCount(0)
  await page.mouse.up()

  expect(await renderedIds(page)).toEqual(['mc1', 'mc2', 'sa1'])
})

/** The whole authoring state, as the application persisted it: the Question
 *  Bank, the Exam Draft's membership and order, and nothing about the pointer.
 *  Two paths that yield this yield the same exam. */
async function authoringState(page: Page) {
  return await page.evaluate(
    (key: string) => JSON.parse(localStorage.getItem(key) ?? 'null') as unknown,
    DRAFT_STORAGE_KEY,
  )
}

/** The row's Insert button, offered only while a compatible Exam Draft
 *  question is selected. */
const insertAfter = (page: Page, stem: string) =>
  bankRow(page, stem).getByRole('button', { name: /after the selected question$/ })

/** The row's Replace button, offered on the same terms. */
const replaceSelected = (page: Page, stem: string) =>
  bankRow(page, stem).getByRole('button', { name: /^Replace the selected question/ })

test('the pointer and the action menu compose the same Exam Draft', async ({ page }) => {
  await openWorkspace(page)
  await dragBankRowOnto(page, 'Spare choice question', rendered(page, 'mc1'), 'bottom')
  expect(await renderedIds(page)).toEqual(['mc1', 'mcSpare', 'mc2', 'sa1'])
  const byPointer = await authoringState(page)

  await openWorkspace(page)
  await rendered(page, 'mc1').click()
  await insertAfter(page, 'Spare choice question').click()
  await expect(examQuestions(page)).toHaveCount(4)

  expect(await authoringState(page)).toEqual(byPointer)
})

test('the pointer and the action menu Replace identically', async ({ page }) => {
  await openWorkspace(page)
  await dragBankRowOnto(page, 'Spare choice question', rendered(page, 'mc2'), 'centre')
  expect(await renderedIds(page)).toEqual(['mc1', 'mcSpare', 'sa1'])
  const byPointer = await authoringState(page)

  await openWorkspace(page)
  await rendered(page, 'mc2').click()
  await replaceSelected(page, 'Spare choice question').click()
  await expect(bankRow(page, 'Spare choice question')).toContainText('In exam')

  expect(await authoringState(page)).toEqual(byPointer)
})

test('a composed question is selected, revealed after repagination and highlighted', async ({ page }) => {
  // Enough questions for the exam to run past one screen, so the incoming one
  // genuinely has to be brought into view rather than happening to be there.
  const many: Question[] = [
    ...Array.from({ length: 14 }, (_, index) =>
      question(`l${index}`, `Long question ${index}`, 'multiple-choice'),
    ),
    question('lSpare', 'The spare one', 'multiple-choice'),
  ]
  await seedAuthoringState(page, {
    questionBank: { questions: many },
    examDraft: {
      title: 'A long exam',
      questionIds: many.slice(0, 14).map((item) => item.id),
    },
    dirty: false,
  })
  await page.goto('/')
  await expect(examQuestions(page)).toHaveCount(14)

  // Compose against the last question, then look away from it entirely.
  await rendered(page, 'l13').click()
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(rendered(page, 'l13')).not.toBeInViewport()

  await insertAfter(page, 'The spare one').click()

  // Repagination waits for content to settle, so the question is not on a page
  // in the frame the action was taken. It is scrolled to once it is.
  await expect(rendered(page, 'lSpare')).toBeInViewport()
  await expect(rendered(page, 'lSpare')).toHaveClass(/exam-question--selected/)
  // And marked, briefly, so it can be found on a page that has just reflowed.
  await expect(rendered(page, 'lSpare')).toHaveClass(/exam-question--revealed/)
})

test('a row still selects on click after another row has been dragged', async ({ page }) => {
  await openWorkspace(page)

  await dragBankRowOnto(page, 'Spare choice question', rendered(page, 'mc1'), 'bottom')

  // The press that finished a drag is not a click, but that is true of one
  // press on one row — not of every click that follows it anywhere in the bank.
  await bankRow(page, 'Explain osmosis').click()
  await expect(bankRow(page, 'Explain osmosis')).toHaveAttribute('aria-current', 'true')
})
