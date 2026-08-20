// A page item, drawn.
//
// Everything that takes up vertical space on a page is drawn here, and only
// here: `exam-page.tsx` wraps these in the editing chrome a teacher clicks, and
// `dom-measure.ts` renders the same components off-screen to find out how tall
// they come out. Sharing them is what makes measurement honest — the heights
// packing is given are the heights the printer will produce, because they were
// taken from this markup.
//
// Nothing in here is interactive beyond a single optional callback, and nothing
// reads a page's furniture: a header, a footer and a page number belong to the
// page, not to the items on it.

import { DocView } from './doc-view'
import type {
  AddQuestionItem,
  ChoiceGrid,
  PageItem,
  QuestionItem,
  SectionHeadingItem,
} from './exam-render'
import type { QuestionType } from './exam'
import type { ProseMirrorJSON } from './question-doc'

/** The blocks inside a node — a choice's own paragraphs, say. */
function blocksOf(node: ProseMirrorJSON): ProseMirrorJSON[] {
  return Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []
}

// The grid is drawn as a real table so that a cell's answer stays inside its
// column, and every border is off: on paper this is a layout, not a table.
export function ChoiceGridView({ grid }: { grid: ChoiceGrid }) {
  return (
    <table className="choice-grid" data-columns={grid.columns}>
      <tbody>
        {grid.cells.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((choice, columnIndex) => (
              <td key={columnIndex} className="choice-cell">
                {choice && (
                  <>
                    <span className="choice-letter">{choice.letter}.</span>
                    <DocView className="choice-body" content={blocksOf(choice.node)} />
                  </>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// A question, or the piece of one this page carries. The number column is drawn
// either way so a continued question's text stays in the same place down the
// page; only the first piece puts a number and an answer blank in it.
export function QuestionContent({ item }: { item: QuestionItem }) {
  return (
    <>
      <div className="question-number">
        {item.numbered && item.question.answerBlank && (
          <span className="answer-blank" aria-label="Answer blank" />
        )}
        {item.numbered && <span className="question-count">{item.question.number}.</span>}
      </div>
      <div className="question-body">
        <DocView className="question-stem" content={item.stem} />
        {item.grid && <ChoiceGridView grid={item.grid} />}
      </div>
    </>
  )
}

// "Select all" is editing chrome, but it sits on the heading's own baseline and
// so is part of how tall the heading is. It is drawn whether or not anything
// wants the click, so measurement and screen agree; print hides it.
export function SectionHeadingContent({
  item,
  onSelectAll,
}: {
  item: SectionHeadingItem
  onSelectAll?: () => void
}) {
  return (
    <>
      <div className="exam-section-titlebar">
        <h2 className="section-title">{item.title}</h2>
        <button type="button" className="section-select-all" onClick={onSelectAll}>
          Select all
        </button>
      </div>
      <p className="section-instructions">{item.instructions}</p>
    </>
  )
}

function addQuestionLabel(section: QuestionType): string {
  return section === 'multiple-choice' ? 'multiple choice' : 'short answer'
}

// Adding from the end of a section: the type is implied by where it sits.
export function AddQuestionButton({
  item,
  onAdd,
}: {
  item: AddQuestionItem
  onAdd?: (section: QuestionType) => void
}) {
  return (
    <button
      type="button"
      className="add-question"
      onClick={() => onAdd?.(item.section)}
    >
      + Add {addQuestionLabel(item.section)} question
    </button>
  )
}

// One page item at its printed size, with no handlers and no gutter — what
// `dom-measure.ts` renders off-screen to read a height back off.
//
// Exhaustive over `PageItem`: a new kind (#8's answer key) does not compile
// until it has been given a way to be drawn, and therefore measured.
export function PageItemMeasureView({ item }: { item: PageItem }) {
  switch (item.kind) {
    case 'section-heading':
      return (
        <header className="exam-section">
          <SectionHeadingContent item={item} />
        </header>
      )
    case 'question':
      return (
        <section className="exam-question">
          <QuestionContent item={item} />
        </section>
      )
    case 'add-question':
      return <AddQuestionButton item={item} />
    default: {
      const unreachable: never = item
      return unreachable
    }
  }
}
