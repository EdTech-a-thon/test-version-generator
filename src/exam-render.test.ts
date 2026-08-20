import { describe, expect, test } from 'bun:test'
import {
  SECTION_INSTRUCTIONS,
  SECTION_TITLE,
  renderExam,
  unmeasured,
  type Page,
  type PageItem,
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
  return renderExam(exam, version, unmeasured)
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
  test('an exam renders as a single unbounded first page', () => {
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

describe('the choice grid', () => {
  test('fills column-major over ceil(n / 2) rows at two columns', () => {
    const exam = examOf([multipleChoice('m1', ['a', 'b', 'c', 'd'])])
    const [question] = renderedQuestions(render(exam))
    expect(question!.grid!.columns).toBe(2)
    expect(question!.grid!.rows).toBe(2)
    expect(gridRows(question!)).toEqual([
      ['Aa', 'Cc'],
      ['Bb', 'Dd'],
    ])
  })

  test('an odd count leaves the last cell of the second column empty', () => {
    const exam = examOf([multipleChoice('m1', ['a', 'b', 'c', 'd', 'e'])])
    const [question] = renderedQuestions(render(exam))
    expect(question!.grid!.rows).toBe(3)
    expect(gridRows(question!)).toEqual([
      ['Aa', 'Dd'],
      ['Bb', 'Ee'],
      ['Cc', '-'],
    ])
  })

  test('three choices lay out down the first column first', () => {
    const exam = examOf([multipleChoice('m1', ['a', 'b', 'c'])])
    const [question] = renderedQuestions(render(exam))
    expect(gridRows(question!)).toEqual([
      ['Aa', 'Cc'],
      ['Bb', '-'],
    ])
  })

  test('two choices sit side by side on one row', () => {
    const exam = examOf([multipleChoice('m1', ['a', 'b'])])
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
    const exam = examOf([multipleChoice('m1', ['a', 'b', 'c', 'd'])])
    const version = versionOf(['m1'], { m1: ['d', 'c', 'b', 'a'] })
    const [question] = renderedQuestions(render(exam, version))
    expect(gridRows(question!)).toEqual([
      ['Ad', 'Cb'],
      ['Bc', 'Da'],
    ])
  })
})
