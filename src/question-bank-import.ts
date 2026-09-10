import Ajv2020, { type ErrorObject } from 'ajv/dist/2020'
import questionBankSchema from './question-bank-record-0.1.0.schema.json'
import {
  QUESTION_BANK_ATTACHMENT_DESCRIPTION,
  QUESTION_BANK_FORMAT,
  canonicalizeJson,
  type QuestionBankRecord,
  type QuestionBankRecordQuestion,
  type SemanticDocument,
  type SemanticNode,
} from './question-bank-export'

export const DEFAULT_QUESTION_BANK_IMPORT_LIMITS = Object.freeze({
  pdfBytes: 100 * 1024 * 1024,
  recordBytes: 75 * 1024 * 1024,
  questions: 10_000,
  mediaAssets: 2_000,
  mediaAssetBytes: 25 * 1024 * 1024,
  totalMediaBytes: 75 * 1024 * 1024,
  questionNodes: 25_000,
  richTextDepth: 50,
  imageWidth: 20_000,
  imageHeight: 20_000,
})

export type QuestionBankImportLimits = typeof DEFAULT_QUESTION_BANK_IMPORT_LIMITS

export type QuestionBankImportErrorCode =
  | 'pdf-size-limit'
  | 'invalid-pdf'
  | 'missing-attachment'
  | 'ambiguous-attachments'
  | 'record-size-limit'
  | 'invalid-json'
  | 'unsupported-format'
  | 'unsupported-version'
  | 'invalid-structure'
  | 'unsupported-feature'
  | 'integrity-mismatch'
  | 'duplicate-id'
  | 'dangling-reference'
  | 'invalid-question'
  | 'unsafe-url'
  | 'question-count-limit'
  | 'media-count-limit'
  | 'media-asset-size-limit'
  | 'total-media-size-limit'
  | 'question-node-limit'
  | 'rich-text-depth-limit'
  | 'image-dimension-limit'
  | 'invalid-media'

export class QuestionBankImportError extends Error {
  constructor(
    readonly code: QuestionBankImportErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'QuestionBankImportError'
  }
}

type ParsedRecord = {
  format: typeof QUESTION_BANK_FORMAT
  formatVersion: '0.1.0'
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
  media: ParsedMediaAsset[]
}

type ParsedMediaAsset = {
  id: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
  bytes: string
}

export type QuestionBankImportProposal = {
  record: ParsedRecord
  summary: {
    bankName: string
    questionCounts: { 'multiple-choice': number; 'short-answer': number }
    topics: string[]
    incompleteMultipleChoice: number
    mediaAssets: number
    decodedMediaBytes: number
    externalLinks: boolean
    formatVersion: string
    integrity: 'verified'
  }
}

type Parser = (value: unknown) => ParsedRecord

const ajv = new Ajv2020({ allErrors: true, strict: false })
const validate010 = ajv.compile(questionBankSchema)

function schemaMessage(errors: ErrorObject[] | null | undefined): string {
  const first = errors?.[0]
  return first
    ? `Question Bank Record schema validation failed at ${first.instancePath || '/'}: ${first.message}.`
    : 'Question Bank Record schema validation failed.'
}

function copyNode(node: SemanticNode): SemanticNode {
  return {
    type: node.type,
    ...(node.text !== undefined ? { text: node.text } : {}),
    ...(node.content ? { content: node.content.map(copyNode) } : {}),
    ...(node.marks
      ? {
          marks: node.marks.map((mark) =>
            mark.type === 'link'
              ? {
                  type: 'link' as const,
                  href: mark.href,
                  ...(mark.title !== undefined ? { title: mark.title } : {}),
                }
              : { type: mark.type },
          ),
        }
      : {}),
    ...(node.level !== undefined ? { level: node.level } : {}),
    ...(node.start !== undefined ? { start: node.start } : {}),
    ...(node.language !== undefined ? { language: node.language } : {}),
    ...(node.source !== undefined ? { source: node.source } : {}),
    ...(node.header !== undefined ? { header: node.header } : {}),
    ...(node.asset !== undefined ? { asset: node.asset } : {}),
    ...(node.alt !== undefined ? { alt: node.alt } : {}),
    ...(node.caption !== undefined ? { caption: node.caption } : {}),
    ...(node.authoredSize !== undefined ? { authoredSize: node.authoredSize } : {}),
  }
}

function copyDocument(document: SemanticDocument): SemanticDocument {
  return { type: 'document', content: document.content.map(copyNode) }
}

