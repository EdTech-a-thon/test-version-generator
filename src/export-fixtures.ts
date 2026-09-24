// Readable source fixtures for export coverage.
//
// One minimal exam per supported document feature, plus boundary cases for page
// transitions and a couple of realistic composites. Everything here is
// synthetic: no student, teacher or school ever appears in the corpus.
//
// A fixture is source, not expectation. What each one should produce is
// asserted through the shared fingerprint, so adding a fixture is cheap and a
// new parity bug costs one more entry in this file.

import { DEFAULT_COLUMNS, type Exam, type Question, type Arrangement } from './exam'
import {
  pageContentHeight,
  unmeasured,
  type Measure,
  type PageItem,
} from './export-plan'
import type { ExportImage } from './export-media'
import type { ProseMirrorJSON } from './question-doc'

export function text(
  value: string,
  ...marks: ProseMirrorJSON[]
): ProseMirrorJSON {
  return marks.length > 0
    ? { type: 'text', text: value, marks }
    : { type: 'text', text: value }
}

export function paragraph(...content: ProseMirrorJSON[]): ProseMirrorJSON {
  return content.length > 0
    ? { type: 'paragraph', content }
    : { type: 'paragraph' }
}

export function mark(
  type: string,
  attrs?: Record<string, unknown>,
): ProseMirrorJSON {
  return attrs ? { type, attrs } : { type }
}

