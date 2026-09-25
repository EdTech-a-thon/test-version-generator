// Copy: a Question on the clipboard, ready to paste into another document.
//
// What is copied is what a student reads — the stem, lettered answers, a Word
// Bank and blank-led Items, lettered Parts — unnumbered, so the document it
// lands in numbers it. Correctness, a Suggested Answer, Question Metadata and
// Work Space never travel (see CONTEXT.md, "Copy", and ADR-0029).
//
// Three steps, the first two pure. `copyLinesOf` lays a Question out as lines;
// `copyHtmlOf` and `copyTextOf` write those lines as rich and plain text,
// given the pictures `copyMediaOf` names already turned into bytes. Only
// `copyQuestion` touches a browser: it fetches pictures, rasterises
// mathematics and writes the clipboard.

import { bankLetter } from './matching'
import { authoredImageRatio, authoredImageWidth } from './export-media'
import { pendingImageOf, type ProseMirrorJSON } from './question-doc'
import { readingOfQuestion } from './question-reading-content'
import type { Question } from './exam'

/** One line of a copied Question: blocks of Question Content, led by a label
 *  such as "A. " or "_____ ", and indented under a Part when it belongs to one. */
export type CopyLine = {
  lead?: string
  indent?: number
  content: readonly ProseMirrorJSON[]
}

/** A picture, as bytes the destination can keep, at the size it pastes at. */
export type CopyPicture = { src: string; width: number; height: number }

/** Every picture and formula a copy needs, already resolved. Keyed by the
 *  image's `src`, and by `mathKey` for mathematics. */
export type CopyMedia = ReadonlyMap<string, CopyPicture>

/** The blank a True/False question, or a Matching Item, is answered in. */
export const ANSWER_BLANK = '_____ '

/** The column a picture is sized against: a US Letter page with one-inch
 *  margins, at CSS pixels. Google Docs' default page is exactly this. */
export const COPY_COLUMN_WIDTH = 624

const childrenOf = (node: ProseMirrorJSON): ProseMirrorJSON[] =>
  Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []

const attrsOf = (node: ProseMirrorJSON): Record<string, unknown> =>
  typeof node.attrs === 'object' && node.attrs !== null
    ? (node.attrs as Record<string, unknown>)
    : {}

const stringOf = (value: unknown): string => (typeof value === 'string' ? value : '')

/** A Question, as the lines a student would read. */
export function copyLinesOf(question: Question): CopyLine[] {
  const reading = readingOfQuestion(question)
  const lines: CopyLine[] = []
  if (question.type === 'true-false') {
    // The pair is never printed; the blank asks for a T or an F.
    lines.push({ lead: ANSWER_BLANK, content: reading.stem })
    return lines
  }
  if (reading.stem.length > 0) lines.push({ content: reading.stem })
  for (const [index, choice] of (reading.choices ?? []).entries()) {
    lines.push({ lead: `${bankLetter(index)}. `, content: choice.content })
  }
  if (reading.matching) {
    for (const [index, answer] of reading.matching.wordBank.entries()) {
      lines.push({ lead: `${bankLetter(index)}. `, content: answer.content })
    }
    for (const prompt of reading.matching.prompts) {
      lines.push({ lead: ANSWER_BLANK, content: prompt.content })
    }
  }
  for (const part of reading.parts ?? []) {
    lines.push({ lead: `${part.letter}. `, content: part.stem })
    for (const [index, choice] of (part.choices ?? []).entries()) {
      lines.push({ lead: `${bankLetter(index)}. `, indent: 1, content: choice.content })
    }
  }
  return lines
}

function isDisplayMath(node: ProseMirrorJSON): boolean {
  return node.type === 'code_block' && stringOf(attrsOf(node).language).toLowerCase() === 'latex'
}

function sourceOf(node: ProseMirrorJSON): string {
  return childrenOf(node).map((child) => stringOf(child.text)).join('')
}

/** The key a formula's picture is stored under in `CopyMedia`. */
export function mathKey(source: string, display: boolean): string {
  return `${display ? 'display' : 'inline'}:${source}`
}

/** A picture or a formula a copy has to resolve before it can be written. */
export type CopyMediaRequest =
  | { kind: 'image'; src: string; ratio: number; block: boolean }
  | { kind: 'math'; source: string; display: boolean }

