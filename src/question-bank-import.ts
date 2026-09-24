import Ajv2020, { type ErrorObject } from 'ajv/dist/2020'
import { DEFAULT_COLUMNS, type Question, type QuestionType } from './exam'
import type { ProseMirrorJSON } from './question-doc'
import questionBankSchema010 from './question-bank-record-0.1.0.schema.json'
import questionBankSchema020 from './question-bank-record-0.2.0.schema.json'
import questionBankSchema030 from './question-bank-record-0.3.0.schema.json'
import questionBankSchema040 from './question-bank-record-0.4.0.schema.json'
import {
  QUESTION_BANK_ATTACHMENT_DESCRIPTION,
  QUESTION_BANK_FORMAT,
  QUESTION_BANK_FORMAT_VERSION,
  RECORD_PART_TYPE_LABELS,
  RECORD_TYPE_LABELS,
  partLetter,
  recordDocumentToEditorNodes,
  type QuestionBankRecord,
  type QuestionBankRecordPart,
  type QuestionBankRecordQuestion,
  type QuestionBankRecordQuestionType,
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
  | 'duplicate-id'
  | 'dangling-reference'
  | 'duplicate-reference'
  | 'invalid-position'
  | 'invalid-answer-order'
  | 'bank-count-limit'
  | 'exam-count-limit'
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

/**
 * One record, parsed. Every supported version parses into the current shape:
 * migration happens in the version's own parser, so everything downstream reads
 * one vocabulary and a new version costs a parser rather than a branch in each
 * reader. `sourceVersion` is what the file actually said, kept because that is
 * what a teacher is told they are importing.
 */
export type ParsedQuestionBankRecord = ParsedRecord

type ParsedRecord = {
  format: typeof QUESTION_BANK_FORMAT
  formatVersion: typeof QUESTION_BANK_FORMAT_VERSION
  sourceVersion: string
  generator: { name: string; version: string }
  requiredFeatures: string[]
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

export type QuestionBankRecordSummary = QuestionBankImportProposal['summary']

export type QuestionBankImportProposal = {
  record: ParsedRecord
  summary: {
    bankName: string
    questionCounts: Record<QuestionBankRecordQuestionType, number>
    topics: string[]
    /** Questions that answer with choices but have none marked correct,
     *  matching sets with an item left unmatched, and Stimuli with no Parts or
     *  with a Multiple Choice Part none of whose choices is correct. That is
     *  conforming — a bank may be shared mid-authoring — so it is reported
     *  rather than refused. */
    questionsWithoutCorrectAnswer: number
    mediaAssets: number
    decodedMediaBytes: number
    externalLinks: boolean
    formatVersion: string
  }
}

/** The local Question Type each record Question Type reads as — the inverse of
 *  the exporter's `RECORD_TYPES`. */
const LOCAL_TYPES: Record<QuestionBankRecordQuestionType, QuestionType> = {
  'multiple-choice': 'multiple-choice',
  'true-false': 'true-false',
  matching: 'matching',
  'short-answer': 'open',
  stimulus: 'stimulus',
}

/** Where each package-local id of one record Question landed locally. */
export type ImportedQuestionIdentity = {
  question: Question
  /** Choice ids for Multiple Choice and True/False; Word Bank ids for
   *  Matching; Part ids and every Part's choice ids for a Stimulus. Answer
   *  order in an Exam Record is written in these. */
  answers: ReadonlyMap<string, string>
}

/** A matching set's editor node: its prompts, then its Word Bank, each given
 *  a fresh local id — and each prompt pointed at its answer's new id, since a
 *  package-local id is only meaningful inside the record. */
function importedMatching(
  question: QuestionBankRecordQuestion,
  createId: () => string,
  answerIds: Map<string, string>,
): ProseMirrorJSON {
  for (const answer of question.wordBank ?? []) answerIds.set(answer.id, createId())
  return {
    type: 'matching',
    content: [
      ...(question.prompts ?? []).map((prompt) => ({
        type: 'matchingPrompt',
        attrs: {
          id: createId(),
          answer: (prompt.answer && answerIds.get(prompt.answer)) || '',
        },
        content: recordDocumentToEditorNodes(prompt.content),
      })),
      ...(question.wordBank ?? []).map((answer) => ({
        type: 'matchingAnswer',
        attrs: { id: answerIds.get(answer.id)! },
        content: recordDocumentToEditorNodes(answer.content),
      })),
    ],
  }
}

/** A Stimulus's Parts box: each Part given a fresh local id, its stem, then
 *  its answer component — a Multiple Choice Part's choices, each with a fresh
 *  id, or a Short Answer Part's Suggested Answer, which stays inside the
 *  document beside the stem it answers, unlike a Short Answer question's. A
 *  Part's answer columns are not in the record, so it starts with the
 *  editor's default, as a new Part does. */
function importedParts(
  parts: readonly QuestionBankRecordPart[],
  createId: () => string,
  answerIds: Map<string, string>,
): ProseMirrorJSON {
  return {
    type: 'stimulusParts',
    content: parts.map((part) => {
      const id = createId()
      answerIds.set(part.id, id)
      return {
        type: 'stimulusPart',
        attrs: { id, columns: DEFAULT_COLUMNS },
        content: [
          { type: 'stimulusPartStem', content: blocksOrBlank(part.stem) },
          part.type === 'multiple-choice'
            ? {
                type: 'multipleChoice',
                content: (part.choices ?? []).map((choice) => {
                  const choiceId = createId()
                  answerIds.set(choice.id, choiceId)
                  return {
                    type: 'multipleChoiceChoice',
                    attrs: { id: choiceId, correct: choice.correct },
                    content: recordDocumentToEditorNodes(choice.content),
                  }
                }),
              }
            : {
                type: 'suggestedAnswer',
                content: part.suggestedAnswer
                  ? blocksOrBlank(part.suggestedAnswer)
                  : [{ type: 'paragraph' }],
              },
        ],
      }
    }),
  }
}

/** A document's blocks, or one empty paragraph for a visibly blank one — a
 *  Part's stem and Suggested Answer each hold at least one block. */
function blocksOrBlank(document: SemanticDocument): ProseMirrorJSON[] {
  const blocks = recordDocumentToEditorNodes(document)
  return blocks.length > 0 ? blocks : [{ type: 'paragraph' }]
}

/** Map a validated portable record into fresh local authoring identities,
 *  keyed by each Question's package-local id so an Exam Record travelling
 *  beside it can be pointed at what was made. */
export function importedQuestionIdentities(
  record: Pick<ParsedRecord, 'bank'>,
  createId: () => string = () => crypto.randomUUID(),
): Map<string, ImportedQuestionIdentity> {
  const imported = new Map<string, ImportedQuestionIdentity>()
  for (const question of record.bank.questions) {
    const stem = recordDocumentToEditorNodes(question.stem)
    const answers = new Map<string, string>()
    const local: Question = {
      id: createId(),
      type: LOCAL_TYPES[question.type],
      columns: 1,
      doc: {
        type: 'doc',
        content:
          question.type === 'matching'
            ? [...stem, importedMatching(question, createId, answers)]
            : question.type === 'stimulus'
              ? [...stem, importedParts(question.parts ?? [], createId, answers)]
              : question.choices
              ? [
                  ...stem,
                  {
                    type: 'multipleChoice',
                    content: question.choices.map((choice) => {
                      const id = createId()
                      answers.set(choice.id, id)
                      return {
                        type: 'multipleChoiceChoice',
                        attrs: { id, correct: choice.correct },
                        content: recordDocumentToEditorNodes(choice.content),
                      }
                    }),
                  },
                ]
              : stem,
      },
      ...(question.difficulty ? { difficulty: question.difficulty } : {}),
      ...(question.topics ? { topics: [...question.topics] } : {}),
      ...(question.suggestedAnswer
        ? {
            suggestedAnswer: {
              type: 'doc',
              content: recordDocumentToEditorNodes(question.suggestedAnswer),
            },
          }
        : {}),
    }
    imported.set(question.id, { question: local, answers })
  }
  return imported
}

/** Map a validated portable record into fresh local authoring identities. */
export function importedQuestionsFromRecord(
  record: Pick<ParsedRecord, 'bank'>,
  createId: () => string = () => crypto.randomUUID(),
): Question[] {
  return [...importedQuestionIdentities(record, createId).values()].map(
    ({ question }) => question,
  )
}

type Parser = (value: unknown) => ParsedRecord

const ajv = new Ajv2020({ allErrors: true, strict: false })
const validate010 = ajv.compile(questionBankSchema010)
const validate020 = ajv.compile(questionBankSchema020)
const validate030 = ajv.compile(questionBankSchema030)
const validate040 = ajv.compile(questionBankSchema040)

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
    ...(question.prompts !== undefined
      ? {
          prompts: question.prompts.map((prompt) => ({
            id: prompt.id,
            content: copyDocument(prompt.content),
            ...(prompt.answer !== undefined ? { answer: prompt.answer } : {}),
          })),
        }
      : {}),
    ...(question.wordBank !== undefined
      ? {
          wordBank: question.wordBank.map((answer) => ({
            id: answer.id,
            content: copyDocument(answer.content),
          })),
        }
      : {}),
    ...(question.parts !== undefined
      ? {
          parts: question.parts.map((part) => ({
            id: part.id,
            type: part.type,
            stem: copyDocument(part.stem),
            ...(part.choices !== undefined
              ? {
                  choices: part.choices.map((choice) => ({
                    id: choice.id,
                    content: copyDocument(choice.content),
                    correct: choice.correct,
                  })),
                }
              : {}),
            ...(part.suggestedAnswer !== undefined
              ? { suggestedAnswer: copyDocument(part.suggestedAnswer) }
              : {}),
          })),
        }
      : {}),
    ...(question.suggestedAnswer !== undefined
      ? { suggestedAnswer: copyDocument(question.suggestedAnswer) }
      : {}),
  }
}

