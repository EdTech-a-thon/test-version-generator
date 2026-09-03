import { describe, expect, test } from 'bun:test'
import {
  CHOICE_AREA_WIDTH,
  FOOTER_HEIGHT,
  HEADER_HEIGHT,
  PAGE_CONTENT_WIDTH,
  PAGE_HEIGHT,
  PAGE_MARGIN,
  PAGE_WIDTH,
  SECTION_INSTRUCTIONS,
  SECTION_TITLE,
  pageContentHeight,
  isAnswerKeyHeader,
  buildExportDocument,
  planExport,
  unmeasured,
  STUDENT_TEST,
  type ColumnCount,
  type Measure,
  type ExportContentSelection,
  type PlannedPage,
  type PageItem,
  type QuestionItem,
  type PlannedQuestion,
} from './export-plan'
import { DEFAULT_COLUMNS, type Exam, type Question, type Version } from './exam'
import type { ProseMirrorJSON } from './question-doc'

function choice(id: string, correct = false): ProseMirrorJSON {
  return {
    type: 'multipleChoiceChoice',
    attrs: { correct, id },
    content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }],
  }
}

function multipleChoice(
  id: string,
  choiceIds: string[],
  correctId = '',
): Question {
  return {
    id,
    type: 'multiple-choice',
    doc: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: `stem ${id}` }] },
        {
          type: 'multipleChoice',
          content: choiceIds.map((cid) => choice(cid, cid === correctId)),
        },
      ],
    },
    columns: DEFAULT_COLUMNS,
  }
}

function open(id: string): Question {
  return {
    id,
    type: 'open',
    doc: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }],
    },
    columns: DEFAULT_COLUMNS,
  }
}

function examOf(questions: Question[]): Exam {
  return { title: 'Chemistry Unit 3', questions }
}

function versionOf(
  questionOrder: string[] = [],
  choiceOrder: Record<string, string[]> = {},
): Version {
  return { id: 'v1', letter: 'A', questionOrder, choiceOrder }
}

const WHOLE_DOCUMENT: ExportContentSelection = { test: true, answerKey: true }

/** The planner's whole interface, in the shape these tests read it: a plan's
 *  pages for one version, with both documents selected. */
function planPages(
  exam: Exam,
  version: Version,
  measure: Measure,
): PlannedPage[] {
  return planExport({ exam, version, selection: WHOLE_DOCUMENT, measure }).pages
}

function render(exam: Exam, version: Version = versionOf()): PlannedPage[] {
  return testPages(planPages(exam, version, unmeasured))
}

function testPages(pages: PlannedPage[]): PlannedPage[] {
  return pages.filter((page) => !isAnswerKeyHeader(page.header))
}

function itemsOf(pages: PlannedPage[]): PageItem[] {
  return pages.flatMap((page) => page.items)
}

function headings(pages: PlannedPage[]): PageItem[] {
  return itemsOf(pages).filter((item) => item.kind === 'section-heading')
}

function plannedQuestions(pages: PlannedPage[]): PlannedQuestion[] {
  return itemsOf(pages).flatMap((item) =>
    item.kind === 'question' ? [item.question] : [],
  )
}

/** The grid read row by row, with an empty cell written as a dash. */
function gridRows(question: PlannedQuestion): string[][] {
  return (question.grid?.cells ?? []).map((row) =>
    row.map((cell) => (cell ? `${cell.letter}${cell.id}` : '-')),
  )
}

describe('pages', () => {
  test('an exam that fits renders as a single first page', () => {
    const pages = render(examOf([multipleChoice('q1', ['a', 'b'])]))
    expect(pages).toHaveLength(1)
    expect(pages[0]!.number).toBe(1)
    expect(pages[0]!.header).toBe('first')
  })

  test('an empty exam still renders a blank page', () => {
    const pages = render(examOf([]))
    expect(pages).toHaveLength(1)
    expect(headings(pages)).toHaveLength(0)
    expect(itemsOf(pages)).toEqual([])
  })

  test('rendering leaves the exam and the version untouched', () => {
    const exam = examOf([multipleChoice('q1', ['a', 'b']), open('q2')])
    const version = versionOf(['q2', 'q1'], { q1: ['b', 'a'] })
    const before = JSON.stringify({ exam, version })
    render(exam, version)
    expect(JSON.stringify({ exam, version })).toBe(before)
  })
})