/** Every picture and formula in these lines, once each. */
export function copyMediaOf(lines: readonly CopyLine[]): CopyMediaRequest[] {
  const found = new Map<string, CopyMediaRequest>()
  const visit = (node: ProseMirrorJSON) => {
    if (node.type === 'math_inline') {
      const source = stringOf(attrsOf(node).value)
      found.set(mathKey(source, false), { kind: 'math', source, display: false })
      return
    }
    if (isDisplayMath(node)) {
      const source = sourceOf(node)
      found.set(mathKey(source, true), { kind: 'math', source, display: true })
      return
    }
    if ((node.type === 'image' || node.type === 'image-block') && !pendingImageOf(node)) {
      const src = stringOf(attrsOf(node).src)
      if (src) found.set(src, {
        kind: 'image',
        src,
        ratio: node.type === 'image-block' ? authoredImageRatio(attrsOf(node)) : 1,
        block: node.type === 'image-block',
      })
      return
    }
    childrenOf(node).forEach(visit)
  }
  lines.forEach((line) => line.content.forEach(visit))
  return [...found.values()]
}

/** The width a picture pastes at: its Authored Image Size against the page. */
export function copyImageWidth(naturalWidth: number, ratio: number): number {
  return Math.round(authoredImageWidth(naturalWidth, COPY_COLUMN_WIDTH, ratio))
}

// ---- Rich text ------------------------------------------------------------

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function pictureHtml(picture: CopyPicture | undefined, alt: string): string {
  if (!picture) return escapeHtml(alt ? `[${alt}]` : '[Picture]')
  return `<img src="${escapeHtml(picture.src)}" width="${picture.width}" height="${picture.height}" alt="${escapeHtml(alt)}">`
}

function marksHtml(node: ProseMirrorJSON, inner: string): string {
  const marks = Array.isArray(node.marks) ? (node.marks as ProseMirrorJSON[]) : []
  return marks.reduce((html, mark) => {
    switch (mark.type) {
      case 'strong': return `<b>${html}</b>`
      case 'emphasis': return `<i>${html}</i>`
      case 'inlineCode': return `<code>${html}</code>`
      case 'strike_through': return `<s>${html}</s>`
      case 'subscript': return `<sub>${html}</sub>`
      case 'superscript': return `<sup>${html}</sup>`
      case 'link': return `<a href="${escapeHtml(stringOf(attrsOf(mark).href))}">${html}</a>`
      default: return html
    }
  }, inner)
}

function inlineHtml(node: ProseMirrorJSON, media: CopyMedia): string {
  switch (node.type) {
    case 'text':
      return marksHtml(node, escapeHtml(stringOf(node.text)))
    case 'hardbreak':
      return '<br>'
    case 'math_inline': {
      const source = stringOf(attrsOf(node).value)
      const picture = media.get(mathKey(source, false))
      return picture ? pictureHtml(picture, source) : escapeHtml(source)
    }
    case 'image':
      return pendingImageOf(node)
        ? '[Picture needed]'
        : pictureHtml(media.get(stringOf(attrsOf(node).src)), stringOf(attrsOf(node).alt))
    default:
      return childrenOf(node).map((child) => inlineHtml(child, media)).join('')
  }
}

const paragraphStyle = (indent: number): string =>
  // Word processors read a paragraph's own margins; a stylesheet never
  // reaches the clipboard.
  `margin:0 0 0 ${indent * 0.5}in`