function copyQuestion(question: QuestionBankRecordQuestion): QuestionBankRecordQuestion {
  return {
    id: question.id,
    type: question.type,
    stem: copyDocument(question.stem),
    ...(question.difficulty !== undefined ? { difficulty: question.difficulty } : {}),
    ...(question.topics !== undefined ? { topics: [...question.topics] } : {}),
    ...(question.choices !== undefined
      ? {
          choices: question.choices.map((choice) => ({
            id: choice.id,
            content: copyDocument(choice.content),
            correct: choice.correct,
          })),
        }
      : {}),
    ...(question.suggestedAnswer !== undefined
      ? { suggestedAnswer: copyDocument(question.suggestedAnswer) }
      : {}),
  }
}

function parser010(value: unknown): ParsedRecord {
  if (!validate010(value)) {
    const unsafeLink = validate010.errors?.find(
      (error) =>
        error.keyword === 'pattern' &&
        error.instancePath.endsWith('/href'),
    )
    if (unsafeLink) {
      const href = unsafeLink.instancePath
        .split('/')
        .filter(Boolean)
        .reduce<unknown>((current, part) =>
          typeof current === 'object' && current !== null
            ? (current as Record<string, unknown>)[part]
            : undefined, value)
      throw new QuestionBankImportError(
        'unsafe-url',
        `The link “${String(href)}” is unsafe. Question Bank links must use absolute HTTP or HTTPS URLs.`,
      )
    }
    throw new QuestionBankImportError(
      'invalid-structure',
      schemaMessage(validate010.errors),
    )
  }
  const record = value as QuestionBankRecord & {
    bank: ParsedRecord['bank']
    media: ParsedMediaAsset[]
  }
  return {
    format: QUESTION_BANK_FORMAT,
    formatVersion: '0.1.0',
    generator: {
      name: record.generator.name,
      version: record.generator.version,
    },
    requiredFeatures: [...record.requiredFeatures],
    integrity: { ...record.integrity },
    bank: {
      name: record.bank.name,
      ...(record.bank.description !== undefined
        ? { description: record.bank.description }
        : {}),
      ...(record.bank.author !== undefined ? { author: record.bank.author } : {}),
      ...(record.bank.license !== undefined
        ? {
            license: {
              name: record.bank.license.name,
              ...(record.bank.license.url !== undefined
                ? { url: record.bank.license.url }
                : {}),
            },
          }
        : {}),
      questions: record.bank.questions.map(copyQuestion),
    },
    media: record.media.map((asset) => ({
      id: asset.id,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      bytes: asset.bytes,
    })),
  }
}

/** Exact versions only: adding compatibility requires adding an explicit parser or migration. */
export const SUPPORTED_QUESTION_BANK_VERSIONS: Readonly<Record<string, Parser>> =
  Object.freeze({ '0.1.0': parser010 })

const utf8 = new TextDecoder('utf-8', { fatal: true })

function decodeJson(bytes: Uint8Array): unknown {
  let source: string
  try {
    source = utf8.decode(bytes)
  } catch {
    throw new QuestionBankImportError(
      'invalid-json',
      'The canonical attachment is not valid UTF-8 JSON.',
    )
  }
  try {
    return JSON.parse(source)
  } catch {
    throw new QuestionBankImportError(
      'invalid-json',
      'The canonical attachment contains invalid JSON.',
    )
  }
}

