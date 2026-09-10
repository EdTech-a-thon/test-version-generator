import { choicesOf, topicsOf, type Difficulty, type Question } from './exam'
import { stemNodesOf, type ProseMirrorJSON } from './question-doc'
import type { QuestionBankResource } from './question-bank-workspaces'

export const QUESTION_BANK_FORMAT = 'test-parrot/question-bank'
export const QUESTION_BANK_FORMAT_VERSION = '0.1.0'
export const QUESTION_BANK_ATTACHMENT_NAME = 'pdfcx.json'
export const QUESTION_BANK_ATTACHMENT_DESCRIPTION = 'pdf-canonical-extraction'

export const SUPPORTED_SEMANTIC_NODE_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'bullet-list',
  'ordered-list',
  'list-item',
  'code-block',
  'rule',
  'table',
  'table-row',
  'table-cell',
  'inline-math',
  'display-math',
  'hard-break',
  'text',
  'inline-image',
  'block-image',
] as const

export const SUPPORTED_SEMANTIC_MARK_TYPES = [
  'strong',
  'emphasis',
  'inline-code',
  'strike',
  'subscript',
  'superscript',
  'link',
] as const

export type SemanticMark =
  | {
      type:
        | 'strong'
        | 'emphasis'
        | 'inline-code'
        | 'strike'
        | 'subscript'
        | 'superscript'
    }
  | { type: 'link'; href: string; title?: string }

export type SemanticNode = {
  type: string
  content?: SemanticNode[]
  text?: string
  marks?: SemanticMark[]
  level?: number
  start?: number
  language?: string
  source?: string
  header?: boolean
  asset?: string
  alt?: string
  caption?: string
  authoredSize?: number
}

export type SemanticDocument = { type: 'document'; content: SemanticNode[] }

export type QuestionBankRecordQuestion = {
  id: string
  type: 'multiple-choice' | 'short-answer'
  stem: SemanticDocument
  difficulty?: Difficulty
  topics?: string[]
  choices?: { id: string; content: SemanticDocument; correct: boolean }[]
  suggestedAnswer?: SemanticDocument
}

export type QuestionBankRecord = {
  format: typeof QUESTION_BANK_FORMAT
  formatVersion: typeof QUESTION_BANK_FORMAT_VERSION
  generator: { name: string; version: string }
  requiredFeatures: string[]
  integrity: { algorithm: 'sha-256'; digest: string }
  bank: {
    name: string
    description?: string
    author?: string
    license?: { name: string; url?: string }
    questions: QuestionBankRecordQuestion[]
  }
  media: {
    id: string
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
    width: number
    height: number
    bytes: string
  }[]
}

export type PreparedQuestionBankExport = {
  record: QuestionBankRecord
  recordBytes: Uint8Array
  filename: string
  /** Renderer-oriented bytes; canonical source bytes remain in record.media. */
  previewMedia?: Map<string, { data: Uint8Array; type: 'png' | 'jpg'; width: number; height: number }>
}

export type QuestionBankMediaSource = {
  data: Uint8Array
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
  previewData?: Uint8Array
  previewType?: 'png' | 'jpg'
}

export type QuestionBankMediaLoader = (source: string) => Promise<QuestionBankMediaSource | null>

const childNodes = (node: ProseMirrorJSON): ProseMirrorJSON[] =>
  Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []

const attributes = (node: ProseMirrorJSON): Record<string, unknown> =>
  typeof node.attrs === 'object' && node.attrs !== null
    ? (node.attrs as Record<string, unknown>)
    : {}

const stringValue = (value: unknown): string =>
  typeof value === 'string' ? value : ''