describe('sections', () => {
  test('are derived from question type in fixed order, whatever the ordering says', () => {
    const exam = examOf([open('q1'), multipleChoice('q2', ['a', 'b'])])
    const pages = render(exam, versionOf(['q1', 'q2']))
    expect(headings(pages)).toEqual([
      {
        kind: 'section-heading',
        section: 'multiple-choice',
        title: 'Multiple Choice',
        instructions: SECTION_INSTRUCTIONS['multiple-choice'],
        keepWithNext: true,
      },
      {
        kind: 'section-heading',
        section: 'open',
        title: 'Short Answer',
        instructions: SECTION_INSTRUCTIONS.open,
        keepWithNext: true,
      },
    ])
  })

  test('carry a hardcoded instruction line', () => {
    const pages = render(examOf([multipleChoice('q1', ['a', 'b'])]))
    const [heading] = headings(pages)
    expect(heading).toMatchObject({
      title: SECTION_TITLE['multiple-choice'],
      instructions: expect.any(String),
    })
    expect(SECTION_INSTRUCTIONS['multiple-choice'].length).toBeGreaterThan(0)
    expect(SECTION_INSTRUCTIONS.open.length).toBeGreaterThan(0)
  })

  test('a section with no questions is omitted, heading and all', () => {
    const pages = render(examOf([multipleChoice('q1', ['a', 'b'])]))
    expect(headings(pages)).toHaveLength(1)
    expect(headings(pages)[0]).toMatchObject({ section: 'multiple-choice' })
  })

  test('the printable item stream contains no editing-only insertion controls', () => {
    const pages = render(examOf([multipleChoice('q1', ['a', 'b']), open('q2')]))
    expect(itemsOf(pages).map((item) => item.kind)).toEqual([
      'section-heading',
      'question',
      'section-heading',
      'question',
    ])
  })
})

describe('questions', () => {
  test('are numbered continuously across sections', () => {
    const exam = examOf([
      open('o1'),
      multipleChoice('m1', ['a', 'b']),
      open('o2'),
      multipleChoice('m2', ['c', 'd']),
    ])
    const rendered = plannedQuestions(render(exam))
    expect(rendered.map((question) => [question.id, question.number])).toEqual([
      ['m1', 1],
      ['m2', 2],
      ['o1', 3],
      ['o2', 4],
    ])
  })

  test('appear in the order the version puts them in, within their section', () => {
    const exam = examOf([
      multipleChoice('m1', ['a', 'b']),
      multipleChoice('m2', ['c', 'd']),
      open('o1'),
    ])
    const rendered = plannedQuestions(render(exam, versionOf(['m2', 'o1', 'm1'])))
    expect(rendered.map((question) => question.id)).toEqual(['m2', 'm1', 'o1'])
    expect(rendered.map((question) => question.number)).toEqual([1, 2, 3])
  })

  test('multiple choice is prefixed with an answer blank; short answer is not', () => {
    const exam = examOf([multipleChoice('m1', ['a', 'b']), open('o1')])
    const rendered = plannedQuestions(render(exam))
    expect(rendered.map((question) => question.answerBlank)).toEqual([true, false])
  })

  test('the stem is the question document without its choice list', () => {
    const rendered = plannedQuestions(render(examOf([multipleChoice('m1', ['a', 'b'])])))
    expect(rendered[0]!.stem).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'stem m1' }] },
    ])
  })

  test('ignores the single trailing blank paragraph before multiple-choice answers', () => {
    const question = multipleChoice('m1', ['a', 'b'])
    const choiceList = (question.doc.content as ProseMirrorJSON[]).at(-1)!
    question.doc.content = [
      { type: 'paragraph', content: [{ type: 'text', text: 'Question' }] },
      { type: 'paragraph' },
      choiceList,
    ]

    const [rendered] = plannedQuestions(render(examOf([question])))
    expect(rendered!.stem).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Question' }] },
    ])
  })

  test('preserves additional blank paragraphs the teacher added before the answers', () => {
    const question = multipleChoice('m1', ['a', 'b'])
    const choiceList = (question.doc.content as ProseMirrorJSON[]).at(-1)!
    question.doc.content = [
      { type: 'paragraph', content: [{ type: 'text', text: 'Question' }] },
      { type: 'paragraph' },
      { type: 'paragraph' },
      choiceList,
    ]

    const [rendered] = plannedQuestions(render(examOf([question])))
    expect(rendered!.stem).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Question' }] },
      { type: 'paragraph' },
    ])
  })

  test('a short-answer question has no choices and no grid', () => {
    const rendered = plannedQuestions(render(examOf([open('o1')])))
    expect(rendered[0]!.choices).toEqual([])
    expect(rendered[0]!.grid).toBeNull()
  })
})