function requiredString(object: unknown, key: string): string | undefined {
  if (typeof object !== 'object' || object === null) return undefined
  const value = (object as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

function structuralParse(
  value: unknown,
): { source: ParsedRecord; sanitized: ParsedRecord } {
  const format = requiredString(value, 'format')
  if (format !== QUESTION_BANK_FORMAT) {
    throw new QuestionBankImportError(
      'unsupported-format',
      `The attachment format “${format ?? 'missing'}” is not ${QUESTION_BANK_FORMAT}.`,
    )
  }
  const version = requiredString(value, 'formatVersion') ?? 'missing'
  const parser = SUPPORTED_QUESTION_BANK_VERSIONS[version]
  if (!parser) {
    throw new QuestionBankImportError(
      'unsupported-version',
      `Question Bank format version “${version}” is unsupported. Supported versions: ${Object.keys(SUPPORTED_QUESTION_BANK_VERSIONS).join(', ')}.`,
    )
  }
  return { source: value as ParsedRecord, sanitized: parser(value) }
}

function byteHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

async function verifyIntegrity(record: ParsedRecord): Promise<void> {
  const digestless = structuredClone(record) as ParsedRecord
  delete (digestless.integrity as { digest?: string }).digest
  const actual = byteHex(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(canonicalizeJson(digestless)),
    ),
  )
  if (actual !== record.integrity.digest) {
    throw new QuestionBankImportError(
      'integrity-mismatch',
      'The Question Bank Record integrity digest does not match its content.',
    )
  }
}

const SAFE_PROTOCOLS = new Set(['http:', 'https:'])

function assertSafeUrl(value: string): void {
  try {
    if (SAFE_PROTOCOLS.has(new URL(value).protocol)) return
  } catch {
    // Fall through to the one actionable policy error.
  }
  throw new QuestionBankImportError(
    'unsafe-url',
    `The link “${value}” is unsafe. Question Bank links must use absolute HTTP or HTTPS URLs.`,
  )
}

type DocumentStats = {
  count: number
  depth: number
  mediaReferences: Set<string>
  externalLinks: boolean
}

function inspectDocument(document: SemanticDocument): DocumentStats {
  let count = 0
  let depth = 0
  let externalLinks = false
  const mediaReferences = new Set<string>()
  const visit = (node: SemanticNode, atDepth: number) => {
    count += 1
    depth = Math.max(depth, atDepth)
    for (const mark of node.marks ?? []) {
      if (mark.type === 'link') {
        assertSafeUrl(mark.href)
        externalLinks = true
      }
    }
    if (node.type === 'inline-image' || node.type === 'block-image') {
      const reference = (node as SemanticNode & { asset?: string }).asset
      if (typeof reference !== 'string') {
        throw new QuestionBankImportError(
          'dangling-reference',
          'An image node is missing its Media Asset reference.',
        )
      }
      mediaReferences.add(reference)
    }
    for (const child of node.content ?? []) visit(child, atDepth + 1)
  }
  for (const node of document.content) visit(node, 1)
  return { count, depth, mediaReferences, externalLinks }
}

function validatedBase64Size(value: string): number {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new QuestionBankImportError(
      'invalid-media',
      'A Media Asset contains malformed base64 bytes.',
    )
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return (value.length / 4) * 3 - padding
}

function decodeBase64(value: string): Uint8Array {
  try {
    const binary = atob(value)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    throw new QuestionBankImportError(
      'invalid-media',
      'A Media Asset contains malformed base64 bytes.',
    )
  }
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < 24 || signature.some((byte, index) => bytes[index] !== byte))
    return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) return null
    const marker = bytes[offset + 1]!
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return {
        height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
        width: (bytes[offset + 7]! << 8) | bytes[offset + 8]!,
      }
    }
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!
    if (length < 2) return null
    offset += 2 + length
  }
  return null
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const ascii = (at: number, length: number) =>
    String.fromCharCode(...bytes.slice(at, at + length))
  if (bytes.length < 30 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP')
    return null
  const kind = ascii(12, 4)
  if (kind === 'VP8X') {
    return {
      width: 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16),
      height: 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16),
    }
  }
  if (kind === 'VP8L' && bytes[20] === 0x2f) {
    const bits =
      bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (kind === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff,
      height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff,
    }
  }
  return null
}

function mediaDimensions(
  mimeType: ParsedMediaAsset['mimeType'],
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (mimeType === 'image/png') return pngDimensions(bytes)
  if (mimeType === 'image/jpeg') return jpegDimensions(bytes)
  return webpDimensions(bytes)
}

