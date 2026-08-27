import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DocView } from './doc-view'

describe('DocView whitespace', () => {
  test('renders authored spaces and consecutive empty lines as printable content', () => {
    const markup = renderToStaticMarkup(
      createElement(DocView, {
        className: 'question-stem',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Show  your  work' }],
          },
          { type: 'paragraph' },
          { type: 'paragraph' },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Answer' }],
          },
        ],
      }),
    )

    expect(markup).toBe(
      '<div class="doc-content question-stem"><p><span>Show  your  work</span></p><p><br/></p><p><br/></p><p><span>Answer</span></p></div>',
    )
  })
})
