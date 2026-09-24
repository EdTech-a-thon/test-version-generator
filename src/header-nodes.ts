// The header editor's own document vocabulary, on top of Crepe's.
//
// A header can say one live thing — the paper's ID — and its tables print
// without borders unless the teacher asks for them. Both are stored in the
// header's ProseMirror JSON, so the editor's schema has to know them, or a
// header would lose its ID and its table borders the first time it loaded.
// Neither belongs to Question Content: only the header editor installs them.

import { $nodeSchema, $view } from '@milkdown/kit/utils'
import { tableSchema } from '@milkdown/kit/preset/gfm'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { NodeView } from '@milkdown/kit/prose/view'
import { EXAM_ID_NODE, TABLE_BORDERS_ATTR } from './page-header'

// An inline atom that prints the paper's ID ("ID: A") wherever it sits. It is
// resolved to text when the plan is made, so no export adapter ever sees it.
export const examIdSchema = $nodeSchema(EXAM_ID_NODE, () => ({
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  parseDOM: [{ tag: 'span[data-type="exam-id"]' }],
  toDOM: () => ['span', { 'data-type': 'exam-id' }, 'ID'],
  parseMarkdown: { match: () => false, runner: () => undefined },
  toMarkdown: { match: () => false, runner: () => undefined },
}))

// The ID as a pill: a value filled in on each paper, not text to type into.
export const examIdView = $view(examIdSchema.node, () => (node: ProseNode): NodeView => {
  const dom = document.createElement('span')
  dom.className = 'header-id-chip'
  dom.contentEditable = 'false'
  dom.dataset.type = 'exam-id'
  dom.textContent = 'ID'
  dom.title = 'Prints this paper’s ID, such as “ID: A”'
  return {
    dom,
    update: (next) => next.type === node.type,
    ignoreMutation: () => true,
  }
})

// A table's borders, off unless the teacher turns them on. A table in a header
// is almost always layout — blanks spread across the line.
// And a header table may be a single row: a row of blanks has no body under
// its first row, which GFM's own table, built for data, would not allow.
export const tableBordersSchema = tableSchema.extendSchema((previous) => (ctx) => {
  const base = previous(ctx)
  return {
    ...base,
    content: 'table_header_row table_row*',
    attrs: { ...base.attrs, [TABLE_BORDERS_ATTR]: { default: false } },
  }
})