describe('choice letters', () => {
  test('follow the version ordering rather than authoring order', () => {
    const exam = examOf([multipleChoice('m1', ['a', 'b', 'c', 'd'], 'a')])
    const version = versionOf(['m1'], { m1: ['c', 'd', 'a', 'b'] })
    const [question] = plannedQuestions(render(exam, version))
    expect(question!.choices.map((c) => [c.letter, c.id])).toEqual([
      ['A', 'c'],
      ['B', 'd'],
      ['C', 'a'],
      ['D', 'b'],
    ])
  })

  test('the correct answer keeps its letter position, whatever the ordering', () => {
    const exam = examOf([multipleChoice('m1', ['a', 'b', 'c', 'd'], 'a')])
    const version = versionOf(['m1'], { m1: ['c', 'd', 'a', 'b'] })
    const [question] = plannedQuestions(render(exam, version))
    const correct = question!.choices.find((c) => c.correct)
    expect(correct).toMatchObject({ id: 'a', letter: 'C' })
  })

  test('a choice the ordering has never heard of is lettered last', () => {
    const exam = examOf([multipleChoice('m1', ['a', 'b', 'c'])])
    const version = versionOf(['m1'], { m1: ['c', 'gone', 'a'] })
    const [question] = plannedQuestions(render(exam, version))
    expect(question!.choices.map((c) => [c.letter, c.id])).toEqual([
      ['A', 'c'],
      ['B', 'a'],
      ['C', 'b'],
    ])
  })
})

// These tests are about `layOutGrid`'s column-major mechanics, not about
// auto-resolution — each question pins an explicit column count so the
// result doesn't depend on the injected (unmeasured, in this describe block)
// `Measure`.
describe('the choice grid', () => {
  test('fills column-major over ceil(n / 2) rows at two columns', () => {
    const exam = examOf([
      { ...multipleChoice('m1', ['a', 'b', 'c', 'd']), columns: 2 as const },
    ])
    const [question] = plannedQuestions(render(exam))
    expect(question!.grid!.columns).toBe(2)
    expect(question!.grid!.rows).toBe(2)
    expect(gridRows(question!)).toEqual([
      ['Aa', 'Cc'],
      ['Bb', 'Dd'],
    ])
  })

  test('an odd count leaves the last cell of the second column empty', () => {
    const exam = examOf([
      { ...multipleChoice('m1', ['a', 'b', 'c', 'd', 'e']), columns: 2 as const },
    ])
    const [question] = plannedQuestions(render(exam))
    expect(question!.grid!.rows).toBe(3)
    expect(gridRows(question!)).toEqual([
      ['Aa', 'Dd'],
      ['Bb', 'Ee'],
      ['Cc', '-'],
    ])
  })

  test('three choices lay out down the first column first', () => {
    const exam = examOf([{ ...multipleChoice('m1', ['a', 'b', 'c']), columns: 2 as const }])
    const [question] = plannedQuestions(render(exam))
    expect(gridRows(question!)).toEqual([
      ['Aa', 'Cc'],
      ['Bb', '-'],
    ])
  })

  test('two choices sit side by side on one row', () => {
    const exam = examOf([{ ...multipleChoice('m1', ['a', 'b']), columns: 2 as const }])
    const [question] = plannedQuestions(render(exam))
    expect(gridRows(question!)).toEqual([['Aa', 'Bb']])
  })

  test('an explicit column count overrides the automatic one', () => {
    const one = { ...multipleChoice('m1', ['a', 'b', 'c']), columns: 1 as const }
    const four = { ...multipleChoice('m2', ['a', 'b', 'c', 'd', 'e']), columns: 4 as const }
    const [first, second] = plannedQuestions(render(examOf([one, four])))
    expect(gridRows(first!)).toEqual([['Aa'], ['Bb'], ['Cc']])
    expect(second!.grid!.columns).toBe(4)
    expect(second!.grid!.rows).toBe(2)
    expect(gridRows(second!)).toEqual([
      ['Aa', 'Cc', 'Ee', '-'],
      ['Bb', 'Dd', '-', '-'],
    ])
  })

  test('letters carry into the grid in version order', () => {
    const exam = examOf([
      { ...multipleChoice('m1', ['a', 'b', 'c', 'd']), columns: 2 as const },
    ])
    const version = versionOf(['m1'], { m1: ['d', 'c', 'b', 'a'] })
    const [question] = plannedQuestions(render(exam, version))
    expect(gridRows(question!)).toEqual([
      ['Ad', 'Cb'],
      ['Bc', 'Da'],
    ])
  })
})

