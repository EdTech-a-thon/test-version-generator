// Readable source fixtures for export coverage.
//
// One minimal exam per supported document feature, plus boundary cases for page
// transitions and a couple of realistic composites. Everything here is
// synthetic: no student, teacher or school ever appears in the corpus.
//
// A fixture is source, not expectation. What each one should produce is
// asserted through the shared fingerprint, so adding a fixture is cheap and a
// new parity bug costs one more entry in this file.

import type { Exam, Question, Version } from './exam'
import {
  pageContentHeight,
  unmeasured,
  type Measure,
  type PageItem,
} from './export-plan'
import type { ExportImage } from './docx-export'
import type { ProseMirrorJSON } from './question-doc'

export function text(value: string, ...marks: ProseMirrorJSON[]): ProseMirrorJSON {
  return marks.length > 0
    ? { type: 'text', text: value, marks }
    : { type: 'text', text: value }
}

export function paragraph(...content: ProseMirrorJSON[]): ProseMirrorJSON {
  return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }
}

export function mark(type: string, attrs?: Record<string, unknown>): ProseMirrorJSON {
  return attrs ? { type, attrs } : { type }
}

function open(id: string, ...blocks: ProseMirrorJSON[]): Question {
  return { id, type: 'open', columns: 'auto', doc: { type: 'doc', content: blocks } }
}

function choice(id: string, correct: boolean, ...blocks: ProseMirrorJSON[]) {
  return {
    type: 'multipleChoiceChoice',
    attrs: { correct, id },
    content: blocks,
  }
}

function multipleChoice(
  id: string,
  columns: Question['columns'],
  stem: ProseMirrorJSON[],
  choices: ProseMirrorJSON[],
): Question {
  return {
    id,
    type: 'multiple-choice',
    columns,
    doc: {
      type: 'doc',
      content: [...stem, { type: 'multipleChoice', content: choices }],
    },
  }
}

function version(
  questionOrder: string[],
  choiceOrder: Record<string, string[]> = {},
  letter = 'A',
): Version {
  return { id: 'v-fixture', letter, questionOrder, choiceOrder }
}

/** How much a first page has room for — what a fixture aims at when it wants an
 *  item to land exactly on a page boundary. */
export const FIRST_PAGE_BOX = pageContentHeight('first')

/** A `Measure` that gives named items a fixed height and everything else zero,
 *  so a fixture can put a page boundary exactly where it means to. */
export function stubHeights(heights: Record<string, number>): Measure {
  return {
    choiceWidth: () => 0,
    itemHeight: (item: PageItem) =>
      item.kind === 'question' ? (heights[item.question.id] ?? 0) : 0,
  }
}

/** A one-pixel PNG. Fixtures need real bytes to package, not a real picture. */
export const PIXEL_PNG: ExportImage = {
  data: Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    ),
    (character) => character.charCodeAt(0),
  ),
  type: 'png',
  width: 400,
  height: 200,
}

export type Fixture = {
  name: string
  exam: Exam
  version: Version
  measure: Measure
  /** Every image source in the fixture resolves to the same pixel. */
  images?: boolean
  answerKey?: boolean
}

const fixture = (
  name: string,
  exam: Exam,
  questionVersion: Version,
  extra: Partial<Fixture> = {},
): Fixture => ({ name, exam, version: questionVersion, measure: unmeasured, ...extra })

// ---------------------------------------------------------------------------
// One fixture per supported feature