function blockHtml(node: ProseMirrorJSON, media: CopyMedia, lead: string, indent: number): string {
  const open = `<p style="${paragraphStyle(indent)}">${escapeHtml(lead)}`
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return `${open}${childrenOf(node).map((child) => inlineHtml(child, media)).join('')}</p>`
    case 'image-block': {
      const caption = stringOf(attrsOf(node).caption)
      const picture = pendingImageOf(node)
        ? '[Picture needed]'
        : pictureHtml(media.get(stringOf(attrsOf(node).src)), caption)
      return `${open}${picture}</p>${caption ? `<p style="${paragraphStyle(indent)}"><i>${escapeHtml(caption)}</i></p>` : ''}`
    }
    case 'code_block': {
      const source = sourceOf(node)
      if (isDisplayMath(node)) {
        const picture = media.get(mathKey(source, true))
        return `${open}${picture ? pictureHtml(picture, source) : escapeHtml(source)}</p>`
      }
      return `${open}<code>${escapeHtml(source).replace(/\n/g, '<br>')}</code></p>`
    }
    case 'hr':
      return lead ? `${open}</p><hr>` : '<hr>'
    case 'bullet_list':
    case 'ordered_list': {
      const tag = node.type === 'bullet_list' ? 'ul' : 'ol'
      const items = childrenOf(node).map((item) =>
        `<li>${childrenOf(item).map((child) => child.type === 'paragraph'
          ? childrenOf(child).map((inline) => inlineHtml(inline, media)).join('')
          : blockHtml(child, media, '', 0)).join('<br>')}</li>`,
      ).join('')
      return `${lead ? `${open}</p>` : ''}<${tag} style="margin:0 0 0 ${indent * 0.5 + 0.25}in">${items}</${tag}>`
    }
    case 'table': {
      const rows = childrenOf(node).map((row) =>
        `<tr>${childrenOf(row).map((cell) => {
          const tag = cell.type === 'table_header' ? 'th' : 'td'
          return `<${tag} style="border:1px solid #000;padding:2pt 4pt">${childrenOf(cell).map((child) => blockHtml(child, media, '', 0)).join('')}</${tag}>`
        }).join('')}</tr>`,
      ).join('')
      return `${lead ? `${open}</p>` : ''}<table style="width:100%;border-collapse:collapse;table-layout:fixed"><tbody>${rows}</tbody></table>`
    }
    default:
      // Anything unrecognised gives up its children rather than disappearing,
      // as it does on the exam page.
      return childrenOf(node).map((child, index) => blockHtml(child, media, index === 0 ? lead : '', indent)).join('')
        || (lead ? `${open}</p>` : '')
  }
}

function lineHtml(line: CopyLine, media: CopyMedia): string {
  const indent = line.indent ?? 0
  const lead = line.lead ?? ''
  if (line.content.length === 0) return lead ? `<p style="${paragraphStyle(indent)}">${escapeHtml(lead)}</p>` : ''
  return line.content.map((node, index) => blockHtml(node, media, index === 0 ? lead : '', indent)).join('')
}

/** The lines as rich text, for a word processor to paste. */
export function copyHtmlOf(lines: readonly CopyLine[], media: CopyMedia = new Map()): string {
  return `<meta charset="utf-8"><div>${lines.map((line) => lineHtml(line, media)).join('')}</div>`
}

// ---- Plain text -----------------------------------------------------------

function inlineText(node: ProseMirrorJSON): string {
  switch (node.type) {
    case 'text': return stringOf(node.text)
    case 'hardbreak': return '\n'
    case 'math_inline': return `$${stringOf(attrsOf(node).value)}$`
    case 'image': return pendingImageOf(node) ? '[Picture needed]' : '[Picture]'
    default: return childrenOf(node).map(inlineText).join('')
  }
}

function blockText(node: ProseMirrorJSON): string[] {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return [childrenOf(node).map(inlineText).join('')]
    case 'image-block':
      return [pendingImageOf(node) ? '[Picture needed]' : '[Picture]']
    case 'code_block':
      return isDisplayMath(node) ? [`$$${sourceOf(node)}$$`] : sourceOf(node).split('\n')
    case 'hr':
      return ['---']
    case 'bullet_list':
    case 'ordered_list':
      return childrenOf(node).flatMap((item, index) => {
        const marker = node.type === 'bullet_list' ? '- ' : `${index + 1}. `
        return childrenOf(item).flatMap(blockText).map((text, line) => `${line === 0 ? marker : '   '}${text}`)
      })
    case 'table':
      return childrenOf(node).map((row) =>
        childrenOf(row).map((cell) => childrenOf(cell).flatMap(blockText).join(' ')).join('\t'))
    default:
      return childrenOf(node).flatMap(blockText)
  }
}

/** The lines as plain text, for anywhere that takes no formatting. */
export function copyTextOf(lines: readonly CopyLine[]): string {
  return lines.flatMap((line) => {
    const pad = '    '.repeat(line.indent ?? 0)
    const texts = line.content.flatMap(blockText)
    if (texts.length === 0) texts.push('')
    return texts.map((text, index) => `${pad}${index === 0 ? line.lead ?? '' : ''}${text}`)
  }).join('\n')
}

// ---- The clipboard --------------------------------------------------------

/** How many CSS pixels a MathJax `ex` is at a document's default 11pt. */
const EX_PX = 7.5
/** Formulas are drawn at this many device pixels per CSS pixel, so they stay
 *  sharp when the destination is zoomed or printed. */
const MATH_SCALE = 3

let mathJax: Promise<(source: string, display: boolean) => string> | null = null