describe('answer columns', () => {
  function columnsOfPlan(question: Question): ColumnCount {
    const pages = planPages(examOf([question]), versionOf(), unmeasured)
    return plannedQuestions(pages)[0]!.grid!.columns
  }

  for (const columns of [1, 2, 4] as const) {
    test(`a question set to ${columns} is drawn in ${columns}`, () => {
      expect(columnsOfPlan({ ...multipleChoice('m1', ['a', 'b', 'c', 'd']), columns }))
        .toBe(columns)
    })
  }

  test('a stored question whose setting predates the plain count reads as the default', () => {
    // `'auto'` was a fourth setting once: the count was measured rather than
    // chosen. Records written then are still in browsers.
    const legacy = {
      ...multipleChoice('m1', ['a', 'b', 'c', 'd']),
      columns: 'auto' as unknown as Question['columns'],
    }
    expect(columnsOfPlan(legacy)).toBe(DEFAULT_COLUMNS)
  })

  test('the setting survives a content edit', () => {
    const original: Question = { ...multipleChoice('m1', ['a', 'b']), columns: 1 as const }
    const edited: Question = {
      ...original,
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'edited stem' }] },
          {
            type: 'multipleChoice',
            content: ['a', 'b', 'c', 'd'].map((id) => choice(id)),
          },
        ],
      },
    }
    expect(columnsOfPlan(original)).toBe(1)
    expect(columnsOfPlan(edited)).toBe(1)
  })
})

// Packing, driven entirely by stubbed heights: no DOM is involved, and the
// numbers below are chosen against the real content boxes so the assertions
// stay honest if the page furniture is ever resized.
describe('page geometry', () => {
  test('is US Letter at 96dpi with three-quarter-inch margins', () => {
    expect([PAGE_WIDTH, PAGE_HEIGHT]).toEqual([816, 1056])
    expect(PAGE_MARGIN).toBe(72)
    expect(PAGE_CONTENT_WIDTH).toBe(672)
    expect(CHOICE_AREA_WIDTH).toBe(574)
  })

  test('subtracts the header and footer from the content box', () => {
    const box = PAGE_HEIGHT - 2 * PAGE_MARGIN
    expect(pageContentHeight('first')).toBe(box - HEADER_HEIGHT.first - FOOTER_HEIGHT)
    expect(pageContentHeight('later')).toBe(box - HEADER_HEIGHT.later - FOOTER_HEIGHT)
  })

  test('leaves the first page shorter, because its header carries the title too', () => {
    expect(pageContentHeight('first')).toBeLessThan(pageContentHeight('later'))
  })

  test('continuation headers leave extra clearance before page content', () => {
    expect(HEADER_HEIGHT.later).toBe(42)
    expect(HEADER_HEIGHT['answer-key-later']).toBe(42)
  })
})

