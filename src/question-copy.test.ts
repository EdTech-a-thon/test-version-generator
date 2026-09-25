// Copy puts what a student reads on the clipboard, and nothing a teacher
// alone should see. What is asserted here is the pasted text itself — the
// lines, their letters and blanks, and what is left out.

import { describe, expect, test } from 'bun:test'
import type { Question, QuestionType } from './exam'
import type { ProseMirrorJSON } from './question-doc'
import { mark, paragraph, text } from './export-fixtures'
import {
  copyHtmlOf,
  copyImageWidth,
  copyLinesOf,
  copyMediaOf,
  copyTextOf,
  mathKey,
  sizedMathSvg,
} from './question-copy'

function question(type: QuestionType, ...blocks: ProseMirrorJSON[]): Question {
  return { id: 'q1', type, columns: 2, doc: { type: 'doc', content: blocks } }
}

const choice = (id: string, correct: boolean, label: string): ProseMirrorJSON => ({
  type: 'multipleChoiceChoice',
  attrs: { id, correct },
  content: [paragraph(text(label))],
})

const choices = (...list: ProseMirrorJSON[]): ProseMirrorJSON => ({ type: 'multipleChoice', content: list })

const copied = (value: Question) => copyTextOf(copyLinesOf(value))

describe('Copy', () => {
  test('a Multiple Choice question pastes its stem and lettered answers, with no mark on the correct one', () => {
    const value = question(
      'multiple-choice',
      paragraph(text('Which planet is largest?')),
      paragraph(),
      choices(choice('a', false, 'Mars'), choice('b', true, 'Jupiter'), choice('c', false, 'Venus')),
    )
    expect(copied(value)).toBe('Which planet is largest?\nA. Mars\nB. Jupiter\nC. Venus')
    const html = copyHtmlOf(copyLinesOf(value))
    expect(html).toContain('>B. Jupiter</p>')
    expect(html).not.toMatch(/correct|✓/i)
  })

  test('a True/False question pastes as a blank before its stem, never the fixed pair', () => {
    const value = question(
      'true-false',
      paragraph(text('The sun is a star.')),
      paragraph(),
      choices(choice('t', true, 'True'), choice('f', false, 'False')),
    )
    expect(copied(value)).toBe('_____ The sun is a star.')
  })

  test('a Matching set pastes its directions, lettered Word Bank, then blank-led Items, never which answer each names', () => {
    const value = question(
      'matching',
      paragraph(text('Match each capital to its country.')),
      paragraph(),
      {
        type: 'matching',
        content: [
          { type: 'matchingPrompt', attrs: { id: 'p1', answer: 'w2' }, content: [paragraph(text('Paris'))] },
          { type: 'matchingPrompt', attrs: { id: 'p2', answer: 'w1' }, content: [paragraph(text('Rome'))] },
          { type: 'matchingAnswer', attrs: { id: 'w1' }, content: [paragraph(text('Italy'))] },
          { type: 'matchingAnswer', attrs: { id: 'w2' }, content: [paragraph(text('France'))] },
        ],
      },
    )
    expect(copied(value)).toBe(
      'Match each capital to its country.\nA. Italy\nB. France\n_____ Paris\n_____ Rome',
    )
  })

  test('a Short Answer question pastes its stem alone, without its Suggested Answer', () => {
    const value: Question = {
      ...question('open', paragraph(text('Explain photosynthesis.'))),
      suggestedAnswer: { type: 'doc', content: [paragraph(text('Plants turn light into sugar.'))] },
      difficulty: 'hard',
      topics: ['Biology'],
    }
    expect(copied(value)).toBe('Explain photosynthesis.')
    expect(copyHtmlOf(copyLinesOf(value))).not.toMatch(/sugar|Biology|Hard/)
  })

  test('a Multipart question pastes its stem, then lettered Parts with their answers indented under them', () => {
    const value = question(
      'multipart',
      paragraph(text('A train leaves at noon.')),
      {
        type: 'multipartParts',
        content: [
          {
            type: 'multipartPart',
            attrs: { id: 'part1' },
            content: [
              { type: 'multipartPartStem', content: [paragraph(text('How fast is it?'))] },
              choices(choice('a', true, '60 mph'), choice('b', false, '90 mph')),
            ],
          },
          {
            type: 'multipartPart',
            attrs: { id: 'part2' },
            content: [
              { type: 'multipartPartStem', content: [paragraph(text('Where does it go?'))] },
              { type: 'suggestedAnswer', content: [paragraph(text('Chicago'))] },
            ],
          },
        ],
      },
    )
    expect(copied(value)).toBe(
      'A train leaves at noon.\na. How fast is it?\n    A. 60 mph\n    B. 90 mph\nb. Where does it go?',
    )
    expect(copyHtmlOf(copyLinesOf(value))).toContain('margin:0 0 0 0.5in">A. 60 mph')
  })

  test('formatting survives as rich text and is escaped rather than interpreted', () => {
    const value = question('open', paragraph(text('Solve '), text('carefully', mark('strong')), text(' <x & y>')))
    expect(copyHtmlOf(copyLinesOf(value))).toContain('Solve <b>carefully</b> &lt;x &amp; y&gt;')
  })

  test('pictures and formulas are named once each, and paste as the pictures they were resolved to', () => {
    const value = question(
      'open',
      paragraph(text('Find '), { type: 'math_inline', attrs: { value: 'x^2' } }, text('.')),
      { type: 'image-block', attrs: { src: '/local-images/abc', ratio: 0.5, caption: '' } },
      { type: 'image-block', attrs: { src: '/local-images/abc', ratio: 0.5, caption: '' } },
      { type: 'code_block', attrs: { language: 'LaTeX' }, content: [text('\\frac{1}{2}')] },
    )
    const lines = copyLinesOf(value)
    expect(copyMediaOf(lines)).toEqual([
      { kind: 'math', source: 'x^2', display: false },
      { kind: 'image', src: '/local-images/abc', ratio: 0.5, block: true },
      { kind: 'math', source: '\\frac{1}{2}', display: true },
    ])
    const media = new Map([
      [mathKey('x^2', false), { src: 'data:image/png;base64,MATH', width: 20, height: 14 }],
      ['/local-images/abc', { src: 'data:image/png;base64,PIC', width: 312, height: 200 }],
    ])
    const html = copyHtmlOf(lines, media)
    expect(html).toContain('<img src="data:image/png;base64,MATH" width="20" height="14" alt="x^2">')
    expect(html).toContain('<img src="data:image/png;base64,PIC" width="312" height="200"')
    expect(html).not.toContain('/local-images/')
    // A formula that could not be drawn pastes as its own source.
    expect(html).toContain('\\frac{1}{2}')
    expect(copyTextOf(lines)).toBe('Find $x^2$.\n[Picture]\n[Picture]\n$$\\frac{1}{2}$$')
  })

  test('a picture pastes at its Authored Image Size against the page, never wider than the page', () => {
    expect(copyImageWidth(400, 1)).toBe(400)
    expect(copyImageWidth(2000, 1)).toBe(624)
    expect(copyImageWidth(2000, 0.5)).toBe(312)
  })

  test('a formula becomes a black picture sized in pixels rather than ex', () => {
    const sized = sizedMathSvg('<svg width="4ex" height="2ex" viewBox="0 0 1 1"><g fill="currentColor"/></svg>')
    expect(sized).toEqual({
      svg: '<svg width="90" height="45" viewBox="0 0 1 1"><g fill="#000"/></svg>',
      width: 30,
      height: 15,
    })
  })
})