function safeHttpUrl(value: unknown): string {
  const href = stringValue(value)
  let url: URL
  try {
    url = new URL(href)
  } catch {
    throw new Error(
      'Question Bank export supports only absolute HTTP or HTTPS links.',
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Question Bank export supports only HTTP or HTTPS links.')
  }
  return href
}

function semanticMarks(node: ProseMirrorJSON): SemanticMark[] | undefined {
  if (!Array.isArray(node.marks) || node.marks.length === 0) return undefined
  return (node.marks as ProseMirrorJSON[]).map((mark): SemanticMark => {
    const attrs = attributes(mark)
    switch (mark.type) {
      case 'strong':
        return { type: 'strong' }
      case 'emphasis':
        return { type: 'emphasis' }
      case 'inlineCode':
        return { type: 'inline-code' }
      case 'strike_through':
        return { type: 'strike' }
      case 'subscript':
        return { type: 'subscript' }
      case 'superscript':
        return { type: 'superscript' }
      case 'link': {
        const title = stringValue(attrs.title)
        return {
          type: 'link',
          href: safeHttpUrl(attrs.href),
          ...(title ? { title } : {}),
        }
      }
      default:
        throw new Error(
          `Question Bank export does not support the “${String(mark.type)}” text mark.`,
        )
    }
  })
}

function imageSemanticNode(
  node: ProseMirrorJSON,
  mediaIds: ReadonlyMap<string, string>,
): SemanticNode {
  const attrs = attributes(node)
  const source = stringValue(attrs.src)
  const asset = mediaIds.get(source)
  if (!asset) {
    throw new Error(`Required media “${source || 'without a source'}” could not be resolved. Re-add the image and try again.`)
  }
  const authoredSize = Number(attrs.ratio)
  if (Number.isFinite(authoredSize) && (authoredSize < 0.05 || authoredSize > 1)) {
    throw new Error('Authored Image Size must be between 0.05 and 1.')
  }
  return {
    type: node.type === 'image' ? 'inline-image' : 'block-image',
    asset,
    ...(stringValue(attrs.alt) ? { alt: stringValue(attrs.alt) } : {}),
    ...(stringValue(attrs.caption) ? { caption: stringValue(attrs.caption) } : {}),
    ...(Number.isFinite(authoredSize) ? { authoredSize } : {}),
  }
}

function semanticNode(node: ProseMirrorJSON, mediaIds: ReadonlyMap<string, string>): SemanticNode {
  const attrs = attributes(node)
  const content = () => childNodes(node).map((child) => semanticNode(child, mediaIds))
  switch (node.type) {
    case 'text': {
      const marks = semanticMarks(node)
      return {
        type: 'text',
        text: stringValue(node.text),
        ...(marks ? { marks } : {}),
      }
    }
    case 'hardbreak':
      return { type: 'hard-break' }
    case 'paragraph':
      return { type: 'paragraph', content: content() }
    case 'heading':
      return {
        type: 'heading',
        level: Math.min(6, Math.max(1, Number(attrs.level) || 1)),
        content: content(),
      }
    case 'blockquote':
      return { type: 'blockquote', content: content() }
    case 'bullet_list':
      return { type: 'bullet-list', content: content() }
    case 'ordered_list':
      return {
        type: 'ordered-list',
        start: Number(attrs.order) || 1,
        content: content(),
      }
    case 'list_item':
      return { type: 'list-item', content: content() }
    case 'code_block': {
      const source = childNodes(node)
        .map((child) => stringValue(child.text))
        .join('')
      if (stringValue(attrs.language).toLowerCase() === 'latex') {
        return { type: 'display-math', source }
      }
      const language = stringValue(attrs.language)
      return {
        type: 'code-block',
        ...(language ? { language } : {}),
        text: source,
      }
    }
    case 'hr':
      return { type: 'rule' }
    case 'table':
      return { type: 'table', content: content() }
    case 'table_header_row':
      return { type: 'table-row', header: true, content: content() }
    case 'table_row':
      return { type: 'table-row', content: content() }
    case 'table_header':
      return { type: 'table-cell', header: true, content: content() }
    case 'table_cell':
      return { type: 'table-cell', content: content() }
    case 'math_inline':
      return { type: 'inline-math', source: stringValue(attrs.value) }
    case 'doc':
      throw new Error(
        'A document node may appear only at the root of Question Content.',
      )
    case 'multipleChoice':
    case 'multipleChoiceChoice':
      throw new Error(
        'Multiple Choice structure must remain separate from its stem.',
      )
    case 'image':
    case 'image-block':
      return imageSemanticNode(node, mediaIds)
    default:
      throw new Error(
        `Question Bank export does not support the “${String(node.type)}” content node.`,
      )
  }
}

function semanticDocument(
  nodes: readonly ProseMirrorJSON[],
  mediaIds: ReadonlyMap<string, string>,
): SemanticDocument {
  return { type: 'document', content: nodes.map((node) => semanticNode(node, mediaIds)) }
}

function portableQuestion(
  question: Question,
  index: number,
  mediaIds: ReadonlyMap<string, string>,
): QuestionBankRecordQuestion {
  const base: QuestionBankRecordQuestion = {
    id: `q${index + 1}`,
    type: question.type === 'open' ? 'short-answer' : 'multiple-choice',
    stem: semanticDocument(stemNodesOf(question.doc), mediaIds),
    ...(question.difficulty ? { difficulty: question.difficulty } : {}),
    ...(topicsOf(question).length > 0
      ? { topics: [...topicsOf(question)] }
      : {}),
  }
  if (question.type === 'open') {
    return {
      ...base,
      ...(question.suggestedAnswer
        ? {
            suggestedAnswer: semanticDocument(
              childNodes(question.suggestedAnswer),
              mediaIds,
            ),
          }
        : {}),
    }
  }
  const choices = choicesOf(question)
  if (choices.length < 2) {
    throw new Error(`Question ${index + 1} must have at least two choices.`)
  }
  if (choices.filter((choice) => choice.correct).length > 1) {
    throw new Error(
      `Question ${index + 1} must have zero or one correct choice.`,
    )
  }
  return {
    ...base,
    choices: choices.map((choice, choiceIndex) => ({
      id: `q${index + 1}-c${choiceIndex + 1}`,
      content: semanticDocument(childNodes(choice.node), mediaIds),
      correct: choice.correct,
    })),
  }
}

function assertUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff)
        throw new Error('Canonical JSON cannot contain an unpaired surrogate.')
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error('Canonical JSON cannot contain an unpaired surrogate.')
    }
  }
}