describe('answer key', () => {
  function keyItems(exam: Exam, version: Version = versionOf()): PageItem[] {
    return planPages(exam, version, unmeasured)
      .filter((page) => isAnswerKeyHeader(page.header))
      .flatMap((page) => page.items)
  }

  test('correct letters follow the current version choice ordering', () => {
    const exam = examOf([multipleChoice('m1', ['a', 'b', 'c'], 'a')])
    const version = versionOf(['m1'], { m1: ['c', 'a', 'b'] })
    expect(keyItems(exam, version)).toContainEqual({
      kind: 'answer-key-entry',
      number: 1,
      letter: 'B',
    })
  })

  test('starts fresh after the test and restarts footer numbering at one', () => {
    const pages = planPages(
      examOf([open('o1'), open('o2')]),
      versionOf(),
      {
        itemHeight: (item) => item.kind === 'question' ? 500 : 0,
      },
    )
    const firstKey = pages.findIndex((page) => page.header === 'answer-key')
    expect(firstKey).toBeGreaterThan(0)
    expect(pages[firstKey - 1]!.header).not.toBe('answer-key')
    expect(pages[firstKey]!.number).toBe(1)
  })

  test('lists free-response questions with a blank answer', () => {
    expect(keyItems(examOf([open('o1')]))).toContainEqual({
      kind: 'answer-key-entry',
      number: 1,
      letter: null,
    })
  })

  test('carries the title header and answer-section groupings on key pages', () => {
    const keyPages = planPages(
      examOf([multipleChoice('m1', ['a'], 'a'), open('o1')]),
      versionOf(),
      unmeasured,
    ).filter((page) => isAnswerKeyHeader(page.header))
    expect(keyPages.every((page) => isAnswerKeyHeader(page.header))).toBe(true)
    expect(keyPages[0]!.items).toEqual([
      { kind: 'answer-key-heading' },
      { kind: 'answer-key-section', section: 'multiple-choice', title: 'Multiple Choice' },
      { kind: 'answer-key-entry', number: 1, letter: 'A' },
      { kind: 'answer-key-section', section: 'open', title: 'Short Answer' },
      { kind: 'answer-key-entry', number: 2, letter: null },
    ])
  })

  test('repeats the title only on the first answer-key page', () => {
    const keyPages = planPages(
      examOf([open('o1'), open('o2'), open('o3')]),
      versionOf(),
      {
        // Just over half a page each, taken from the geometry rather than
        // written out, so one entry per page stays one entry per page if the
        // margins or the furniture are ever resized.
        itemHeight: (item) =>
          item.kind === 'answer-key-entry'
            ? pageContentHeight('answer-key-later') * 0.6
            : 0,
      },
    ).filter((page) => page.header.startsWith('answer-key'))

    expect(keyPages.length).toBeGreaterThan(1)
    expect(keyPages.map((page) => page.header)).toEqual([
      'answer-key',
      'answer-key-later',
      'answer-key-later',
    ])
    expect(keyPages.map((page) => page.number)).toEqual([1, 2, 3])
  })

  test('lists a question only once when its test rendering is split', () => {
    const question: Question = {
      ...open('o1'),
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'first' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'second' }] },
        ],
      },
    }
    const pages = planPages(
      examOf([question]),
      versionOf(),
      {
        itemHeight: (item) => item.kind === 'question' ? item.stem.length * 500 : 0,
      },
    )
    const entries = pages.flatMap((page) =>
      page.items.filter((item) => item.kind === 'answer-key-entry'),
    )
    expect(entries).toEqual([{ kind: 'answer-key-entry', number: 1, letter: null }])
  })
})

describe('content selection', () => {
  test('plans only the selected test and answer-key streams', () => {
    const exam = examOf([multipleChoice('m1', ['a', 'b'], 'a')])
    const version = versionOf(['m1'])

    const testOnly = planExport({
      exam,
      version,
      selection: { test: true, answerKey: false },
      measure: unmeasured,
    }).pages
    const keyOnly = planExport({
      exam,
      version,
      selection: { test: false, answerKey: true },
      measure: unmeasured,
    }).pages

    expect(testOnly.length).toBeGreaterThan(0)
    expect(testOnly.every((page) => !isAnswerKeyHeader(page.header))).toBe(true)
    expect(keyOnly.length).toBeGreaterThan(0)
    expect(keyOnly.every((page) => isAnswerKeyHeader(page.header))).toBe(true)
  })

  test('numbers a standalone answer key from page one', () => {
    const exam = examOf([multipleChoice('m1', ['a', 'b'], 'a')])
    const keyOnly = planExport({
      exam,
      version: versionOf(['m1']),
      selection: { test: false, answerKey: true },
      measure: unmeasured,
    })

    expect(keyOnly.pages[0]!.number).toBe(1)
    expect(keyOnly.pages[0]!.breakBefore).toBe(false)
  })
})

