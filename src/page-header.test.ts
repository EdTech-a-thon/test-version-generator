import { describe, expect, test } from 'bun:test'
import {
  defaultExamHeader,
  headerContentOf,
  isEmptyContent,
  isExamHeader,
  resolveHeaderContent,
  sameExamHeader,
} from './page-header'

const paragraph = (...content: object[]) => ({ type: 'paragraph', content })
const text = (value: string) => ({ type: 'text', text: value })

describe('an Exam’s own header', () => {
  test('starts from the default: blanks and the ID, different on the first page', () => {
    const header = defaultExamHeader()
    expect(header.differentFirstPage).toBe(true)
    const printed = (slot: 'first' | 'later') =>
      JSON.stringify(resolveHeaderContent(headerContentOf(header, slot), 'ID: B'))
    expect(printed('first')).toContain('Name: ')
    expect(printed('first')).toContain('Class: ')
    expect(printed('first')).toContain('Date: ')
    expect(printed('first')).toContain('ID: B')
    expect(printed('later')).toContain('Name: ')
    expect(printed('later')).not.toContain('Class: ')
    expect(printed('later')).toContain('ID: B')
  })

  test('prints one header on every page unless the first page has its own', () => {
    const header = { differentFirstPage: false, first: [paragraph(text('First'))], later: [paragraph(text('Every'))] }
    expect(headerContentOf(header, 'first')).toEqual(header.later)
    expect(headerContentOf({ ...header, differentFirstPage: true }, 'first')).toEqual(header.first)
  })
})

describe('header content as a paper prints it', () => {
  test('replaces the ID with this paper’s ID', () => {
    expect(resolveHeaderContent([paragraph(text('Version '), { type: 'exam_id' })], 'ID: C')).toEqual([
      paragraph(text('Version '), text('ID: C')),
    ])
  })

  test('prints a table borderless, its first row ordinary, unless the teacher gave it borders', () => {
    const table = (attrs?: object) => ({
      type: 'table',
      ...(attrs ? { attrs } : {}),
      content: [{
        type: 'table_header_row',
        content: [{ type: 'table_header', content: [paragraph(text('Name'))] }],
      }],
    })
    expect(resolveHeaderContent([table()], 'ID: A')).toEqual([{
      type: 'table',
      attrs: { borderless: true },
      content: [{
        type: 'table_row',
        content: [{ type: 'table_cell', content: [paragraph(text('Name'))] }],
      }],
    }])
    const [bordered] = resolveHeaderContent([table({ borders: true })], 'ID: A')
    expect(bordered).toMatchObject({
      attrs: { borders: true, borderless: false },
      content: [{ type: 'table_header_row', content: [{ type: 'table_header' }] }],
    })
  })

  test('is empty when it prints nothing', () => {
    expect(isEmptyContent([])).toBe(true)
    expect(isEmptyContent([paragraph()])).toBe(true)
    expect(isEmptyContent([paragraph(text('  '))])).toBe(true)
    expect(isEmptyContent([paragraph(text('Name'))])).toBe(false)
    expect(isEmptyContent([paragraph({ type: 'exam_id' })])).toBe(false)
    expect(isEmptyContent([{ type: 'table', content: [] }])).toBe(false)
  })
})

describe('a stored header', () => {
  test('is readable only in its whole shape', () => {
    expect(isExamHeader(defaultExamHeader())).toBe(true)
    expect(isExamHeader({ differentFirstPage: false, first: [], later: [] })).toBe(true)
    expect(isExamHeader({ first: [], later: [] })).toBe(false)
    expect(isExamHeader({ differentFirstPage: true, first: 'Name', later: [] })).toBe(false)
    expect(isExamHeader({ differentFirstPage: true, first: [{}], later: [] })).toBe(false)
    expect(isExamHeader(null)).toBe(false)
  })

  test('compares by what it prints; a header written out as the default is still the teacher’s own', () => {
    expect(sameExamHeader(defaultExamHeader(), defaultExamHeader())).toBe(true)
    expect(sameExamHeader(undefined, undefined)).toBe(true)
    expect(sameExamHeader(defaultExamHeader(), undefined)).toBe(false)
  })
})
