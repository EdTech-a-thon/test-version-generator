// A question's content, rendered as plain elements.
//
// The exam page is a view of the printed test, not an editor: nothing here is
// contenteditable and no ProseMirror instance is involved. The editor's schema
// is still the source of truth for what a node means, so the node names below
// are the Crepe/Milkdown ones, and anything unrecognised falls back to its
// children rather than disappearing.

import type { ReactNode } from 'react'
import katex from 'katex'
import type { ProseMirrorJSON } from './question-doc'

function attrsOf(node: ProseMirrorJSON): Record<string, unknown> {
  const attrs = node.attrs
  return typeof attrs === 'object' && attrs !== null
    ? (attrs as Record<string, unknown>)
    : {}
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function childrenOf(node: ProseMirrorJSON): ProseMirrorJSON[] {
  return Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []
}

function renderAll(node: ProseMirrorJSON): ReactNode[] {
  return childrenOf(node).map((child, index) => renderNode(child, index))
}

// KaTeX renders to a string of its own markup; the expression itself comes from
// the teacher's own document.
function Tex({ value, display }: { value: string; display: boolean }) {
  const html = katex.renderToString(value, {
    throwOnError: false,
    displayMode: display,
  })
  return (
    <span
      className={display ? 'doc-math doc-math--block' : 'doc-math'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function withMarks(node: ProseMirrorJSON, content: ReactNode): ReactNode {
  const marks = Array.isArray(node.marks)
    ? (node.marks as ProseMirrorJSON[])
    : []
  return marks.reduce<ReactNode>((inner, mark) => {
    const attrs = attrsOf(mark)
    switch (mark.type) {
      case 'strong':
        return <strong>{inner}</strong>
      case 'emphasis':
        return <em>{inner}</em>
      case 'inlineCode':
        return <code>{inner}</code>
      case 'strike_through':
        return <s>{inner}</s>
      case 'subscript':
        return <sub>{inner}</sub>
      case 'superscript':
        return <sup>{inner}</sup>
      case 'link':
        return (
          <a href={text(attrs.href)} title={text(attrs.title) || undefined}>
            {inner}
          </a>
        )
      default:
        return inner
    }
  }, content)
}

function renderNode(node: ProseMirrorJSON, key: number): ReactNode {
  const attrs = attrsOf(node)
  switch (node.type) {
    case 'text':
      return <span key={key}>{withMarks(node, text(node.text))}</span>
    case 'hardbreak':
      return <br key={key} />
    case 'paragraph': {
      const content = renderAll(node)
      // ProseMirror gives an empty paragraph a trailing break so it still
      // occupies a line in the editor. Reproduce that in the read-only view;
      // an empty <p> alone has no line box and adjacent margins collapse.
      return <p key={key}>{content.length > 0 ? content : <br />}</p>
    }
    case 'heading': {
      const level = Math.min(Math.max(Number(attrs.level) || 1, 1), 6)
      const Heading = `h${level}` as 'h1'
      return <Heading key={key}>{renderAll(node)}</Heading>
    }
    case 'blockquote':
      return <blockquote key={key}>{renderAll(node)}</blockquote>
    case 'bullet_list':
      return <ul key={key}>{renderAll(node)}</ul>
    case 'ordered_list':
      return (
        <ol key={key} start={Number(attrs.order) || undefined}>
          {renderAll(node)}
        </ol>
      )
    case 'list_item':
      return (
        <li key={key} data-checked={attrs.checked === true ? 'true' : undefined}>
          {renderAll(node)}
        </li>
      )
    case 'code_block': {
      const source = childrenOf(node)
        .map((child) => text(child.text))
        .join('')
      // Crepe stores display maths as a latex code block.
      if (text(attrs.language).toLowerCase() === 'latex') {
        return <Tex key={key} value={source} display />
      }
      return (
        <pre key={key}>
          <code>{source}</code>
        </pre>
      )
    }
    case 'math_inline':
      return <Tex key={key} value={text(attrs.value)} display={false} />
    case 'hr':
      return <hr key={key} />
    case 'image':
      return (
        <img
          key={key}
          src={text(attrs.src)}
          alt={text(attrs.alt)}
          title={text(attrs.title) || undefined}
        />
      )
    case 'image-block': {
      const caption = text(attrs.caption)
      return (
        <figure key={key} className="doc-figure">
          <img src={text(attrs.src)} alt={caption} />
          {caption && <figcaption>{caption}</figcaption>}
        </figure>
      )
    }
    case 'table':
      return (
        <table key={key} className="doc-table">
          <tbody>{renderAll(node)}</tbody>
        </table>
      )
    case 'table_header_row':
    case 'table_row':
      return <tr key={key}>{renderAll(node)}</tr>
    case 'table_header':
      return <th key={key}>{renderAll(node)}</th>
    case 'table_cell':
      return <td key={key}>{renderAll(node)}</td>
    default:
      return <div key={key}>{renderAll(node)}</div>
  }
}

/** The blocks of a question document, rendered read-only. */
export function DocView({
  content,
  className,
}: {
  content: readonly ProseMirrorJSON[]
  className?: string
}) {
  return (
    <div className={['doc-content', className].filter(Boolean).join(' ')}>
      {content.map((node, index) => renderNode(node, index))}
    </div>
  )
}