/** RFC 8785 / JSON Canonicalization Scheme for JSON-compatible values. */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error('Canonical JSON cannot contain a non-finite number.')
    return JSON.stringify(value)
  }
  if (typeof value === 'string') {
    assertUnicode(value)
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(',')}]`
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object)
      .sort()
      .filter((key) => object[key] !== undefined)
      .map((key) => {
        assertUnicode(key)
        return `${JSON.stringify(key)}:${canonicalizeJson(object[key])}`
      })
      .join(',')}}`
  }
  throw new Error(`Canonical JSON cannot contain ${typeof value}.`)
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

async function digestOf(record: QuestionBankRecord): Promise<string> {
  const digestless = structuredClone(record)
  delete (digestless.integrity as Partial<QuestionBankRecord['integrity']>)
    .digest
  const bytes = new TextEncoder().encode(canonicalizeJson(digestless))
  return hex(await crypto.subtle.digest('SHA-256', bytes))
}

export async function verifyQuestionBankRecordIntegrity(
  record: QuestionBankRecord,
): Promise<boolean> {
  return (
    record.integrity.algorithm === 'sha-256' &&
    record.integrity.digest === (await digestOf(record))
  )
}

/** Serialize semantic record content at the public exchange boundary. */
export async function serializeQuestionBankRecord(
  content: Pick<QuestionBankRecord, 'bank' | 'media' | 'requiredFeatures'>,
): Promise<{ record: QuestionBankRecord; bytes: Uint8Array }> {
  const record: QuestionBankRecord = {
    format: QUESTION_BANK_FORMAT,
    formatVersion: QUESTION_BANK_FORMAT_VERSION,
    generator: { name: 'Test Parrot', version: '0.1.0' },
    requiredFeatures: [...content.requiredFeatures],
    integrity: { algorithm: 'sha-256', digest: '' },
    bank: structuredClone(content.bank),
    media: structuredClone(content.media),
  }
  record.integrity.digest = await digestOf(record)
  const bytes = new TextEncoder().encode(JSON.stringify(record))
  return {
    record: JSON.parse(new TextDecoder().decode(bytes)) as QuestionBankRecord,
    bytes,
  }
}

