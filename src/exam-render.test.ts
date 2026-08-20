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
  renderExam,
  renderPrintPages,
  unmeasured,
  type ColumnCount,
  type Measure,
  type Page,
  type PageItem,
  type QuestionItem,
  type RenderedQuestion,
} from './exam-render'
import type { Exam, Question, Version } from './exam'
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
    columns: 'auto',
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
    columns: 'auto',
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

function render(exam: Exam, version: Version = versionOf()): Page[] {
  return testPages(renderExam(exam, version, unmeasured))
}

function testPages(pages: Page[]): Page[] {
  return pages.filter((page) => !isAnswerKeyHeader(page.header))
}

function itemsOf(pages: Page[]): PageItem[] {
  return pages.flatMap((page) => page.items)
}

function headings(pages: Page[]): PageItem[] {
  return itemsOf(pages).filter((item) => item.kind === 'section-heading')
}

function renderedQuestions(pages: Page[]): RenderedQuestion[] {
  return itemsOf(pages).flatMap((item) =>
    item.kind === 'question' ? [item.question] : [],
  )
}

/** The grid read row by row, with an empty cell written as a dash. */
function gridRows(question: RenderedQuestion): string[][] {
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

  test('an empty exam still renders a page, so a new exam has somewhere to add to', () => {
    const pages = render(examOf([]))
    expect(pages).toHaveLength(1)
    expect(headings(pages)).toHaveLength(0)
    expect(itemsOf(pages).map((item) => item.kind)).toEqual([
      'add-question',
      'add-question',
    ])
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
      },
      {
        kind: 'section-heading',
        section: 'open',
        title: 'Short Answer',
        instructions: SECTION_INSTRUCTIONS.open,
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

  test('an add-question control closes every section, carrying that section type', () => {
    const pages = render(examOf([multipleChoice('q1', ['a', 'b']), open('q2')]))
    expect(itemsOf(pages)).toEqual([
      expect.objectContaining({ kind: 'section-heading', section: 'multiple-choice' }),
      expect.objectContaining({ kind: 'question' }),
      { kind: 'add-question', section: 'multiple-choice' },
      expect.objectContaining({ kind: 'section-heading', section: 'open' }),
      expect.objectContaining({ kind: 'question' }),
      { kind: 'add-question', section: 'open' },
    ])
  })

  test('keeps an editing-only add control at an empty section position without its heading', () => {
    const pages = render(examOf([multipleChoice('q1', ['a', 'b'])]))
    expect(headings(pages)).toHaveLength(1)
    expect(itemsOf(pages).filter((item) => item.kind === 'add-question')).toEqual([
      { kind: 'add-question', section: 'multiple-choice' },
      { kind: 'add-question', section: 'open' },
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
    const rendered = renderedQuestions(render(exam))
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
    const rendered = renderedQuestions(render(exam, versionOf(['m2', 'o1', 'm1'])))
    expect(rendered.map((question) => question.id)).toEqual(['m2', 'm1', 'o1'])
    expect(rendered.map((question) => question.number)).toEqual([1, 2, 3])
  })

  test('multiple choice is prefixed with an answer blank; short answer is not', () => {
    const exam = examOf([multipleChoice('m1', ['a', 'b']), open('o1')])
    const rendered = renderedQuestions(render(exam))
    expect(rendered.map((question) => question.answerBlank)).toEqual([true, false])
  })

  test('the stem is the question document without its choice list', () => {
    const rendered = renderedQuestions(render(examOf([multipleChoice('m1', ['a', 'b'])])))
    expect(rendered[0]!.stem).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'stem m1' }] },
    ])
  })

  test('a short-answer question has no choices and no grid', () => {
    const rendered = renderedQuestions(render(examOf([open('o1')])))
    expect(rendered[0]!.choices).toEqual([])
    expect(rendered[0]!.grid).toBeNull()
  })
})

