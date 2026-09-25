// One Question in the Question Bank Pop-over: drawn small, laid out as it will
// land in the document — its answer columns, where its Word Bank goes, the
// lines a written answer is left — with the controls that change that layout
// for this copy only (ADR-0029). A Multipart question shows its shared stem and
// then each Part, each with its own layout; the Question travels whole.

import { useLayoutEffect, useRef, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { DifficultyBadge } from './badges'
import { DocView } from './doc-view'
import { SECTION_LABELS, choicesOf, partsOf, promptsOf, type ColumnSetting, type Question } from './exam'
import { layOutColumns } from './export-plan'
import { bankLetter } from './matching'
import { stemNodesOf, type ProseMirrorJSON } from './question-doc'
import { defaultWordBank, type CopyFormat, type CopyPartFormat } from './question-copy'

const childrenOf = (node: ProseMirrorJSON): ProseMirrorJSON[] =>
  Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []

const COLUMN_OPTIONS: readonly { value: ColumnSetting; label: string }[] = [
  { value: 1, label: '1 column' },
  { value: 2, label: '2 columns' },
  { value: 4, label: '4 columns' },
]

const LINE_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 0, label: 'No lines' },
  { value: 2, label: '2 lines' },
  { value: 4, label: '4 lines' },
  { value: 6, label: '6 lines' },
  { value: 10, label: '10 lines' },
]

/** A layout control. It belongs to the card but is not a click on it: using
 *  it neither selects the Question nor starts a drag. */
function FormatSelect<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return <select
    className="pop-over-format"
    aria-label={label}
    title={label}
    value={String(value)}
    draggable={false}
    onClick={(event) => event.stopPropagation()}
    onPointerDown={(event) => event.stopPropagation()}
    onKeyDown={(event) => event.stopPropagation()}
    onChange={(event) => {
      const chosen = options.find((option) => String(option.value) === event.target.value)
      if (chosen) onChange(chosen.value)
    }}
  >
    {options.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
  </select>
}