type SchemaValidator = (value: unknown) => boolean

/**
 * Structural validation against one version's schema, then the same copy into
 * the parsed shape. Versions differ in what their schema admits, not in how a
 * conforming record is read, so both parsers share this and each supplies its
 * own validator.
 *
 * The unsafe-link case is lifted out of the generic structural failure because
 * a bad `href` is the one schema violation a teacher can act on: it names the
 * link rather than a JSON pointer.
 */
function parseWith(
  validate: SchemaValidator & { errors?: ErrorObject[] | null },
  sourceVersion: string,
  value: unknown,
): ParsedRecord {
  if (!validate(value)) {
    const unsafeLink = validate.errors?.find(
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
      schemaMessage(validate.errors),
    )
  }
  const record = value as QuestionBankRecord & {
    bank: ParsedRecord['bank']
    media: ParsedMediaAsset[]
  }
  return {
    format: QUESTION_BANK_FORMAT,
    formatVersion: QUESTION_BANK_FORMAT_VERSION,
    sourceVersion,
    generator: {
      name: record.generator.name,
      version: record.generator.version,
    },
    requiredFeatures: [...record.requiredFeatures],
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

/**
 * Every retained version migrates forward without rewriting anything. 0.2.0
 * added `true-false` to 0.1.0, 0.3.0 added `matching` to 0.2.0, and 0.4.0
 * added `stimulus` to 0.3.0; none can appear in an older record, and no
 * version changed anything an older record already says — so a record that
 * satisfies an older schema is already a conforming 0.4.0 record once its
 * version is restated.
 */
const parser010: Parser = (value) => parseWith(validate010, '0.1.0', value)

const parser020: Parser = (value) => parseWith(validate020, '0.2.0', value)

const parser030: Parser = (value) => parseWith(validate030, '0.3.0', value)

const parser040: Parser = (value) => parseWith(validate040, '0.4.0', value)

/** Exact versions only: adding compatibility requires adding an explicit parser or migration. */
export const SUPPORTED_QUESTION_BANK_VERSIONS: Readonly<Record<string, Parser>> =
  Object.freeze({
    '0.1.0': parser010,
    '0.2.0': parser020,
    '0.3.0': parser030,
    '0.4.0': parser040,
  })

const utf8 = new TextDecoder('utf-8', { fatal: true })

export function decodeRecordJson(bytes: Uint8Array): unknown {
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

function structuralParse(value: unknown): ParsedRecord {
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
  return parser(value)
}

function byteHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
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
  let questionsWithoutCorrectAnswer = 0
  let externalLinks = false
  const counts: Record<QuestionBankRecordQuestionType, number> = {
    'multiple-choice': 0,
    'true-false': 0,
    matching: 0,
    'short-answer': 0,
    stimulus: 0,
  }

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

    if (question.type !== 'matching' && (question.prompts !== undefined || question.wordBank !== undefined)) {
      throw new QuestionBankImportError(
        'invalid-question',
        `${RECORD_TYPE_LABELS[question.type]} Question “${question.id}” cannot contain matching items or a Word Bank.`,
      )
    }
    if (question.type !== 'stimulus' && question.parts !== undefined) {
      throw new QuestionBankImportError(
        'invalid-question',
        `${RECORD_TYPE_LABELS[question.type]} Question “${question.id}” cannot contain Stimulus Parts.`,
      )
    }
    if (question.type === 'stimulus') {
      // The Stimulus answers nothing itself: every answer belongs to a Part,
      // and a Part obeys the rules of the Question Type it is named for. A
      // Stimulus with no Parts, or with a Multiple Choice Part none of whose
      // choices is correct, is incomplete — conforming, but reported.
      if (question.choices !== undefined || question.suggestedAnswer !== undefined) {
        throw new QuestionBankImportError(
          'invalid-question',
          `Stimulus Question “${question.id}” cannot contain choices or a Suggested Answer of its own; each Part carries its own.`,
        )
      }
      const parts = question.parts ?? []
      let incomplete = parts.length === 0
      parts.forEach((part, partIndex) => {
        const where = `Part ${partLetter(partIndex)} (“${part.id}”) of Stimulus Question “${question.id}”`
        const label = RECORD_PART_TYPE_LABELS[part.type]
        if (part.type === 'short-answer') {
          if (part.choices !== undefined) {
            throw new QuestionBankImportError(
              'invalid-question',
              `${where} is ${label} and cannot contain choices.`,
            )
          }
          return
        }
        if (!part.choices || part.choices.length < 2) {
          throw new QuestionBankImportError(
            'invalid-question',
            `${where} is ${label} and must have at least two choices.`,
          )
        }
        const correct = part.choices.filter((choice) => choice.correct).length
        if (correct > 1) {
          throw new QuestionBankImportError(
            'invalid-question',
            `${where} is ${label} and may have at most one correct choice.`,
          )
        }
        if (correct === 0) incomplete = true
        if (part.suggestedAnswer !== undefined) {
          throw new QuestionBankImportError(
            'invalid-question',
            `${where} is ${label} and cannot contain a Suggested Answer.`,
          )
        }
      })
      if (incomplete) questionsWithoutCorrectAnswer += 1
    } else if (question.type === 'short-answer') {
      if (question.choices !== undefined) {
        throw new QuestionBankImportError(
          'invalid-question',
          `Short Answer Question “${question.id}” cannot contain choices.`,
        )
      }
    } else if (question.type === 'matching') {
      // A matching set answers by naming: every item's answer must be one of
      // the set's own Word Bank answers. Several items may name the same
      // answer, an answer nobody names is a distractor, and an item that
      // names nothing is unmatched — conforming, but reported.
      if (question.choices !== undefined || question.suggestedAnswer !== undefined) {
        throw new QuestionBankImportError(
          'invalid-question',
          `Matching Question “${question.id}” cannot contain choices or a Suggested Answer.`,
        )
      }
      if (!question.prompts || question.prompts.length < 1) {
        throw new QuestionBankImportError(
          'invalid-question',
          `Matching Question “${question.id}” must have at least one item to match.`,
        )
      }
      if (!question.wordBank || question.wordBank.length < 2) {
        throw new QuestionBankImportError(
          'invalid-question',
          `Matching Question “${question.id}” must have at least two Word Bank answers.`,
        )
      }
      const bankIds = new Set(question.wordBank.map((answer) => answer.id))
      let unmatched = false
      for (const prompt of question.prompts) {
        if (prompt.answer === undefined) {
          unmatched = true
        } else if (!bankIds.has(prompt.answer)) {
          throw new QuestionBankImportError(
            'dangling-reference',
            `Matching item “${prompt.id}” names answer “${prompt.answer}”, which is not in its Word Bank.`,
          )
        }
      }
      if (unmatched) questionsWithoutCorrectAnswer += 1
    } else {
      // Multiple Choice and True/False both answer with choices, and the same
      // three rules govern both: enough answers to choose between, at most one
      // of them correct, and no Suggested Answer — that is what the choices are.
      const label = RECORD_TYPE_LABELS[question.type]
      if (!question.choices || question.choices.length < 2) {
        throw new QuestionBankImportError(
          'invalid-question',
          `${label} Question “${question.id}” must have at least two choices.`,
        )
      }
      if (question.type === 'true-false' && question.choices.length !== 2) {
        throw new QuestionBankImportError(
          'invalid-question',
          `True/False Question “${question.id}” must have exactly two choices.`,
        )
      }
      const correct = question.choices.filter((choice) => choice.correct).length
      if (correct > 1) {
        throw new QuestionBankImportError(
          'invalid-question',
          `${label} Question “${question.id}” may have at most one correct choice.`,
        )
      }
      if (correct === 0) questionsWithoutCorrectAnswer += 1
      if (question.suggestedAnswer !== undefined) {
        throw new QuestionBankImportError(
          'invalid-question',
          `${label} Question “${question.id}” cannot contain a Suggested Answer.`,
        )
      }
    }

    const claimed = (part: { id: string; content: SemanticDocument }) => {
      if (ids.has(part.id)) {
        throw new QuestionBankImportError(
          'duplicate-id',
          `Package-local ID “${part.id}” is duplicated.`,
        )
      }
      ids.add(part.id)
      return part.content
    }
    // A Stimulus Part claims its own id, then brings its stem, its choices
    // and its Suggested Answer under the Question's node and depth limits:
    // the limits bound the whole Question, however it is divided.
    const partDocuments = (part: QuestionBankRecordPart): SemanticDocument[] => [
      claimed({ id: part.id, content: part.stem }),
      ...(part.choices?.map(claimed) ?? []),
      ...(part.suggestedAnswer ? [part.suggestedAnswer] : []),
    ]
    const documents = [
      question.stem,
      ...(question.suggestedAnswer ? [question.suggestedAnswer] : []),
      ...(question.choices?.map(claimed) ?? []),
      ...(question.prompts?.map(claimed) ?? []),
      ...(question.wordBank?.map(claimed) ?? []),
      ...(question.parts?.flatMap(partDocuments) ?? []),
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
    questionsWithoutCorrectAnswer,
    mediaAssets: record.media.length,
    decodedMediaBytes,
    externalLinks,
    formatVersion: record.sourceVersion,
  }
}

/** One Question Bank Record already decoded from JSON, checked against its
 *  version's schema and every semantic rule and limit. A package inspects each
 *  of its banks through this, so a bank inside a package obeys exactly the
 *  rules a bare one does. */
export async function inspectQuestionBankRecordValue(
  value: unknown,
  limits: QuestionBankImportLimits = DEFAULT_QUESTION_BANK_IMPORT_LIMITS,
): Promise<QuestionBankImportProposal> {
  const record = structuralParse(value)
  const summary = await validateSemantics(record, limits)
  return { record, summary }
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
  return inspectQuestionBankRecordValue(decodeRecordJson(bytes), limits)
}

export async function inspectQuestionBankFile(
  bytes: Uint8Array,
  options: { limits?: QuestionBankImportLimits } = {},
): Promise<QuestionBankImportProposal> {
  const limits = options.limits ?? DEFAULT_QUESTION_BANK_IMPORT_LIMITS
  return inspectQuestionBankRecord(await readCanonicalAttachment(bytes, limits), { limits })
}

/** The bytes of the one `pdf-canonical-extraction` attachment a Test Parrot
 *  PDF carries — a Question Bank File's Question Bank Record, or an Exam PDF's
 *  Test Parrot Package. What those bytes are is for the caller to read. */
export async function readCanonicalAttachment(
  bytes: Uint8Array,
  limits: QuestionBankImportLimits = DEFAULT_QUESTION_BANK_IMPORT_LIMITS,
): Promise<Uint8Array> {
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
        'This PDF was not exported from Test Parrot, so there is no Question Bank inside it to import.',
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
    return content
  } finally {
    await loadingTask.destroy()
  }
}