describe('choice letters', () => {
  test('follow the version ordering rather than authoring order', () => {
    const exam = examOf([multipleChoice('m1', ['a', 'b', 'c', 'd'], 'a')])
    const version = versionOf(['m1'], { m1: ['c', 'd', 'a', 'b'] })
    const [question] = renderedQuestions(render(exam, version))
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
    const [question] = renderedQuestions(render(exam, version))
    const correct = question!.choices.find((c) => c.correct)
    expect(correct).toMatchObject({ id: 'a', letter: 'C' })
  })

  test('a choice the ordering has never heard of is lettered last', () => {
    const exam = examOf([multipleChoice('m1', ['a', 'b', 'c'])])
    const version = versionOf(['m1'], { m1: ['c', 'gone', 'a'] })
    const [question] = renderedQuestions(render(exam, version))
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
    const [question] = renderedQuestions(render(exam))
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
    const [question] = renderedQuestions(render(exam))
    expect(question!.grid!.rows).toBe(3)
    expect(gridRows(question!)).toEqual([
      ['Aa', 'Dd'],
      ['Bb', 'Ee'],
      ['Cc', '-'],
    ])
  })

  test('three choices lay out down the first column first', () => {
    const exam = examOf([{ ...multipleChoice('m1', ['a', 'b', 'c']), columns: 2 as const }])
    const [question] = renderedQuestions(render(exam))
    expect(gridRows(question!)).toEqual([
      ['Aa', 'Cc'],
      ['Bb', '-'],
    ])
  })

  test('two choices sit side by side on one row', () => {
    const exam = examOf([{ ...multipleChoice('m1', ['a', 'b']), columns: 2 as const }])
    const [question] = renderedQuestions(render(exam))
    expect(gridRows(question!)).toEqual([['Aa', 'Bb']])
  })

  test('an explicit column count overrides the automatic one', () => {
    const one = { ...multipleChoice('m1', ['a', 'b', 'c']), columns: 1 as const }
    const four = { ...multipleChoice('m2', ['a', 'b', 'c', 'd', 'e']), columns: 4 as const }
    const [first, second] = renderedQuestions(render(examOf([one, four])))
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
    const [question] = renderedQuestions(render(exam, version))
    expect(gridRows(question!)).toEqual([
      ['Ad', 'Cb'],
      ['Bc', 'Da'],
    ])
  })
})

describe('auto column resolution', () => {
  function widthMeasure(width: number): Measure {
    return { choiceWidth: () => width, itemHeight: () => 0 }
  }

  function resolvedColumns(choiceCount: number, width: number): ColumnCount {
    const ids = Array.from({ length: choiceCount }, (_unused, index) => `c${index}`)
    const exam = examOf([multipleChoice('m1', ids)])
    const pages = renderExam(exam, versionOf(), widthMeasure(width))
    return renderedQuestions(pages)[0]!.grid!.columns
  }

  for (const choiceCount of [2, 3, 4, 5]) {
    test(`with ${choiceCount} choices, a narrow choice resolves to 4 columns`, () => {
      expect(resolvedColumns(choiceCount, 100)).toBe(4)
    })

    test(`with ${choiceCount} choices, a medium choice resolves to 2 columns`, () => {
      expect(resolvedColumns(choiceCount, 200)).toBe(2)
    })

    test(`with ${choiceCount} choices, a wide choice resolves to 1 column`, () => {
      expect(resolvedColumns(choiceCount, 400)).toBe(1)
    })
  }

  test('a choice wider than the whole content box still resolves to 1 column, not 0', () => {
    expect(resolvedColumns(3, 5000)).toBe(1)
  })

  test('the widest choice decides the column count, not the first or the average', () => {
    const exam = examOf([multipleChoice('m1', ['a', 'b', 'c', 'd'])])
    const measure: Measure = {
      choiceWidth: (choice) => (choice.id === 'c' ? 400 : 10),
      itemHeight: () => 0,
    }
    const [question] = renderedQuestions(renderExam(exam, versionOf(), measure))
    expect(question!.grid!.columns).toBe(1)
  })

  test('an image in any choice resolves to a single column under auto, regardless of measured width', () => {
    const imageChoice: ProseMirrorJSON = {
      type: 'multipleChoiceChoice',
      attrs: { correct: false, id: 'c' },
      content: [{ type: 'image-block', attrs: { src: 'diagram.png' } }],
    }
    const exam: Exam = examOf([
      {
        id: 'm1',
        type: 'multiple-choice',
        doc: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'stem' }] },
            { type: 'multipleChoice', content: [choice('a'), choice('b'), imageChoice] },
          ],
        },
        columns: 'auto',
      },
    ])
    // width 1 would resolve to 4 columns if the image weren't there.
    const [question] = renderedQuestions(renderExam(exam, versionOf(), widthMeasure(1)))
    expect(question!.grid!.columns).toBe(1)
  })

  test('an explicit override ignores measurement entirely', () => {
    const exam = examOf([
      { ...multipleChoice('m1', ['a', 'b', 'c', 'd']), columns: 4 as const },
    ])
    // width 5000 would force 1 column under auto.
    const [question] = renderedQuestions(renderExam(exam, versionOf(), widthMeasure(5000)))
    expect(question!.grid!.columns).toBe(4)
  })

  test('an explicit override survives a content edit that would otherwise resolve differently under auto', () => {
    const original: Question = { ...multipleChoice('m1', ['a', 'b']), columns: 2 as const }
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
    // Narrow enough that all four post-edit choices would resolve to 4
    // columns under auto — the override must still win.
    const narrow = widthMeasure(100)
    const before = renderedQuestions(renderExam(examOf([original]), versionOf(), narrow))
    const after = renderedQuestions(renderExam(examOf([edited]), versionOf(), narrow))
    expect(before[0]!.grid!.columns).toBe(2)
    expect(after[0]!.grid!.columns).toBe(2)
  })
})