async function validateSemantics(
  record: ParsedRecord,
  limits: QuestionBankImportLimits,
): Promise<QuestionBankImportProposal['summary']> {
  if (record.requiredFeatures.length > 0) {
    throw new QuestionBankImportError(
      'unsupported-feature',
      `Unsupported required feature: ${record.requiredFeatures.join(', ')}.`,
    )
  }
  if (record.bank.questions.length > limits.questions) {
    throw new QuestionBankImportError(
      'question-count-limit',
      `This record contains more than the ${limits.questions} Question limit.`,
    )
  }
  if (record.media.length > limits.mediaAssets) {
    throw new QuestionBankImportError(
      'media-count-limit',
      `This record contains more than the ${limits.mediaAssets} Media Asset limit.`,
    )
  }

  const ids = new Set<string>()
  const references = new Set<string>()
  const topics = new Set<string>()
  let incompleteMultipleChoice = 0
  let externalLinks = false
  const counts = { 'multiple-choice': 0, 'short-answer': 0 }

  for (const question of record.bank.questions) {
    if (ids.has(question.id)) {
      throw new QuestionBankImportError(
        'duplicate-id',
        `Package-local ID “${question.id}” is duplicated.`,
      )
    }
    ids.add(question.id)
    counts[question.type] += 1
    for (const topic of question.topics ?? []) topics.add(topic)

    if (question.type === 'multiple-choice') {
      if (!question.choices || question.choices.length < 2) {
        throw new QuestionBankImportError(
          'invalid-question',
          `Multiple Choice Question “${question.id}” must have at least two choices.`,
        )
      }
      const correct = question.choices.filter((choice) => choice.correct).length
      if (correct > 1) {
        throw new QuestionBankImportError(
          'invalid-question',
          `Multiple Choice Question “${question.id}” may have at most one correct choice.`,
        )
      }
      if (correct === 0) incompleteMultipleChoice += 1
      if (question.suggestedAnswer !== undefined) {
        throw new QuestionBankImportError(
          'invalid-question',
          `Multiple Choice Question “${question.id}” cannot contain a Suggested Answer.`,
        )
      }
    } else if (question.choices !== undefined) {
      throw new QuestionBankImportError(
        'invalid-question',
        `Short Answer Question “${question.id}” cannot contain choices.`,
      )
    }

    const documents = [
      question.stem,
      ...(question.suggestedAnswer ? [question.suggestedAnswer] : []),
      ...(question.choices?.map((choice) => {
        if (ids.has(choice.id)) {
          throw new QuestionBankImportError(
            'duplicate-id',
            `Package-local ID “${choice.id}” is duplicated.`,
          )
        }
        ids.add(choice.id)
        return choice.content
      }) ?? []),
    ]
    let questionNodes = 0
    for (const document of documents) {
      const stats = inspectDocument(document)
      questionNodes += stats.count
      externalLinks ||= stats.externalLinks
      for (const reference of stats.mediaReferences) references.add(reference)
      if (stats.depth > limits.richTextDepth) {
        throw new QuestionBankImportError(
          'rich-text-depth-limit',
          `Question “${question.id}” exceeds the rich-text nesting depth limit of ${limits.richTextDepth}.`,
        )
      }
    }
    if (questionNodes > limits.questionNodes) {
      throw new QuestionBankImportError(
        'question-node-limit',
        `Question “${question.id}” exceeds the semantic document node limit of ${limits.questionNodes}.`,
      )
    }
  }

  if (record.bank.license?.url) {
    assertSafeUrl(record.bank.license.url)
    externalLinks = true
  }

  let decodedMediaBytes = 0
  const mediaIds = new Set<string>()
  const mediaSizes = new Map<string, number>()
  // Validate declarations and encoded lengths in a cheap pass. No attacker-
  // controlled base64 buffer is allocated until every layered size limit is
  // known to hold.
  for (const asset of record.media) {
    if (mediaIds.has(asset.id)) {
      throw new QuestionBankImportError(
        'duplicate-id',
        `Media Asset declaration “${asset.id}” is duplicated.`,
      )
    }
    mediaIds.add(asset.id)
    if (asset.width > limits.imageWidth || asset.height > limits.imageHeight) {
      throw new QuestionBankImportError(
        'image-dimension-limit',
        `Media Asset “${asset.id}” exceeds the ${limits.imageWidth} by ${limits.imageHeight} pixel limit.`,
      )
    }
    const size = validatedBase64Size(asset.bytes)
    if (size > limits.mediaAssetBytes) {
      throw new QuestionBankImportError(
        'media-asset-size-limit',
        `Media Asset “${asset.id}” exceeds the decoded per-asset limit of ${limits.mediaAssetBytes} bytes.`,
      )
    }
    decodedMediaBytes += size
    if (decodedMediaBytes > limits.totalMediaBytes) {
      throw new QuestionBankImportError(
        'total-media-size-limit',
        `Decoded media exceeds the total limit of ${limits.totalMediaBytes} bytes.`,
      )
    }
    mediaSizes.set(asset.id, size)
  }
  for (const asset of record.media) {
    const bytes = decodeBase64(asset.bytes)
    if (bytes.byteLength !== mediaSizes.get(asset.id)) {
      throw new QuestionBankImportError(
        'invalid-media',
        `Media Asset “${asset.id}” decoded to an unexpected size.`,
      )
    }
    const dimensions = mediaDimensions(asset.mimeType, bytes)
    if (!dimensions) {
      throw new QuestionBankImportError(
        'invalid-media',
        `Media Asset “${asset.id}” does not contain valid ${asset.mimeType} bytes.`,
      )
    }
    if (dimensions.width !== asset.width || dimensions.height !== asset.height) {
      throw new QuestionBankImportError(
        'invalid-media',
        `Media Asset “${asset.id}” decoded dimensions do not match its declaration.`,
      )
    }
    const digest = byteHex(await crypto.subtle.digest('SHA-256', bytes))
    if (asset.id !== `sha256:${digest}`) {
      throw new QuestionBankImportError(
        'invalid-media',
        `Media Asset “${asset.id}” does not match its SHA-256 digest.`,
      )
    }
  }
  for (const reference of references) {
    if (!mediaIds.has(reference)) {
      throw new QuestionBankImportError(
        'dangling-reference',
        `Image reference “${reference}” has no Media Asset declaration.`,
      )
    }
  }
  for (const id of mediaIds) {
    if (!references.has(id)) {
      throw new QuestionBankImportError(
        'invalid-media',
        `Media Asset “${id}” is not referenced by Question Content.`,
      )
    }
  }

  return {
    bankName: record.bank.name,
    questionCounts: counts,
    topics: [...topics].sort((left, right) => left.localeCompare(right)),
    incompleteMultipleChoice,
    mediaAssets: record.media.length,
    decodedMediaBytes,
    externalLinks,
    formatVersion: record.formatVersion,
    integrity: 'verified',
  }
}