function open(id: string, ...blocks: ProseMirrorJSON[]): Question {
  return {
    id,
    type: 'open',
    columns: DEFAULT_COLUMNS,
    doc: { type: 'doc', content: blocks },
  }
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

function trueFalse(
  id: string,
  stem: ProseMirrorJSON[],
  correct: 'true' | 'false',
): Question {
  return {
    id,
    type: 'true-false',
    columns: DEFAULT_COLUMNS,
    doc: {
      type: 'doc',
      content: [
        ...stem,
        {
          type: 'multipleChoice',
          content: [
            choice(`${id}-t`, correct === 'true', paragraph(text('True'))),
            choice(`${id}-f`, correct === 'false', paragraph(text('False'))),
          ],
        },
      ],
    },
  }
}

function prompt(id: string, answer: string, ...blocks: ProseMirrorJSON[]) {
  return { type: 'matchingPrompt', attrs: { id, answer }, content: blocks }
}

function bankAnswer(id: string, ...blocks: ProseMirrorJSON[]) {
  return { type: 'matchingAnswer', attrs: { id }, content: blocks }
}

function matching(
  id: string,
  stem: ProseMirrorJSON[],
  prompts: ProseMirrorJSON[],
  bank: ProseMirrorJSON[],
): Question {
  return {
    id,
    type: 'matching',
    columns: DEFAULT_COLUMNS,
    doc: {
      type: 'doc',
      content: [...stem, { type: 'matching', content: [...prompts, ...bank] }],
    },
  }
}

function arrangement(
  questionOrder: string[],
  choiceOrder: Record<string, string[]> = {},
  letter = 'A',
): Arrangement {
  return { id: 'v-fixture', letter, questionOrder, choiceOrder }
}

/** How much a first page has room for — what a fixture aims at when it wants an
 *  item to land exactly on a page boundary. */
export const FIRST_PAGE_BOX = pageContentHeight('first')

/** A `Measure` that gives named items a fixed height and everything else zero,
 *  so a fixture can put a page boundary exactly where it means to. */
export function stubHeights(heights: Record<string, number>): Measure {
  return {
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
  arrangement: Arrangement
  measure: Measure
  /** Every image source in the fixture resolves to the same pixel. */
  images?: boolean
  answerKey?: boolean
}

const fixture = (
  name: string,
  exam: Exam,
  questionArrangement: Arrangement,
  extra: Partial<Fixture> = {},
): Fixture => ({
  name,
  exam,
  arrangement: questionArrangement,
  measure: unmeasured,
  ...extra,
})

// ---------------------------------------------------------------------------
// One fixture per supported feature

// The composite exam, named so the multi-Arrangement fixtures below can publish
// the very same Question Content in several arrangements.
const COMPOSITE_EXAM: Exam = {
  title: 'Chemistry: Unit 3 Review',
  questions: [
    multipleChoice(
      'm1',
      2,
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
        attrs: {
          src: `/local-images/${'a'.repeat(64)}`,
          caption: 'Pressure against volume',
        },
      },
    ),
  ],
}

export const FIXTURES: readonly Fixture[] = [
  // A True/False question is the one shape where an answer blank prints with no
  // choice grid behind it, and where the key letter is not a choice letter.
  // Both adapters have to agree about that on their own.
  fixture(
    'a true/false question and its T or F key entry',
    {
      title: 'True/False',
      questions: [
        trueFalse('t1', [paragraph(text('Mitochondria produce ATP.'))], 'true'),
        trueFalse(
          't2',
          [paragraph(text('Enzymes are consumed by the reactions they catalyze.'))],
          'false',
        ),
      ],
    },
    arrangement(['t1', 't2']),
  ),

  // A matching set is the one shape that takes several numbers, prints them
  // on its items rather than beside its stem, and lays out as two columns
  // stacked independently. Its Word Bank is shuffled here, so the letters the
  // key reports are the arrangement's and not the authored order's.
  fixture(
    'a matching set with a shuffled word bank and an unmatched item',
    {
      title: 'Matching',
      questions: [
        matching(
          'x1',
          [paragraph(text('Match each event to the correct time period.'))],
          [
            prompt('x1-p1', 'x1-a3', paragraph(text('The Pharisees and Sadducees were formed.'))),
            prompt('x1-p2', 'x1-a1', paragraph(text('The synagogue system was set up.'))),
            prompt('x1-p3', '', paragraph(text('The Septuagint was completed.'))),
          ],
          [
            bankAnswer('x1-a1', paragraph(text('Persian'))),
            bankAnswer('x1-a2', paragraph(text('Grecian'))),
            bankAnswer('x1-a3', paragraph(text('Maccabean'))),
            bankAnswer('x1-a4', paragraph(text('Roman'))),
          ],
        ),
      ],
    },
    arrangement(['x1'], { x1: ['x1-a4', 'x1-a3', 'x1-a1', 'x1-a2'] }),
  ),

  // Past five answers the bank moves above the prompts into two columns,
  // column-major — the other shape a source test prints a matching set in.
  fixture(
    'a matching set whose long word bank prints above its items',
    {
      title: 'Beatitudes',
      questions: [
        matching(
          'x2',
          [paragraph(text('Match each description with the correct character trait.'))],
          [
            prompt('x2-p1', 'x2-a4', paragraph(text('passionately wanting righteousness'))),
            prompt('x2-p2', 'x2-a2', paragraph(text('sorrowful because of sin'))),
            prompt('x2-p3', 'x2-a7', paragraph(text('proclaiming the message'))),
            prompt('x2-p4', 'x2-a1', paragraph(text('aware of having no merit'))),
            prompt('x2-p5', 'x2-a8', paragraph(text('mistreated for following'))),
            prompt('x2-p6', 'x2-a5', paragraph(text('not insisting on what is deserved'))),
            prompt('x2-p7', 'x2-a3', paragraph(text('considerate even when slandered'))),
          ],
          [
            bankAnswer('x2-a1', paragraph(text('poor in spirit'))),
            bankAnswer('x2-a2', paragraph(text('mourners'))),
            bankAnswer('x2-a3', paragraph(text('meek'))),
            bankAnswer('x2-a4', paragraph(text('hungry for righteousness'))),
            bankAnswer('x2-a5', paragraph(text('merciful'))),
            bankAnswer('x2-a6', paragraph(text('pure in heart'))),
            bankAnswer('x2-a7', paragraph(text('peacemaking'))),
            bankAnswer('x2-a8', paragraph(text('persecuted for righteousness'))),
          ],
        ),
      ],
    },
    arrangement(['x2']),
  ),

  // Too many items for one page at any real size: the set breaks between its
  // items and every piece prints the whole Word Bank again.
  fixture(
    'a matching set too long for one page, its word bank on every piece',
    {
      title: 'Vocabulary',
      questions: [
        matching(
          'x3',
          [paragraph(text('Match each word to its part of speech.'))],
          Array.from({ length: 40 }, (_unused, index) =>
            prompt(`x3-p${index + 1}`, `x3-a${(index % 4) + 1}`, paragraph(text(`vocabulary word ${index + 1}`))),
          ),
          [
            bankAnswer('x3-a1', paragraph(text('noun'))),
            bankAnswer('x3-a2', paragraph(text('verb'))),
            bankAnswer('x3-a3', paragraph(text('adjective'))),
            bankAnswer('x3-a4', paragraph(text('adverb'))),
          ],
        ),
      ],
    },
    arrangement(['x3']),
    {
      measure: {
        itemHeight: (item) =>
          item.kind === 'question'
            ? item.stem.length * 30 + (item.matching ? item.matching.prompts.length * 32 + 120 : 0)
            : 40,
      },
    },
  ),

  fixture(
    'all four sections on one paper',
    {
      title: 'Mixed sections',
      questions: [
        open('o1', paragraph(text('Explain osmosis.'))),
        trueFalse('t1', [paragraph(text('Water is a compound.'))], 'true'),
        matching(
          'x1',
          [paragraph(text('Match each term with its definition.'))],
          [
            prompt('x1-p1', 'x1-a2', paragraph(text('Osmosis'))),
            prompt('x1-p2', 'x1-a1', paragraph(text('Diffusion'))),
          ],
          [
            bankAnswer('x1-a1', paragraph(text('Particles spread out.'))),
            bankAnswer('x1-a2', paragraph(text('Water crosses a membrane.'))),
          ],
        ),
        multipleChoice(
          'm1',
          2,
          [paragraph(text('Which particle is neutral?'))],
          [
            choice('m1-a', false, paragraph(text('Proton'))),
            choice('m1-b', true, paragraph(text('Neutron'))),
          ],
        ),
      ],
    },
    arrangement(['o1', 't1', 'x1', 'm1']),
  ),

  fixture(
    'a plain short-answer question',
    {
      title: 'Plain',
      questions: [open('o1', paragraph(text('Explain photosynthesis.')))],
    },
    arrangement(['o1']),
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
    arrangement(['o1']),
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
            text(
              'the notes',
              mark('link', { href: 'https://example.test/notes' }),
            ),
            text(' first.'),
          ),
        ),
      ],
    },
    arrangement(['o1']),
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
    arrangement(['o1']),
  ),

  fixture(
    'headings and a block quote',
    {
      title: 'Structure',
      questions: [
        open(
          'o1',
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [text('Background')],
          },
          { type: 'heading', attrs: { level: 3 }, content: [text('Detail')] },
          {
            type: 'blockquote',
            content: [
              paragraph(text('Energy cannot be created or destroyed.')),
            ],
          },
        ),
      ],
    },
    arrangement(['o1']),
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
                      {
                        type: 'list_item',
                        content: [paragraph(text('beta one'))],
                      },
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
    arrangement(['o1']),
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
    arrangement(['o1']),
  ),

  fixture(
    'a table with a header row',
    {
      title: 'Tables',
      questions: [
        open('o1', {
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
        }),
      ],
    },
    arrangement(['o1']),
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
            {
              type: 'image',
              attrs: { src: `/local-images/${'b'.repeat(64)}`, alt: 'burner' },
            },
            text(' is shown.'),
          ),
          // Dragged to half the size it fit at, the way Crepe records a
          // resize: every adapter has to size it by this, not by its bytes.
          {
            type: 'image-block',
            attrs: {
              src: `/local-images/${'c'.repeat(64)}`,
              caption: 'Full setup',
              ratio: 0.5,
            },
          },
        ),
      ],
    },
    arrangement(['o1']),
    { images: true },
  ),

  // A picture belongs to the column its block sits in: past a Multiple Choice
  // question's blank and number, and past a choice's letter.
  fixture(
    'pictures in a multiple-choice stem and choice',
    {
      title: 'Apparatus',
      questions: [
        multipleChoice(
          'm1',
          2,
          [
            paragraph(text('Which piece of glassware is shown?')),
            { type: 'image-block', attrs: { src: `/local-images/${'d'.repeat(64)}`, caption: '', ratio: 1 } },
            { type: 'image', attrs: { src: `/local-images/${'e'.repeat(64)}`, alt: 'flask' } },
          ],
          [
            choice('m1-c1', true, { type: 'image', attrs: { src: `/local-images/${'f'.repeat(64)}`, alt: 'beaker' } }),
            choice('m1-c2', false, paragraph(text('A burette'))),
          ],
        ),
      ],
    },
    arrangement(['m1']),
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
    arrangement(['o1']),
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
    arrangement(['m1'], { m1: ['c2', 'c1', 'c3'] }),
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
            choice(
              'c1',
              true,
              paragraph(text('Mass is conserved in a closed system.')),
            ),
            choice(
              'c2',
              false,
              paragraph(text('Mass is created by combustion.')),
            ),
          ],
        ),
      ],
    },
    arrangement(['m1']),
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
            choice(
              'c2',
              false,
              paragraph({ type: 'math_inline', attrs: { value: 'x^2' } }),
            ),
            choice('c3', false, paragraph(text('none', mark('emphasis')))),
            choice('c4', false, paragraph()),
          ],
        ),
      ],
    },
    arrangement(['m1']),
  ),

  fixture(
    'both sections with the answer key',
    {
      title: 'Full paper',
      questions: [
        {
          ...multipleChoice(
            'm1',
            2,
            [paragraph(text('Which is an acid?'))],
            [
              choice('c1', false, paragraph(text('NaOH'))),
              choice('c2', true, paragraph(text('HCl'))),
            ],
          ),
          difficulty: 'easy',
          topics: ['Acids'],
        },
        {
          ...open('o1', paragraph(text('Describe a titration.'))),
          difficulty: 'hard',
          topics: ['Titration'],
        },
      ],
    },
    arrangement(['o1', 'm1']),
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
    arrangement(['o1', 'o2']),
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
    arrangement(['o1']),
    { measure: stubHeights({ o1: 5000 }) },
  ),

  fixture(
    'a question with two answer columns',
    {
      title: 'Two columns',
      questions: [
        multipleChoice(
          'm1',
          2,
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
    arrangement(['m1']),
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
    arrangement(['o1', 'o2']),
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
    arrangement(['m1', 'o1']),
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
    arrangement(['m1', 'o1']),
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
    arrangement(['o1', 'o2', 'o3', 'o4']),
    { measure: stubHeights({ o1: 500, o2: 500, o3: 500, o4: 500 }) },
  ),

  fixture(
    'Short Answer work space, lined, blank and filling its page',
    {
      title: 'Work space',
      questions: [
        open('o1', paragraph(text('Show how you balanced the equation.'))),
        open('o2', paragraph(text('Sketch the apparatus.'))),
        open('o3', paragraph(text('Explain your reasoning.'))),
        open('o4', paragraph(text('Starts a new page after a filled one.'))),
      ],
      workSpace: {
        o1: { height: 160, style: 'lines', fill: false },
        o2: { height: 96, style: 'blank', fill: false },
        o3: { height: 64, style: 'lines', fill: true },
      },
    },
    arrangement(['o1', 'o2', 'o3', 'o4']),
    { measure: stubHeights({ o1: 200, o2: 150, o3: 100, o4: 100 }) },
  ),

  fixture(
    'a Short Answer question with its Suggested Answer in the key',
    {
      title: 'Suggested answers',
      questions: [
        {
          ...open('o1', paragraph(text('Why do leaves change colour?'))),
          suggestedAnswer: {
            type: 'doc',
            content: [
              paragraph(text('Chlorophyll breaks down, ')),
              paragraph(text('revealing ', ), text('carotenoids', mark('strong')), text('.')),
            ],
          },
        },
        open('o2', paragraph(text('A question with no answer given.'))),
      ],
    },
    arrangement(['o1', 'o2']),
    { answerKey: true },
  ),

  fixture(
    'a realistic composite exam',
    COMPOSITE_EXAM,
    arrangement(['m2', 'm1'], { m1: ['c3', 'c1', 'c4', 'c2'] }),
    {
      images: true,
      answerKey: true,
      measure: stubHeights({ m1: 300, m2: 300, o1: 300 }),
    },
  ),
]