/** Lettered answers in the columns chosen, filled down each column. */
function Answers({ answers, columns }: { answers: readonly ProseMirrorJSON[][]; columns: ColumnSetting }) {
  const lettered = answers.map((content, index) => ({ content, letter: bankLetter(index) }))
  const { rows } = layOutColumns(lettered, columns)
  return <ol
    className="pop-over-answers"
    style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.max(rows, 1)}, auto)` }}
  >
    {lettered.map((answer) => (
      <li key={answer.letter}><span>{answer.letter}.</span><DocView content={answer.content} /></li>
    ))}
  </ol>
}

function Rules({ count }: { count: number }) {
  return count > 0
    ? <div className="pop-over-rules" aria-label={`${count} answer lines`}>{Array.from({ length: count }, (_unused, index) => <span key={index} />)}</div>
    : null
}

function Blank() {
  return <span className="pop-over-blank" aria-hidden="true">_____</span>
}

function body(question: Question, format: CopyFormat, onFormat: (format: CopyFormat) => void): {
  controls: ReactNode
  content: ReactNode
} {
  const stem = stemNodesOf(question.doc)
  switch (question.type) {
    case 'multiple-choice': {
      const columns = format.columns ?? question.columns
      return {
        controls: <FormatSelect label="Answer columns" value={columns} options={COLUMN_OPTIONS} onChange={(value) => onFormat({ ...format, columns: value })} />,
        content: <>
          <DocView className="pop-over-stem" content={stem} />
          <Answers answers={choicesOf(question).map(({ node }) => childrenOf(node))} columns={columns} />
        </>,
      }
    }
    case 'true-false':
      return {
        controls: null,
        content: <div className="pop-over-led"><Blank /><DocView className="pop-over-stem" content={stem} /></div>,
      }
    case 'matching': {
      const wordBank = format.wordBank ?? defaultWordBank(question)
      const items = <ul className="pop-over-items">
        {promptsOf(question).map((prompt) => (
          <li key={prompt.id}><Blank /><DocView content={childrenOf(prompt.node)} /></li>
        ))}
      </ul>
      const bank = <Answers answers={choicesOf(question).map(({ node }) => childrenOf(node))} columns={1} />
      return {
        controls: <FormatSelect
          label="Word Bank"
          value={wordBank}
          options={[{ value: 'beside', label: 'Word Bank beside' }, { value: 'above', label: 'Word Bank above' }]}
          onChange={(value) => onFormat({ ...format, wordBank: value })}
        />,
        content: <>
          <DocView className="pop-over-stem" content={stem} />
          {wordBank === 'beside'
            ? <div className="pop-over-beside">{items}{bank}</div>
            : <>{bank}{items}</>}
        </>,
      }
    }
    case 'open':
      return {
        controls: <FormatSelect label="Answer lines" value={format.lines ?? 0} options={LINE_OPTIONS} onChange={(value) => onFormat({ ...format, lines: value })} />,
        content: <>
          <DocView className="pop-over-stem" content={stem} />
          <Rules count={format.lines ?? 0} />
        </>,
      }
    case 'multipart':
      return {
        controls: null,
        content: <>
          <DocView className="pop-over-stem" content={stem} />
          <ol className="pop-over-parts">
            {partsOf(question).map((part, index) => {
              const partFormat: CopyPartFormat = format.parts?.[part.id] ?? {}
              const setPart = (next: CopyPartFormat) => onFormat({ ...format, parts: { ...format.parts, [part.id]: next } })
              return <li key={part.id} className="pop-over-part">
                <div className="pop-over-part-head">
                  <span className="pop-over-part-letter">{bankLetter(index).toLowerCase()}.</span>
                  <span className="pop-over-part-type">{SECTION_LABELS[part.type]}</span>
                  {part.type === 'multiple-choice'
                    ? <FormatSelect label={`Part ${bankLetter(index).toLowerCase()} answer columns`} value={partFormat.columns ?? part.columns} options={COLUMN_OPTIONS} onChange={(value) => setPart({ ...partFormat, columns: value })} />
                    : <FormatSelect label={`Part ${bankLetter(index).toLowerCase()} answer lines`} value={partFormat.lines ?? 0} options={LINE_OPTIONS} onChange={(value) => setPart({ ...partFormat, lines: value })} />}
                </div>
                <DocView className="pop-over-stem" content={part.stem} />
                {part.type === 'multiple-choice'
                  ? <Answers answers={part.choices.map(({ node }) => childrenOf(node))} columns={partFormat.columns ?? part.columns} />
                  : <Rules count={partFormat.lines ?? 0} />}
              </li>
            })}
          </ol>
        </>,
      }
  }
}

export function PopOverCard({
  question,
  name,
  format,
  onFormat,
  selected,
  onSelect,
  onDragStart,
}: {
  /** The Question as it is shown — its pictures already readable here. */
  question: Question
  name: string
  format: CopyFormat
  onFormat: (format: CopyFormat) => void
  selected: boolean
  onSelect: (modifiers: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void
  onDragStart: (event: DragEvent<HTMLLIElement>) => void
}) {
  const { controls, content } = body(question, format, onFormat)
  // Faded only when it is cut off: a short Question ends where it ends.
  const clip = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = clip.current
    if (!element) return
    if (element.scrollHeight > element.clientHeight + 1) element.dataset.cut = 'true'
    else delete element.dataset.cut
  })
  return <li
    className="pop-over-card"
    role="option"
    aria-selected={selected}
    aria-label={name}
    tabIndex={0}
    draggable
    data-question-id={question.id}
    data-type={question.type}
    onClick={(event: MouseEvent<HTMLLIElement>) => onSelect(event)}
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget || (event.key !== ' ' && event.key !== 'Enter')) return
      event.preventDefault()
      onSelect({ shiftKey: event.shiftKey, metaKey: true, ctrlKey: false })
    }}
    onDragStart={(event) => {
      // A drag that began on a layout control is that control's.
      if ((event.target as HTMLElement).closest?.('select')) {
        event.preventDefault()
        return
      }
      onDragStart(event)
    }}
  >
    <div className="pop-over-card-head">
      <span className="question-reading-type">{SECTION_LABELS[question.type]}</span>
      {question.difficulty && <DifficultyBadge difficulty={question.difficulty} />}
      <span className="pop-over-card-controls">{controls}</span>
    </div>
    <div className="pop-over-card-content" ref={clip}>{content}</div>
  </li>
}