export const FIXTURES: readonly Fixture[] = [
  fixture(
    'a plain short-answer question',
    { title: 'Plain', questions: [open('o1', paragraph(text('Explain photosynthesis.')))] },
    version(['o1']),
  ),

  fixture(
    'every inline mark',
    {
      title: 'Marks',
      questions: [
        open(
          'o1',
          paragraph(
            text('normal '),
            text('strong', mark('strong')),
            text(' '),
            text('emphasis', mark('emphasis')),
            text(' '),
            text('code', mark('inlineCode')),
            text(' '),
            text('struck', mark('strike_through')),
            text(' H'),
            text('2', mark('subscript')),
            text('O and x'),
            text('2', mark('superscript')),
          ),
        ),
      ],
    },
    version(['o1']),
  ),

  fixture(
    'a link and its destination',
    {
      title: 'Links',
      questions: [
        open(
          'o1',
          paragraph(
            text('Read '),
            text('the notes', mark('link', { href: 'https://example.test/notes' })),
            text(' first.'),
          ),
        ),
      ],
    },
    version(['o1']),
  ),

  fixture(
    'authored blank paragraphs and hard breaks',
    {
      title: 'Whitespace',
      questions: [
        open(
          'o1',
          paragraph(text('Show  your  work')),
          paragraph(),
          paragraph(),
          paragraph(text('first'), { type: 'hardbreak' }, text('second')),
        ),
      ],
    },
    version(['o1']),
  ),

  fixture(
    'headings and a block quote',
    {
      title: 'Structure',
      questions: [
        open(
          'o1',
          { type: 'heading', attrs: { level: 1 }, content: [text('Background')] },
          { type: 'heading', attrs: { level: 3 }, content: [text('Detail')] },
          {
            type: 'blockquote',
            content: [paragraph(text('Energy cannot be created or destroyed.'))],
          },
        ),
      ],
    },
    version(['o1']),
  ),

  fixture(
    'bullet, ordered and nested lists',
    {
      title: 'Lists',
      questions: [
        open(
          'o1',
          {
            type: 'bullet_list',
            content: [
              { type: 'list_item', content: [paragraph(text('alpha'))] },
              {
                type: 'list_item',
                content: [
                  paragraph(text('beta')),
                  {
                    type: 'bullet_list',
                    content: [
                      { type: 'list_item', content: [paragraph(text('beta one'))] },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: 'ordered_list',
            attrs: { order: 3 },
            content: [
              { type: 'list_item', content: [paragraph(text('third'))] },
              { type: 'list_item', content: [paragraph(text('fourth'))] },
            ],
          },
        ),
      ],
    },
    version(['o1']),
  ),

  fixture(
    'a code block and a horizontal rule',
    {
      title: 'Code',
      questions: [
        open(
          'o1',
          {
            type: 'code_block',
            attrs: { language: 'python' },
            content: [text('total = 0\nfor item in items:\n    total += item')],
          },
          { type: 'hr' },
          paragraph(text('What does this print?')),
        ),
      ],
    },
    version(['o1']),
  ),

  fixture(
    'a table with a header row',
    {
      title: 'Tables',
      questions: [
        open(
          'o1',
          {
            type: 'table',
            content: [
              {
                type: 'table_header_row',
                content: [
                  { type: 'table_header', content: [paragraph(text('Element'))] },
                  { type: 'table_header', content: [paragraph(text('Symbol'))] },
                ],
              },
              {
                type: 'table_row',
                content: [
                  { type: 'table_cell', content: [paragraph(text('Sodium'))] },
                  { type: 'table_cell', content: [paragraph(text('Na'))] },
                ],
              },
              {
                type: 'table_row',
                content: [
                  { type: 'table_cell', content: [paragraph(text('Chlorine'))] },
                  { type: 'table_cell', content: [paragraph(text('Cl'))] },
                ],
              },
            ],
          },
        ),
      ],
    },
    version(['o1']),
  ),

  fixture(
    'inline and block images',
    {
      title: 'Images',
      questions: [
        open(
          'o1',
          paragraph(
            text('The apparatus '),
            { type: 'image', attrs: { src: '/local-images/inline.png', alt: 'burner' } },
            text(' is shown.'),
          ),
          {
            type: 'image-block',
            attrs: { src: '/local-images/setup.png', caption: 'Full setup' },
          },
        ),
      ],
    },
    version(['o1']),
    { images: true },
  ),

  fixture(
    'inline and display mathematics',
    {
      title: 'Maths',
      questions: [
        open(
          'o1',
          paragraph(
            text('Given '),
            { type: 'math_inline', attrs: { value: 'E = mc^2' } },
            text(', solve for m.'),
          ),
          {
            type: 'code_block',
            attrs: { language: 'latex' },
            content: [text('\\frac{a}{b} = \\sqrt{c}')],
          },
        ),
      ],
    },
    version(['o1']),
  ),

  fixture(
    'a four-column choice grid with an empty cell',
    {
      title: 'Grids',
      questions: [
        multipleChoice(
          'm1',
          4,
          [paragraph(text('Which is a noble gas?'))],
          [
            choice('c1', false, paragraph(text('Oxygen'))),
            choice('c2', true, paragraph(text('Argon'))),
            choice('c3', false, paragraph(text('Sodium'))),
          ],
        ),
      ],
    },
    version(['m1'], { m1: ['c2', 'c1', 'c3'] }),
  ),

  fixture(
    'a one-column choice grid',
    {
      title: 'One column',
      questions: [
        multipleChoice(
          'm1',
          1,
          [paragraph(text('Which statement is correct?'))],
          [
            choice('c1', true, paragraph(text('Mass is conserved in a closed system.'))),
            choice('c2', false, paragraph(text('Mass is created by combustion.'))),
          ],
        ),
      ],
    },
    version(['m1']),
  ),

  fixture(
    'a two-column choice grid with rich answers',
    {
      title: 'Rich answers',
      questions: [
        multipleChoice(
          'm1',
          2,
          [paragraph(text('Pick the correct formula.'))],
          [
            choice(
              'c1',
              true,
              paragraph(text('H'), text('2', mark('subscript')), text('O')),
            ),
            choice('c2', false, paragraph({ type: 'math_inline', attrs: { value: 'x^2' } })),
            choice('c3', false, paragraph(text('none', mark('emphasis')))),
            choice('c4', false, paragraph()),
          ],
        ),
      ],
    },
    version(['m1']),
  ),

  fixture(
    'both sections with the answer key',
    {
      title: 'Full paper',
      questions: [
        multipleChoice(
          'm1',
          2,
          [paragraph(text('Which is an acid?'))],
          [
            choice('c1', false, paragraph(text('NaOH'))),
            choice('c2', true, paragraph(text('HCl'))),
          ],
        ),
        open('o1', paragraph(text('Describe a titration.'))),
      ],
    },
    version(['o1', 'm1']),
    { answerKey: true },
  ),

  fixture(
    'a question that moves whole to the next page',
    {
      title: 'Page break',
      questions: [
        open('o1', paragraph(text('First question.'))),
        open('o2', paragraph(text('Second question.'))),
      ],
    },
    version(['o1', 'o2']),
    { measure: stubHeights({ o1: 600, o2: 400 }) },
  ),

  fixture(
    'a question split across pages',
    {
      title: 'Split question',
      questions: [
        open(
          'o1',
          paragraph(text('Part one of a very long question.')),
          paragraph(text('Part two of a very long question.')),
          paragraph(text('Part three of a very long question.')),
        ),
      ],
    },
    version(['o1']),
    { measure: stubHeights({ o1: 5000 }) },
  ),

  fixture(
    'a question with automatic answer columns',
    {
      title: 'Auto columns',
      questions: [
        multipleChoice(
          'm1',
          'auto',
          [paragraph(text('Which planet is closest to the sun?'))],
          [
            choice('c1', true, paragraph(text('Mercury'))),
            choice('c2', false, paragraph(text('Venus'))),
            choice('c3', false, paragraph(text('Earth'))),
            choice('c4', false, paragraph(text('Mars'))),
          ],
        ),
      ],
    },
    version(['m1']),
  ),

  fixture(
    'a question that exactly fills the first page',
    {
      title: 'Exact fit',
      questions: [
        open('o1', paragraph(text('Fills the page exactly.'))),
        open('o2', paragraph(text('Starts the second.'))),
      ],
    },
    version(['o1', 'o2']),
    { measure: stubHeights({ o1: FIRST_PAGE_BOX, o2: 100 }) },
  ),

  fixture(
    'a choice grid kept whole when its question moves',
    {
      title: 'Grid kept whole',
      questions: [
        open('o1', paragraph(text('Takes most of the first page.'))),
        multipleChoice(
          'm1',
          2,
          [paragraph(text('Which is a mammal?'))],
          [
            choice('c1', true, paragraph(text('Whale'))),
            choice('c2', false, paragraph(text('Shark'))),
            choice('c3', false, paragraph(text('Trout'))),
          ],
        ),
      ],
    },
    version(['m1', 'o1']),
    { measure: stubHeights({ m1: 500, o1: 500 }) },
  ),

  fixture(
    'a section heading kept with its first question',
    {
      title: 'Heading kept',
      questions: [
        multipleChoice(
          'm1',
          1,
          [paragraph(text('Fills the page.'))],
          [
            choice('c1', true, paragraph(text('Yes'))),
            choice('c2', false, paragraph(text('No'))),
          ],
        ),
        open('o1', paragraph(text('The short-answer section starts here.'))),
      ],
    },
    version(['m1', 'o1']),
    { measure: stubHeights({ m1: FIRST_PAGE_BOX - 20, o1: 200 }) },
  ),

  fixture(
    'content order preserved across several pages',
    {
      title: 'Many pages',
      questions: [
        open('o1', paragraph(text('One.'))),
        open('o2', paragraph(text('Two.'))),
        open('o3', paragraph(text('Three.'))),
        open('o4', paragraph(text('Four.'))),
      ],
    },
    version(['o1', 'o2', 'o3', 'o4']),
    { measure: stubHeights({ o1: 500, o2: 500, o3: 500, o4: 500 }) },
  ),

  fixture(
    'a realistic composite exam',
    {
      title: 'Chemistry: Unit 3 Review',
      questions: [
        multipleChoice(
          'm1',
          'auto',
          [
            paragraph(
              text('Which of the following is '),
              text('not', mark('emphasis')),
              text(' a state of matter?'),
            ),
          ],
          [
            choice('c1', false, paragraph(text('Solid'))),
            choice('c2', false, paragraph(text('Liquid'))),
            choice('c3', true, paragraph(text('Energy'))),
            choice('c4', false, paragraph(text('Gas'))),
          ],
        ),
        multipleChoice(
          'm2',
          1,
          [
            paragraph(text('Read the table, then answer.')),
            {
              type: 'table',
              content: [
                {
                  type: 'table_row',
                  content: [
                    { type: 'table_cell', content: [paragraph(text('Sample'))] },
                    { type: 'table_cell', content: [paragraph(text('Mass'))] },
                  ],
                },
                {
                  type: 'table_row',
                  content: [
                    { type: 'table_cell', content: [paragraph(text('A'))] },
                    { type: 'table_cell', content: [paragraph(text('12 g'))] },
                  ],
                },
              ],
            },
          ],
          [
            choice('c5', true, paragraph(text('Sample A is heavier.'))),
            choice('c6', false, paragraph(text('Sample B is heavier.'))),
          ],
        ),
        open(
          'o1',
          paragraph(
            text('Using '),
            { type: 'math_inline', attrs: { value: 'PV = nRT' } },
            text(', explain the result.'),
          ),
          paragraph(),
          {
            type: 'image-block',
            attrs: { src: '/local-images/graph.png', caption: 'Pressure against volume' },
          },
        ),
      ],
    },
    version(['m2', 'm1'], { m1: ['c3', 'c1', 'c4', 'c2'] }),
    { images: true, answerKey: true, measure: stubHeights({ m1: 300, m2: 300, o1: 300 }) },
  ),
]