describe('page packing', () => {
  const FIRST_BOX = pageContentHeight('first')
  const LATER_BOX = pageContentHeight('later')

  /** An open question with `blocks` top-level paragraphs in its stem. */
  function tall(id: string, blocks: number): Question {
    return {
      id,
      type: 'open',
      doc: {
        type: 'doc',
        content: Array.from({ length: blocks }, (_unused, index) => ({
          type: 'paragraph',
          content: [{ type: 'text', text: `${id} block ${index}` }],
        })),
      },
      columns: 2,
    }
  }

  /** A multiple-choice question with `blocks` stem paragraphs and two choices. */
  function tallChoice(id: string, blocks: number): Question {
    return {
      ...multipleChoice(id, ['a', 'b']),
      doc: {
        type: 'doc',
        content: [
          ...Array.from({ length: blocks }, (_unused, index) => ({
            type: 'paragraph',
            content: [{ type: 'text', text: `${id} block ${index}` }],
          })),
          {
            type: 'multipleChoice',
            content: ['a', 'b'].map((cid) => choice(cid)),
          },
        ],
      },
    }
  }

  // Every stem block of question `id` is `blockHeight[id]` tall and its grid is
  // `gridHeight[id]` tall, so a piece's height follows from what it carries —
  // which is what makes splitting testable without a DOM. Section headings
  // take `chrome`.
  function stubHeights(
    blockHeight: Record<string, number>,
    gridHeight: Record<string, number> = {},
    chrome = 0,
  ): Measure {
    return {
      itemHeight: (item) => {
        if (item.kind !== 'question') return chrome
        const perBlock = blockHeight[item.question.id] ?? 0
        const grid = item.grid ? (gridHeight[item.question.id] ?? 0) : 0
        return item.stem.length * perBlock + grid
      },
    }
  }

  function questionItems(pages: PlannedPage[]): QuestionItem[] {
    return itemsOf(pages).flatMap((item) => (item.kind === 'question' ? [item] : []))
  }

  function pageShape(pages: PlannedPage[]): string[][] {
    return pages.map((page) =>
      page.items.map((item) =>
        item.kind === 'question' ? `q:${item.question.id}` : item.kind,
      ),
    )
  }

  test('a question that fits in the remaining space stays on the page, whole', () => {
    const exam = examOf([tall('o1', 1), tall('o2', 1)])
    const third = Math.floor(FIRST_BOX / 3)
    const pages = testPages(planPages(exam, versionOf(), stubHeights({ o1: third, o2: third })))
    expect(pageShape(pages)).toEqual([['section-heading', 'q:o1', 'q:o2']])
    expect(questionItems(pages).every((item) => item.numbered)).toBe(true)
  })

  test('a question that does not fit moves to the next page whole rather than straddling', () => {
    const exam = examOf([tall('o1', 1), tall('o2', 1)])
    const tooTall = Math.ceil(FIRST_BOX * 0.6)
    const pages = testPages(planPages(exam, versionOf(), stubHeights({ o1: tooTall, o2: tooTall })))
    expect(pageShape(pages)).toEqual([
      ['section-heading', 'q:o1'],
      ['q:o2'],
    ])
    // Whole means whole: the moved question still carries its number line and
    // every one of its stem blocks.
    const moved = questionItems(pages)[1]!
    expect(moved.numbered).toBe(true)
    expect(moved.stem).toHaveLength(1)
  })

  test('a question taller than a full content box splits at top-level block boundaries', () => {
    const exam = examOf([tall('o1', 10)])
    // Ten 100px blocks is 1000px: more than either content box.
    const pages = testPages(planPages(exam, versionOf(), stubHeights({ o1: 100 })))
    expect(pages).toHaveLength(2)
    const pieces = questionItems(pages)
    expect(pieces).toHaveLength(2)
    expect(pieces.map((piece) => piece.stem.length)).toEqual([
      Math.floor(FIRST_BOX / 100),
      10 - Math.floor(FIRST_BOX / 100),
    ])
    // The blocks come out in order, each printed exactly once.
    expect(pieces.flatMap((piece) => piece.stem)).toEqual(pieces[0]!.question.stem)
  })

  test('only the first piece of a split question carries the number line', () => {
    const pages = planPages(examOf([tall('o1', 10)]), versionOf(), stubHeights({ o1: 100 }))
    expect(questionItems(pages).map((piece) => piece.numbered)).toEqual([true, false])
  })

  test('a split never leaves a question number alone at the foot of a page', () => {
    // o1 all but fills page one; o2 is far too tall to fit anywhere whole, so
    // it must split — but its first piece cannot start in the 44px left over.
    const exam = examOf([tall('o1', 1), tall('o2', 12)])
    const pages = planPages(
      exam,
      versionOf(),
      stubHeights({ o1: FIRST_BOX - 44, o2: 100 }),
    )
    expect(pages[0]!.items.map((item) => item.kind)).toEqual([
      'section-heading',
      'question',
    ])
    for (const piece of questionItems(pages)) {
      if (piece.numbered) expect(piece.stem.length + (piece.grid ? 1 : 0)).toBeGreaterThan(0)
    }
  })

  test('a choice grid is never split, and travels whole on the last piece', () => {
    // Eight 100px stem blocks plus a 200px grid: 1000px in all.
    const exam = examOf([tallChoice('m1', 8)])
    const pages = planPages(exam, versionOf(), stubHeights({ m1: 100 }, { m1: 200 }))
    const pieces = questionItems(pages)
    expect(pieces.length).toBeGreaterThan(1)
    expect(pieces.map((piece) => piece.grid !== null)).toEqual(
      pieces.map((_piece, index) => index === pieces.length - 1),
    )
    expect(pieces.at(-1)!.grid).toEqual(pieces[0]!.question.grid)
  })

  test('the header variant is first on page one and later on every page after', () => {
    const exam = examOf([tall('o1', 1), tall('o2', 1), tall('o3', 1)])
    const perPage = Math.ceil(FIRST_BOX * 0.9)
    const pages = testPages(planPages(
      exam,
      versionOf(),
      stubHeights({ o1: perPage, o2: perPage, o3: perPage }),
    ))
    expect(pages.map((page) => page.header)).toEqual(['first', 'later', 'later'])
  })

  test('footers are numbered from one, in order', () => {
    const exam = examOf([tall('o1', 1), tall('o2', 1), tall('o3', 1)])
    const perPage = Math.ceil(FIRST_BOX * 0.9)
    const pages = testPages(planPages(
      exam,
      versionOf(),
      stubHeights({ o1: perPage, o2: perPage, o3: perPage }),
    ))
    expect(pages.map((page) => page.number)).toEqual([1, 2, 3])
  })

  test('later pages are taller, so a question that overflows page one can fit page two whole', () => {
    const exam = examOf([tall('o1', 1), tall('o2', 1)])
    // Taller than the first page's box, shorter than a later page's.
    const between = LATER_BOX
    const pages = testPages(planPages(exam, versionOf(), stubHeights({ o1: 10, o2: between })))
    expect(pageShape(pages)).toEqual([
      ['section-heading', 'q:o1'],
      ['q:o2'],
    ])
    expect(questionItems(pages)[1]!.stem).toHaveLength(1)
  })

  test('section headings take up room too', () => {
    const exam = examOf([tall('o1', 1)])
    const pages = testPages(planPages(
      exam,
      versionOf(),
      stubHeights({ o1: FIRST_BOX - 10 }, {}, 70),
    ))
    expect(pageShape(pages)).toEqual([
      ['section-heading'],
      ['q:o1'],
    ])
  })

  test('a section heading moves with its first question instead of being orphaned', () => {
    const chrome = 70
    const exam = examOf([tallChoice('m1', 1), tall('o1', 1)])
    const pages = testPages(planPages(
      exam,
      versionOf(),
      stubHeights(
        {
          // Leave enough room for the Short Answer heading, but not its first
          // question, after the Multiple Choice section.
          m1: FIRST_BOX - 2 * chrome - 10,
          o1: 100,
        },
        {},
        chrome,
      ),
    ))

    expect(pageShape(pages)).toEqual([
      ['section-heading', 'q:m1'],
      ['section-heading', 'q:o1'],
    ])
  })

  test('an unsplit question carries the whole question, so the page is the only thing that changed', () => {
    const pages = render(examOf([multipleChoice('m1', ['a', 'b'])]))
    const [item] = questionItems(pages)
    expect(item!.stem).toEqual(item!.question.stem)
    expect(item!.grid).toEqual(item!.question.grid)
    expect(item!.numbered).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The planning interface
//
// Everything below reads the plan the way an Export Adapter does: as a
// self-contained description of a document, with no exam, version or `Measure`
// in reach.

describe('the Layout Plan', () => {
  const exam = examOf([multipleChoice('m1', ['a', 'b'], 'a'), open('o1')])
  const version = { ...versionOf(['m1', 'o1']), letter: 'C' }

  function planOf(selection: ExportContentSelection = WHOLE_DOCUMENT) {
    return planExport({ exam, version, selection, measure: unmeasured })
  }

  test('carries the document metadata an adapter needs', () => {
    const plan = planOf()
    expect(plan.title).toBe('Chemistry Unit 3')
    expect(plan.version).toEqual({ id: 'v1', letter: 'C' })
  })

  test('is cut to US Letter at the geometry packing used', () => {
    expect(planOf().pageSize).toEqual({
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      margin: PAGE_MARGIN,
      contentWidth: PAGE_CONTENT_WIDTH,
    })
  })

  test('marks an explicit break before every page but the first', () => {
    const pages = planOf().pages
    expect(pages.length).toBeGreaterThan(1)
    expect(pages.map((page) => page.breakBefore)).toEqual([
      false,
      ...pages.slice(1).map(() => true),
    ])
  })

  test('names each page’s stream, so the key is a document rather than a tail', () => {
    const pages = planOf().pages
    expect(pages.map((page) => page.stream)).toEqual(['test', 'answer-key'])
    expect(pages.map((page) => page.furniture.pageNumber)).toEqual([1, 1])
  })

  test('decides page furniture once, for both adapters to print', () => {
    const [testPage, keyPage] = planOf().pages
    expect(testPage!.furniture).toEqual({
      identityFields: ['Name', 'Class', 'Date'],
      title: 'Chemistry Unit 3',
      versionLabel: 'ID: C',
      pageNumber: 1,
    })
    // The key is the teacher's copy: nothing for a student to fill in.
    expect(keyPage!.furniture.identityFields).toEqual([])
    expect(keyPage!.furniture.versionLabel).toBe('ID: C')
  })

  test('drops the title on a continuation page but never the version', () => {
    const tall: Measure = {
      itemHeight: (item) => (item.kind === 'question' ? 600 : 0),
    }
    const pages = planExport({
      exam,
      version,
      selection: { test: true, answerKey: false },
      measure: tall,
    }).pages
    expect(pages.length).toBe(2)
    expect(pages[1]!.furniture).toEqual({
      identityFields: ['Name'],
      title: null,
      versionLabel: 'ID: C',
      pageNumber: 2,
    })
  })

  test('lays out only the documents the selection asks for', () => {
    expect(planOf({ test: true, answerKey: false }).pages.map((page) => page.stream))
      .toEqual(['test'])
    expect(planOf({ test: false, answerKey: true }).pages.map((page) => page.stream))
      .toEqual(['answer-key'])
    expect(planOf({ test: false, answerKey: false }).pages).toEqual([])
  })

  test('reports the selection it was planned for', () => {
    expect(planOf(STUDENT_TEST).selection).toEqual({ test: true, answerKey: false })
  })
})

describe('the Export Document', () => {
  const exam = examOf([multipleChoice('m1', ['a', 'b'], 'b'), open('o1')])
  const version = versionOf(['m1', 'o1'])

  test('derives both documents whatever the selection', () => {
    const document = buildExportDocument(exam, version, STUDENT_TEST)
    expect(document.test.length).toBeGreaterThan(0)
    expect(document.answerKey.length).toBeGreaterThan(0)
    expect(document.selection).toEqual(STUDENT_TEST)
  })

  test('derives the key from the numbered, lettered questions the test shows', () => {
    const document = buildExportDocument(exam, version, STUDENT_TEST)
    expect(document.answerKey).toEqual([
      { kind: 'answer-key-heading' },
      {
        kind: 'answer-key-section',
        section: 'multiple-choice',
        title: SECTION_TITLE['multiple-choice'],
      },
      { kind: 'answer-key-entry', number: 1, letter: 'B' },
      { kind: 'answer-key-section', section: 'open', title: SECTION_TITLE.open },
      { kind: 'answer-key-entry', number: 2, letter: null },
    ])
  })
})