export function questionBankFilename(name: string): string {
  const stem = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/g, '')
  return `${stem || 'untitled-question-bank'}.question-bank.pdf`
}

function imageSources(nodes: readonly ProseMirrorJSON[]): string[] {
  const sources: string[] = []
  const visit = (node: ProseMirrorJSON) => {
    if (node.type === 'image' || node.type === 'image-block') {
      const source = stringValue(attributes(node).src)
      if (source && !sources.includes(source)) sources.push(source)
    }
    for (const child of childNodes(node)) visit(child)
  }
  for (const node of nodes) visit(node)
  return sources
}

const browserQuestionBankMedia: QuestionBankMediaLoader = async (source) => {
  try {
    const response = await fetch(source)
    if (!response.ok) return null
    const blob = await response.blob()
    if (!blob.type.toLowerCase().startsWith('image/') || blob.type.toLowerCase() === 'image/svg+xml') return null
    const originalMimeType = blob.type.toLowerCase()
    const bitmap = await createImageBitmap(blob)
    try {
      let data = new Uint8Array(await blob.arrayBuffer())
      let mimeType: QuestionBankMediaSource['mimeType']
      let previewData = data
      let previewType: 'png' | 'jpg'
      if (originalMimeType === 'image/png' || originalMimeType === 'image/jpeg') {
        mimeType = originalMimeType
        previewType = originalMimeType === 'image/jpeg' ? 'jpg' : 'png'
      } else {
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
        const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
        if (!png) return null
        previewData = new Uint8Array(await png.arrayBuffer())
        previewType = 'png'
        if (originalMimeType === 'image/webp') {
          mimeType = 'image/webp'
        } else {
          data = previewData
          mimeType = 'image/png'
        }
      }
      return { data, mimeType, width: bitmap.width, height: bitmap.height, previewData, previewType }
    } finally {
      bitmap.close()
    }
  } catch {
    return null
  }
}

function base64(bytes: Uint8Array): string {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value)
}

export async function prepareQuestionBankExport(
  bank: QuestionBankResource,
  loadMedia: QuestionBankMediaLoader = browserQuestionBankMedia,
): Promise<PreparedQuestionBankExport> {
  if (bank.questions.length === 0) {
    throw new Error(
      'A Question Bank requires at least one Question before it can be exported.',
    )
  }
  const sources = bank.questions.flatMap((question) => [
    ...imageSources(childNodes(question.doc)),
    ...imageSources(question.suggestedAnswer ? childNodes(question.suggestedAnswer) : []),
  ]).filter((source, index, all) => all.indexOf(source) === index)
  const loaded = await Promise.all(sources.map((source) => loadMedia(source)))
  const mediaIds = new Map<string, string>()
  const media: QuestionBankRecord['media'] = []
  const previewMedia = new Map<string, NonNullable<PreparedQuestionBankExport['previewMedia']> extends Map<string, infer V> ? V : never>()
  for (const [index, source] of sources.entries()) {
    const asset = loaded[index]
    if (!asset) throw new Error(`Required media for “${source}” could not be resolved. Re-add the image and try again.`)
    const digest = hex(await crypto.subtle.digest('SHA-256', asset.data))
    const id = `sha256:${digest}`
    mediaIds.set(source, id)
    if (!media.some((candidate) => candidate.id === id)) {
      media.push({ id, mimeType: asset.mimeType, width: asset.width, height: asset.height, bytes: base64(asset.data) })
      previewMedia.set(id, {
        data: asset.previewData ?? asset.data,
        type: asset.previewType ?? (asset.mimeType === 'image/jpeg' ? 'jpg' : 'png'),
        width: asset.width,
        height: asset.height,
      })
    }
  }
  if (bank.license?.url) safeHttpUrl(bank.license.url)
  const serialized = await serializeQuestionBankRecord({
    requiredFeatures: [],
    bank: {
      name: bank.name,
      ...(bank.description !== undefined ? { description: bank.description } : {}),
      ...(bank.author !== undefined ? { author: bank.author } : {}),
      ...(bank.license !== undefined ? { license: { ...bank.license } } : {}),
      questions: bank.questions.map((question, index) => portableQuestion(question, index, mediaIds)),
    },
    media,
  })
  // Preview and attachment share the serializer's exact record and bytes.
  return {
    record: serialized.record,
    recordBytes: serialized.bytes,
    filename: questionBankFilename(bank.name),
    previewMedia,
  }
}