/** MathJax's TeX-to-SVG, loaded the first time a formula is copied. */
function texToSvg(): Promise<(source: string, display: boolean) => string> {
  mathJax ??= (async () => {
    const [{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }, { AllPackages }] = await Promise.all([
      import('mathjax-full/js/mathjax.js'),
      import('mathjax-full/js/input/tex.js'),
      import('mathjax-full/js/output/svg.js'),
      import('mathjax-full/js/adaptors/liteAdaptor.js'),
      import('mathjax-full/js/handlers/html.js'),
      import('mathjax-full/js/input/tex/AllPackages.js'),
    ])
    const adaptor = liteAdaptor()
    RegisterHTMLHandler(adaptor)
    const document = mathjax.document('', {
      InputJax: new TeX({ packages: AllPackages }),
      OutputJax: new SVG({ fontCache: 'none' }),
    })
    return (source: string, display: boolean) =>
      adaptor.innerHTML(document.convert(source, { display }))
  })()
  return mathJax
}

/** A formula's SVG, sized in CSS pixels and drawn in black: MathJax sizes in
 *  `ex` and paints with `currentColor`, neither of which an image has. */
export function sizedMathSvg(svg: string): { svg: string; width: number; height: number } | null {
  const width = /width="([\d.]+)ex"/.exec(svg)
  const height = /height="([\d.]+)ex"/.exec(svg)
  if (!width || !height) return null
  const px = { width: Number(width[1]) * EX_PX, height: Number(height[1]) * EX_PX }
  return {
    svg: svg
      .replace(/width="[\d.]+ex"/, `width="${px.width * MATH_SCALE}"`)
      .replace(/height="[\d.]+ex"/, `height="${px.height * MATH_SCALE}"`)
      .replace(/currentColor/g, '#000'),
    width: Math.round(px.width),
    height: Math.round(px.height),
  }
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = src
  await image.decode()
  return image
}

async function mathPicture(source: string, display: boolean): Promise<CopyPicture | null> {
  const sized = sizedMathSvg((await texToSvg())(source, display))
  if (!sized) return null
  const url = URL.createObjectURL(new Blob([sized.svg], { type: 'image/svg+xml' }))
  try {
    const image = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(sized.width * MATH_SCALE)
    canvas.height = Math.ceil(sized.height * MATH_SCALE)
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
    return { src: canvas.toDataURL('image/png'), width: sized.width, height: sized.height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

const dataUrlOf = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(blob)
})

async function imagePicture(src: string, ratio: number): Promise<CopyPicture | null> {
  // A Media Asset's address resolves only in this browser, so the picture
  // travels as its own bytes.
  const response = await fetch(src)
  if (!response.ok) return null
  const blob = await response.blob()
  const bitmap = await createImageBitmap(blob)
  const width = copyImageWidth(bitmap.width, ratio)
  const height = Math.round(width * bitmap.height / bitmap.width)
  bitmap.close()
  return { src: await dataUrlOf(blob), width, height }
}

/** Every picture and formula these lines need, as bytes. One that cannot be
 *  resolved is left out, and pastes as a bracketed placeholder or its source. */
export async function resolveCopyMedia(lines: readonly CopyLine[]): Promise<CopyMedia> {
  const resolved = await Promise.all(copyMediaOf(lines).map(async (request) => {
    try {
      return request.kind === 'math'
        ? [mathKey(request.source, request.display), await mathPicture(request.source, request.display)] as const
        : [request.src, await imagePicture(request.src, request.ratio)] as const
    } catch {
      return [request.kind === 'math' ? mathKey(request.source, request.display) : request.src, null] as const
    }
  }))
  return new Map(resolved.filter((entry): entry is readonly [string, CopyPicture] => entry[1] !== null))
}

/**
 * Put a Question on the clipboard of `view` — the window the teacher clicked
 * in, which in the Question Bank Pop-over is not the one this script runs in.
 *
 * The clipboard item is written at once with promises for its contents, so
 * the click that asked for it still counts while pictures are fetched and
 * formulas drawn.
 */
export async function copyQuestion(question: Question, view: Window = window): Promise<void> {
  const lines = copyLinesOf(question)
  const text = copyTextOf(lines)
  const html = resolveCopyMedia(lines).then((media) =>
    new Blob([copyHtmlOf(lines, media)], { type: 'text/html' }))
  const Item = (view as Window & typeof globalThis).ClipboardItem ?? ClipboardItem
  await view.navigator.clipboard.write([new Item({
    'text/html': html,
    'text/plain': new Blob([text], { type: 'text/plain' }),
  })])
}