export async function inspectQuestionBankRecord(
  bytes: Uint8Array,
  options: { limits?: QuestionBankImportLimits } = {},
): Promise<QuestionBankImportProposal> {
  const limits = options.limits ?? DEFAULT_QUESTION_BANK_IMPORT_LIMITS
  if (bytes.byteLength > limits.recordBytes) {
    throw new QuestionBankImportError(
      'record-size-limit',
      `The decoded canonical JSON attachment exceeds the ${limits.recordBytes} byte limit.`,
    )
  }
  const parsed = structuralParse(decodeJson(bytes))
  // Integrity covers the complete source record, including harmless optional
  // additions. Discard those fields only after corruption has been ruled out.
  await verifyIntegrity(parsed.source)
  const summary = await validateSemantics(parsed.sanitized, limits)
  return { record: parsed.sanitized, summary }
}

export async function inspectQuestionBankFile(
  bytes: Uint8Array,
  options: { limits?: QuestionBankImportLimits } = {},
): Promise<QuestionBankImportProposal> {
  const limits = options.limits ?? DEFAULT_QUESTION_BANK_IMPORT_LIMITS
  if (bytes.byteLength > limits.pdfBytes) {
    throw new QuestionBankImportError(
      'pdf-size-limit',
      `The PDF exceeds the ${limits.pdfBytes} byte limit. Choose a smaller Question Bank File.`,
    )
  }
  let pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs')
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  } catch {
    throw new QuestionBankImportError(
      'invalid-pdf',
      'The selected file is not a valid PDF.',
    )
  }
  const loadingTask = pdfjs.getDocument({ data: bytes.slice() })
  let reader: Awaited<typeof loadingTask.promise>
  try {
    reader = await loadingTask.promise
  } catch {
    throw new QuestionBankImportError(
      'invalid-pdf',
      'The selected file is not a valid PDF.',
    )
  }
  try {
    const attachments = await reader.getAttachments()
    const candidates = attachments
      ? [...attachments.values()].filter(
          (attachment) =>
            attachment.description === QUESTION_BANK_ATTACHMENT_DESCRIPTION,
        )
      : []
    if (candidates.length === 0) {
      throw new QuestionBankImportError(
        'missing-attachment',
        'This PDF has no canonical Question Bank Record. It is preview-only; request the original Question Bank File.',
      )
    }
    if (candidates.length > 1) {
      throw new QuestionBankImportError(
        'ambiguous-attachments',
        'This PDF contains several canonical Question Bank Records, so the application cannot choose one safely.',
      )
    }
    const attachment = candidates[0]!
    const content = await reader.getAttachmentContent(attachment.filename)
    if (!content) {
      throw new QuestionBankImportError(
        'invalid-json',
        'The canonical attachment could not be decoded.',
      )
    }
    if (content.byteLength > limits.recordBytes) {
      throw new QuestionBankImportError(
        'record-size-limit',
        `The decoded canonical JSON attachment exceeds the ${limits.recordBytes} byte limit.`,
      )
    }
    return await inspectQuestionBankRecord(content, { limits })
  } finally {
    await loadingTask.destroy()
  }
}