const EDITOR_NODE_TYPES: Record<string, string> = {
  'hard-break': 'hardbreak',
  'bullet-list': 'bullet_list',
  'ordered-list': 'ordered_list',
  'list-item': 'list_item',
  'code-block': 'code_block',
  rule: 'hr',
  'table-row': 'table_row',
  'table-cell': 'table_cell',
  'inline-math': 'math_inline',
}

const EDITOR_MARK_TYPES: Record<SemanticMark['type'], string> = {
  strong: 'strong',
  emphasis: 'emphasis',
  'inline-code': 'inlineCode',
  strike: 'strike_through',
  subscript: 'subscript',
  superscript: 'superscript',
  link: 'link',
}

function editorNode(node: SemanticNode): ProseMirrorJSON {
  if (node.type === 'inline-math')
    return { type: 'math_inline', attrs: { value: node.source ?? '' } }
  if (node.type === 'display-math') {
    return {
      type: 'code_block',
      attrs: { language: 'latex' },
      content: [{ type: 'text', text: node.source ?? '' }],
    }
  }
  if (node.type === 'inline-image' || node.type === 'block-image') {
    return {
      type: node.type === 'inline-image' ? 'image' : 'image-block',
      attrs: {
        src: `/local-images/${node.asset!.slice('sha256:'.length)}`,
        ...(node.alt !== undefined ? { alt: node.alt } : {}),
        ...(node.caption !== undefined ? { caption: node.caption } : {}),
        ...(node.authoredSize !== undefined ? { ratio: node.authoredSize } : {}),
      },
    }
  }
  if (node.type === 'code-block') {
    return {
      type: 'code_block',
      ...(node.language ? { attrs: { language: node.language } } : {}),
      content: [{ type: 'text', text: node.text ?? '' }],
    }
  }
  const type = EDITOR_NODE_TYPES[node.type] ?? node.type
  const attrs: Record<string, unknown> = {}
  if (node.type === 'heading') attrs.level = node.level
  if (node.type === 'ordered-list') attrs.order = node.start
  const converted: ProseMirrorJSON = {
    type,
    ...(node.text !== undefined ? { text: node.text } : {}),
    ...(node.content ? { content: node.content.map(editorNode) } : {}),
  }
  if (node.type === 'table-row' && node.header)
    converted.type = 'table_header_row'
  if (node.type === 'table-cell' && node.header) converted.type = 'table_header'
  if (Object.keys(attrs).length > 0) converted.attrs = attrs
  if (node.marks)
    converted.marks = node.marks.map((mark) => ({
      type: EDITOR_MARK_TYPES[mark.type],
      ...(mark.type === 'link'
        ? {
            attrs: {
              href: mark.href,
              ...(mark.title ? { title: mark.title } : {}),
            },
          }
        : {}),
    }))
  return converted
}

/** Preview adapter: the preview consumes only the portable record. */
export function recordDocumentToEditorNodes(
  document: SemanticDocument,
): ProseMirrorJSON[] {
  return document.content.map(editorNode)
}