// Packing, driven entirely by stubbed heights: no DOM is involved, and the
// numbers below are chosen against the real content boxes so the assertions
// stay honest if the page furniture is ever resized.
describe('page geometry', () => {
  test('is US Letter at 96dpi with one-inch margins', () => {
    expect([PAGE_WIDTH, PAGE_HEIGHT]).toEqual([816, 1056])
    expect(PAGE_MARGIN).toBe(96)
    expect(PAGE_CONTENT_WIDTH).toBe(624)
    expect(CHOICE_AREA_WIDTH).toBe(526)
  })

  test('subtracts the header and footer from the content box', () => {
    const box = PAGE_HEIGHT - 2 * PAGE_MARGIN
    expect(pageContentHeight('first')).toBe(box - HEADER_HEIGHT.first - FOOTER_HEIGHT)
    expect(pageContentHeight('later')).toBe(box - HEADER_HEIGHT.later - FOOTER_HEIGHT)
  })

  test('leaves the first page shorter, because its header carries the title too', () => {
    expect(pageContentHeight('first')).toBeLessThan(pageContentHeight('later'))
  })
})

describe('answer key', () => {
  function keyItems(exam: Exam, version: Version = versionOf()): PageItem[] {
    return renderExam(exam, version, unmeasured)
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
    const pages = renderExam(
      examOf([open('o1'), open('o2')]),
      versionOf(),
      {
        choiceWidth: () => 0,
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
    const keyPages = renderExam(
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
    const keyPages = renderExam(
      examOf([open('o1'), open('o2'), open('o3')]),
      versionOf(),
      {
        choiceWidth: () => 0,
        itemHeight: (item) => item.kind === 'answer-key-entry' ? 400 : 0,
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
    const pages = renderExam(
      examOf([question]),
      versionOf(),
      {
        choiceWidth: () => 0,
        itemHeight: (item) => item.kind === 'question' ? item.stem.length * 500 : 0,
      },
    )
    const entries = pages.flatMap((page) =>
      page.items.filter((item) => item.kind === 'answer-key-entry'),
    )
    expect(entries).toEqual([{ kind: 'answer-key-entry', number: 1, letter: null }])
  })
})

describe('print selection', () => {
  test('prints only the selected test and answer-key streams', () => {
    const exam = examOf([multipleChoice('m1', ['a', 'b'], 'a')])
    const version = versionOf(['m1'])

    const testOnly = renderPrintPages(exam, [version], unmeasured, {
      test: true,
      answerKey: false,
    })[0]!.pages
    const keyOnly = renderPrintPages(exam, [version], unmeasured, {
      test: false,
      answerKey: true,
    })[0]!.pages

    expect(testOnly.length).toBeGreaterThan(0)
    expect(testOnly.every((page) => !isAnswerKeyHeader(page.header))).toBe(true)
    expect(keyOnly.length).toBeGreaterThan(0)
    expect(keyOnly.every((page) => isAnswerKeyHeader(page.header))).toBe(true)
  })

  test('renders every version independently so each stream restarts at page one', () => {
    const exam = examOf([multipleChoice('m1', ['a', 'b'], 'a')])
    const versions = [
      { ...versionOf(['m1'], { m1: ['a', 'b'] }), id: 'v-a', letter: 'A' },
      { ...versionOf(['m1'], { m1: ['b', 'a'] }), id: 'v-b', letter: 'B' },
    ]
    const groups = renderPrintPages(exam, versions, unmeasured, {
      test: true,
      answerKey: true,
    })

    expect(groups.map((group) => group.version.letter)).toEqual(['A', 'B'])
    expect(groups.map((group) => group.pages[0]!.number)).toEqual([1, 1])
    expect(groups.map((group) =>
      group.pages.find((page) => page.header === 'answer-key')!.number,
    )).toEqual([1, 1])
    expect(groups.map((group) =>
      group.pages.flatMap((page) => page.items).find(
        (item) => item.kind === 'answer-key-entry',
      ),
    )).toEqual([
      { kind: 'answer-key-entry', number: 1, letter: 'A' },
      { kind: 'answer-key-entry', number: 1, letter: 'B' },
    ])
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
      columns: 'auto',
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
  // which is what makes splitting testable without a DOM. Section headings and
  // add-question controls take `chrome`.
  function stubHeights(
    blockHeight: Record<string, number>,
    gridHeight: Record<string, number> = {},
    chrome = 0,
  ): Measure {
    return {
      choiceWidth: () => 0,
      itemHeight: (item) => {
        if (item.kind !== 'question') return chrome
        const perBlock = blockHeight[item.question.id] ?? 0
        const grid = item.grid ? (gridHeight[item.question.id] ?? 0) : 0
        return item.stem.length * perBlock + grid
      },
    }
  }

  function questionItems(pages: Page[]): QuestionItem[] {
    return itemsOf(pages).flatMap((item) => (item.kind === 'question' ? [item] : []))
  }

  function pageShape(pages: Page[]): string[][] {
    return pages.map((page) =>
      page.items.map((item) =>
        item.kind === 'question' ? `q:${item.question.id}` : item.kind,
      ),
    )
  }

  test('a question that fits in the remaining space stays on the page, whole', () => {
    const exam = examOf([tall('o1', 1), tall('o2', 1)])
    const third = Math.floor(FIRST_BOX / 3)
    const pages = testPages(renderExam(exam, versionOf(), stubHeights({ o1: third, o2: third })))
    expect(pageShape(pages)).toEqual([['add-question', 'section-heading', 'q:o1', 'q:o2', 'add-question']])
    expect(questionItems(pages).every((item) => item.numbered)).toBe(true)
  })

  test('a question that does not fit moves to the next page whole rather than straddling', () => {
    const exam = examOf([tall('o1', 1), tall('o2', 1)])
    const tooTall = Math.ceil(FIRST_BOX * 0.6)
    const pages = testPages(renderExam(exam, versionOf(), stubHeights({ o1: tooTall, o2: tooTall })))
    expect(pageShape(pages)).toEqual([
      ['add-question', 'section-heading', 'q:o1'],
      ['q:o2', 'add-question'],
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
    const pages = testPages(renderExam(exam, versionOf(), stubHeights({ o1: 100 })))
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
    const pages = renderExam(examOf([tall('o1', 10)]), versionOf(), stubHeights({ o1: 100 }))
    expect(questionItems(pages).map((piece) => piece.numbered)).toEqual([true, false])
  })

  test('a split never leaves a question number alone at the foot of a page', () => {
    // o1 all but fills page one; o2 is far too tall to fit anywhere whole, so
    // it must split — but its first piece cannot start in the 44px left over.
    const exam = examOf([tall('o1', 1), tall('o2', 12)])
    const pages = renderExam(
      exam,
      versionOf(),
      stubHeights({ o1: FIRST_BOX - 44, o2: 100 }),
    )
    expect(pages[0]!.items.map((item) => item.kind)).toEqual([
      'add-question',
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
    const pages = renderExam(exam, versionOf(), stubHeights({ m1: 100 }, { m1: 200 }))
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
    const pages = testPages(renderExam(
      exam,
      versionOf(),
      stubHeights({ o1: perPage, o2: perPage, o3: perPage }),
    ))
    expect(pages.map((page) => page.header)).toEqual(['first', 'later', 'later'])
  })

  test('footers are numbered from one, in order', () => {
    const exam = examOf([tall('o1', 1), tall('o2', 1), tall('o3', 1)])
    const perPage = Math.ceil(FIRST_BOX * 0.9)
    const pages = testPages(renderExam(
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
    const pages = testPages(renderExam(exam, versionOf(), stubHeights({ o1: 10, o2: between })))
    expect(pageShape(pages)).toEqual([
      ['add-question', 'section-heading', 'q:o1'],
      ['q:o2', 'add-question'],
    ])
    expect(questionItems(pages)[1]!.stem).toHaveLength(1)
  })

  test('section headings and add-question controls take up room too', () => {
    const exam = examOf([tall('o1', 1)])
    const pages = testPages(renderExam(
      exam,
      versionOf(),
      stubHeights({ o1: FIRST_BOX - 10 }, {}, 70),
    ))
    expect(pageShape(pages)).toEqual([
      ['add-question', 'section-heading'],
      ['q:o1'],
      ['add-question'],
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
