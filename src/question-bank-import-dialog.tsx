import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, Copy, FileText, Library, UploadCloud, type LucideIcon } from 'lucide-react'
import { DocView } from './doc-view'
import extractInstructions from '../public/extract.md?raw'
import {
  RECORD_TYPE_LABELS,
  RECORD_TYPE_ORDER,
  recordDocumentToEditorNodes,
  wordBankLettersOf,
  type SemanticDocument,
} from './question-bank-export'
import { DifficultyBadge, TopicBadge } from './badges'
import type { Difficulty, Question } from './exam'
import type { ProseMirrorJSON } from './question-doc'
import type { ImportProposal, ProposedBank, ProposedExam } from './package-import'
import {
  deniedBanksOf,
  hasAllowedItems,
  importActionLabel,
  importCounts,
  initialSelection,
  setBankAllowed,
  setBankTarget,
  setExamAllowed,
  type ImportSelection,
} from './import-selection'
import { selectedExam } from './selected-exam'
import { planExport, type LayoutPlan } from './export-plan'
import { domMeasure } from './dom-measure'
import { ExportPreview } from './exam-page'
import { inspectUploadedFile, needsConversion as fileNeedsConversion } from './question-bank-upload'
import { useModalScrollLock } from './use-modal-scroll-lock'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const plural = (count: number, singular: string) =>
  `${count} ${count === 1 ? singular : `${singular}s`}`

/**
 * The two kinds of thing a file can bring in, each with one icon and one
 * colour used wherever the dialog names it — the count beside the title and
 * every tab — so a tab is recognisably a bank or a Test before it is read.
 * An Exam is called a Test here: it is the word for the file in a teacher's
 * hand. The icons are the ones the sidebar gives each section.
 */
const KINDS = {
  bank: { Icon: Library, noun: 'Question Bank' },
  exam: { Icon: FileText, noun: 'Test' },
} satisfies Record<string, { Icon: LucideIcon; noun: string }>
type Kind = keyof typeof KINDS

function KindBadge({ kind, count }: { kind: Kind; count: number }) {
  const { Icon, noun } = KINDS[kind]
  return <span className="badge bank-import-kind" data-kind={kind}>
    <Icon aria-hidden="true" />
    {plural(count, noun)}
  </span>
}

/**
 * Point a preview document's images at the bytes the file carries.
 *
 * `recordDocumentToEditorNodes` addresses an image as `/local-images/<hash>`,
 * which resolves only for media that already lives here. Nothing has been
 * imported yet, so the preview would draw every image broken; the file's own
 * Media Assets are the only copy that exists, and they are already base64.
 */
function resolveMedia(
  node: ProseMirrorJSON,
  sources: ReadonlyMap<string, string>,
): ProseMirrorJSON {
  const attrs = node.attrs as Record<string, unknown> | null | undefined
  const resolved =
    attrs && typeof attrs.src === 'string' ? sources.get(attrs.src) : undefined
  return {
    ...node,
    ...(resolved ? { attrs: { ...attrs, src: resolved } } : {}),
    ...(Array.isArray(node.content)
      ? {
          content: (node.content as ProseMirrorJSON[]).map((child) =>
            resolveMedia(child, sources),
          ),
        }
      : {}),
  }
}

function mediaSources(proposal: ImportProposal): Map<string, string> {
  const sources = new Map<string, string>()
  for (const bank of proposal.banks) {
    for (const asset of bank.record.media) {
      sources.set(
        `/local-images/${asset.id.slice('sha256:'.length)}`,
        `data:${asset.mimeType};base64,${asset.bytes}`,
      )
    }
  }
  return sources
}

/**
 * The student test an Exam would print, laid out by the same Layout Plan the
 * export uses. It is built the way the import will build the Exam — through
 * the same plan — so what is previewed is what arrives.
 */
async function examPreviewPlan(
  proposal: ImportProposal,
  examKey: string,
  sources: ReadonlyMap<string, string>,
): Promise<LayoutPlan | null> {
  // Loaded on demand, like the importer: it brings the record parsers.
  const { planImport } = await import('./package-commit')
  let next = 0
  const plan = planImport(proposal, initialSelection(proposal), () => `preview-${next++}`)
  const planned = plan.exams.find(({ source }) => source === examKey)
  if (!planned || planned.saved.workingCopy.questionIds.length === 0) return null
  const resolve = (question: Question): Question => ({
    ...question,
    doc: resolveMedia(question.doc, sources),
  })
  const { exam, arrangement } = selectedExam(
    { questions: planned.saved.questionBank.questions.map(resolve) },
    planned.saved.workingCopy,
  )
  return planExport({
    exam,
    arrangement,
    selection: { test: true, answerKey: false },
    measure: domMeasure,
  })
}

/** A bank read as a document: its questions on a sheet, like the Test pages
 *  beside it, so both previews are paper on the same ground. */
function BankPreview({
  bank,
  previewDocument,
}: {
  bank: ProposedBank
  previewDocument: (document: SemanticDocument) => ProseMirrorJSON[]
}) {
  const { record } = bank
  const questions = record.bank.questions
  return <div className="bank-import-paper">
    <header className="bank-import-preview-head">
      <h3>{record.bank.name || 'Untitled Question Bank'}</h3>
      <p>{plural(questions.length, 'Question')}</p>
      {record.bank.description && (
        <p className="bank-import-preview-description">{record.bank.description}</p>
      )}
    </header>
    {questions.map((question, index) => (
      <article key={question.id} className="bank-import-question">
        <div className="bank-import-question-head">
          <span className="bank-import-question-number">{index + 1}</span>
          <span className="bank-import-question-type">{RECORD_TYPE_LABELS[question.type]}</span>
          {question.difficulty && <DifficultyBadge difficulty={question.difficulty as Difficulty} />}
          {question.topics?.map((topic) => <TopicBadge key={topic} topic={topic} />)}
        </div>
        <DocView className="bank-import-stem" content={previewDocument(question.stem)} />
        {question.choices && (
          <ol type="A" className="bank-import-choices">
            {question.choices.map((choice) => (
              <li key={choice.id} className={choice.correct ? 'is-correct' : undefined}>
                <DocView content={previewDocument(choice.content)} />
                {choice.correct && (
                  <Check className="bank-import-correct" role="img" aria-label="Correct answer" />
                )}
              </li>
            ))}
          </ol>
        )}
        {question.prompts && question.wordBank && (
          <div className="record-matching bank-import-matching">
            <ol className="record-matching-items">
              {question.prompts.map((prompt) => (
                <li key={prompt.id}>
                  <span
                    className="record-matching-blank"
                    aria-label={prompt.answer ? 'Matched answer' : 'Unmatched'}
                  >
                    {wordBankLettersOf(question).get(prompt.answer ?? '') ?? '—'}
                  </span>
                  <DocView content={previewDocument(prompt.content)} />
                </li>
              ))}
            </ol>
            <ol type="A" className="bank-import-choices">
              {question.wordBank.map((answer) => (
                <li key={answer.id}>
                  <DocView content={previewDocument(answer.content)} />
                </li>
              ))}
            </ol>
          </div>
        )}
        {question.suggestedAnswer && (
          <section className="bank-import-answer">
            <h4>Suggested Answer</h4>
            <DocView content={previewDocument(question.suggestedAnswer)} />
          </section>
        )}
      </article>
    ))}
  </div>
}

function ExamPreview({
  proposal,
  exam,
  sources,
}: {
  proposal: ImportProposal
  exam: ProposedExam
  sources: ReadonlyMap<string, string>
}) {
  const [plan, setPlan] = useState<LayoutPlan | null | 'loading'>('loading')
  useEffect(() => {
    let current = true
    setPlan('loading')
    examPreviewPlan(proposal, exam.key, sources)
      .catch(() => null)
      .then((next) => { if (current) setPlan(next) })
    return () => { current = false }
  }, [proposal, exam.key, sources])
  return plan === 'loading'
    ? <p className="bank-import-empty" role="status">Laying out pages…</p>
    : plan
    ? <div className="bank-import-exam-pages" aria-label={`${exam.name || 'Untitled Test'} pages`}>
        <ExportPreview plan={plan} />
      </div>
    : <p className="bank-import-empty">This Test has no Questions yet.</p>
}

/** One bank's facts, in the rows the Question Bank import has always shown. */
function BankSummary({ bank }: { bank: ProposedBank }) {
  const { record, summary } = bank
  return <>
    <dl className="bank-import-summary">
      {RECORD_TYPE_ORDER.map((type) => (
        <div key={type}>
          <dt>{RECORD_TYPE_LABELS[type]}</dt>
          <dd>{summary.questionCounts[type]}</dd>
        </div>
      ))}
      {summary.questionsWithoutCorrectAnswer > 0 && (
        <div className="is-warning">
          <dt>No correct answer marked</dt>
          <dd>{summary.questionsWithoutCorrectAnswer}</dd>
        </div>
      )}
      <div>
        <dt>Media Assets</dt>
        <dd>
          {summary.mediaAssets}
          {summary.mediaAssets > 0 && <small>{formatBytes(summary.decodedMediaBytes)}</small>}
        </dd>
      </div>
      <div>
        <dt>External links</dt>
        <dd>{summary.externalLinks ? 'Present' : 'None'}</dd>
      </div>
      <div>
        <dt>Format version</dt>
        <dd>{summary.formatVersion}</dd>
      </div>
    </dl>
    {summary.topics.length > 0 && (
      <div className="bank-import-topics">
        <h4>Topics</h4>
        <div>{summary.topics.map((topic) => <TopicBadge key={topic} topic={topic} />)}</div>
      </div>
    )}
    {(record.bank.author || record.bank.license) && (
      <dl className="bank-import-provenance">
        {record.bank.author && (
          <div>
            <dt>Declared author (unverified)</dt>
            <dd>{record.bank.author}</dd>
          </div>
        )}
        {record.bank.license && (
          <div>
            <dt>License</dt>
            <dd>
              {record.bank.license.name}
              {record.bank.license.url ? ` — ${record.bank.license.url}` : ''}
            </dd>
          </div>
        )}
      </dl>
    )}
  </>
}

type Focus = { kind: 'bank'; id: string } | { kind: 'exam'; key: string }

/** A way to another tab from inside a panel: a Test's banks, a bank's Tests. */
function TabLink({
  kind,
  name,
  detail,
  onShow,
}: {
  kind: Kind
  name: string
  detail?: string
  onShow: () => void
}) {
  const { Icon } = KINDS[kind]
  return <button type="button" className="bank-import-link" data-kind={kind} onClick={onShow}>
    <Icon aria-hidden="true" />
    <span>{name}</span>
    {detail && <small>{detail}</small>}
  </button>
}

const focusKey = (focus: Focus) => (focus.kind === 'bank' ? `bank:${focus.id}` : `exam:${focus.key}`)

export function QuestionBankImportDialog({
  onClose,
  onImport,
  initialFile,
  targetBankId,
  loadBanks,
}: {
  onClose: () => void
  onImport: (proposal: ImportProposal, selection: ImportSelection) => Promise<void>
  /** A file already chosen elsewhere — dropped onto the page — inspected as
   *  soon as the dialog opens rather than asked for again. */
  initialFile?: File
  /** The bank the import was started from, which every bank in the file
   *  defaults to adding into. */
  targetBankId?: string
  /** The banks on this device, for “Add to an existing one”. */
  loadBanks: () => Promise<readonly { id: string; name: string }[]>
}) {
  const titleId = useId()
  const tabsId = useId()
  const dialog = useRef<HTMLElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [proposal, setProposal] = useState<ImportProposal | null>(null)
  const [selection, setSelection] = useState<ImportSelection | null>(null)
  /** Each bank's name for “Create new question bank”, kept while the target
   *  is switched to an existing bank and back. */
  const [names, setNames] = useState<Record<string, string>>({})
  const [focus, setFocus] = useState<Focus | null>(null)
  const [existingBanks, setExistingBanks] = useState<readonly { id: string; name: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  // A file this app cannot read at all — a scan, a screenshot, a PDF that
  // did not come from here — is not a broken import, it is a test that has
  // not been converted yet. That failure is answered with the way to convert
  // it rather than with a reading of what went wrong.
  const [needsConversion, setNeedsConversion] = useState(false)
  const [phase, setPhase] = useState<'choose' | 'inspecting' | 'saving'>('choose')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])
  const busy = phase !== 'choose'
  const busyRef = useRef(busy)
  busyRef.current = busy
  useModalScrollLock()

  useEffect(() => {
    let current = true
    void loadBanks().then((banks) => { if (current) setExistingBanks(banks) }, () => undefined)
    return () => { current = false }
  }, [loadBanks])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    requestAnimationFrame(() => input.current?.focus())
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const controls = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), select:not(:disabled)',
        ) ?? [],
      )
      if (!controls.length) return
      const first = controls[0]!
      const last = controls.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      requestAnimationFrame(() => {
        if (previous?.isConnected) previous.focus()
      })
    }
  }, [onClose])

  useEffect(() => {
    if (error && phase === 'choose') input.current?.focus()
  }, [error, phase])

  // The file control has gone with the choose step, taking focus with it. A
  // bank opens with its name ready to edit; a Test opens on its own tab.
  useEffect(() => {
    if (!proposal) return
    requestAnimationFrame(() => {
      if (dialog.current?.contains(document.activeElement)) return
      dialog.current
        ?.querySelector<HTMLElement>('.bank-import-target-name, [role="tab"][aria-selected="true"]')
        ?.focus()
    })
  }, [proposal])

  const inspect = (file: File) => {
    setPhase('inspecting')
    setProposal(null)
    setError(null)
    setNeedsConversion(false)
    void inspectUploadedFile(file)
      .then((next) => {
        setProposal(next)
        setSelection(initialSelection(next, targetBankId ? { targetBankId } : {}))
        setNames(Object.fromEntries(next.banks.map((bank) => [bank.id, bank.record.bank.name])))
        // A Test is what a teacher converting a test came for, so it is what
        // the preview opens on when there is one.
        setFocus(next.exams[0] ? { kind: 'exam', key: next.exams[0].key } : { kind: 'bank', id: next.banks[0]!.id })
      })
      .catch((reason) => {
        setNeedsConversion(fileNeedsConversion(reason))
        setError(
          reason instanceof Error && reason.message
            ? reason.message
            : 'This file could not be inspected safely.',
        )
        setPhase('choose')
      })
      .then(() => setPhase('choose'))
  }

  const inspectOnOpen = useRef(initialFile)
  useEffect(() => {
    const file = inspectOnOpen.current
    inspectOnOpen.current = undefined
    // Deliberately once, for the file the dialog was opened with. A later drop
    // opens the dialog again with a fresh key rather than mutating this one.
    if (file) inspect(file)
  }, [])

  const sources = useMemo(() => (proposal ? mediaSources(proposal) : new Map<string, string>()), [proposal])
  const previewDocument = useMemo(
    () => (document: SemanticDocument) =>
      recordDocumentToEditorNodes(document).map((node) => resolveMedia(node, sources)),
    [sources],
  )

  const bankName = (id: string) => {
    const bank = proposal?.banks.find((item) => item.id === id)
    return bank?.record.bank.name || 'Untitled Question Bank'
  }
  const examName = (key: string) =>
    proposal?.exams.find((item) => item.key === key)?.name || 'Untitled Test'

  const counts = proposal && selection ? importCounts(proposal, selection) : null
  const importable = selection ? hasAllowedItems(selection) : false

  const confirm = async () => {
    if (!proposal || !selection || busy || !importable) return
    setPhase('saving')
    setError(null)
    try {
      await onImport(proposal, selection)
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message
          ? `Nothing was imported: ${reason.message}`
          : 'Nothing was imported. Check browser storage and try again.',
      )
      setPhase('choose')
    }
  }

  const focusedBank = focus?.kind === 'bank' ? proposal?.banks.find(({ id }) => id === focus.id) : undefined
  const focusedExam = focus?.kind === 'exam' ? proposal?.exams.find(({ key }) => key === focus.key) : undefined

  /** Every bank then every Test, in file order: the tabs, and the order the
   *  arrow keys walk them in. */
  const tabs: { focus: Focus; kind: Kind; name: string; allowed: boolean }[] = proposal && selection
    ? [
        ...proposal.banks.map((bank) => ({
          focus: { kind: 'bank', id: bank.id } as Focus,
          kind: 'bank' as const,
          name: bank.record.bank.name || 'Untitled Question Bank',
          allowed: selection.banks[bank.id]!.allowed,
        })),
        ...proposal.exams.map((exam) => ({
          focus: { kind: 'exam', key: exam.key } as Focus,
          kind: 'exam' as const,
          name: exam.name || 'Untitled Test',
          allowed: selection.exams[exam.key]!.allowed,
        })),
      ]
    : []
  const tabId = (item: Focus) => `${tabsId}-${focusKey(item)}`
  const selectedIndex = focus ? tabs.findIndex((tab) => focusKey(tab.focus) === focusKey(focus)) : -1
  const showTab = (next: Focus, moveFocus = false) => {
    setFocus(next)
    if (moveFocus) requestAnimationFrame(() => document.getElementById(tabId(next))?.focus())
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialog}
        className={[
          'bank-import-dialog',
          proposal ? 'bank-import-dialog--review' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
      >
        <header className="dialog-header bank-import-header">
          <div className="bank-import-heading">
            <h2 id={titleId}>Import</h2>
            {counts && <ul className="bank-import-kinds" aria-label="Being imported">
              {counts.banks > 0 && <li><KindBadge kind="bank" count={counts.banks} /></li>}
              {counts.exams > 0 && <li><KindBadge kind="exam" count={counts.exams} /></li>}
            </ul>}
          </div>
          {tabs.length > 0 && <div
            className="bank-import-tabs"
            role="tablist"
            aria-label="In this file"
            onKeyDown={(event) => {
              const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
              const index = event.key === 'Home' ? 0
                : event.key === 'End' ? tabs.length - 1
                : step ? (selectedIndex + step + tabs.length) % tabs.length
                : -1
              if (index < 0) return
              event.preventDefault()
              showTab(tabs[index]!.focus, true)
            }}
          >
            {tabs.map((tab, index) => {
              const { Icon, noun } = KINDS[tab.kind]
              const selected = index === selectedIndex
              return <button
                key={focusKey(tab.focus)}
                id={tabId(tab.focus)}
                type="button"
                role="tab"
                className="bank-import-tab"
                data-kind={tab.kind}
                data-allowed={tab.allowed ? 'true' : 'false'}
                aria-selected={selected}
                aria-controls={`${tabsId}-panel`}
                aria-label={`${noun} ${tab.name}${tab.allowed ? '' : ', not imported'}`}
                title={tab.name}
                tabIndex={selected ? 0 : -1}
                onClick={() => showTab(tab.focus)}
              >
                <Icon aria-hidden="true" />
                <span>{tab.name}</span>
              </button>
            })}
          </div>}
        </header>

        {!proposal && (
          <div className="bank-import-choose">
            {/* The whole dashed zone is the file control: dropping on it lands
                in the window-level drop target, clicking it opens the picker,
                and the input itself stays in the tab order under the zone. */}
            <label className="bank-import-drop">
              <input
                ref={input}
                type="file"
                aria-label="Test Parrot PDF or JSON file"
                accept="application/pdf,.pdf,application/json,.json"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  // Cleared so that choosing the same file after an error, or
                  // after backing out of a review, is still a change event.
                  event.target.value = ''
                  if (file) inspect(file)
                }}
              />
              <UploadCloud aria-hidden="true" />
              <strong>Test Parrot PDF or JSON file</strong>
              <span>A Question Bank or Test PDF, or a <code>.parrot.json</code> file</span>
              <span>Drop it here or click to choose one</span>
            </label>
            <div
              className="bank-import-assist"
              data-emphasis={needsConversion ? 'true' : undefined}
              role={needsConversion ? 'alert' : undefined}
            >
              <span>
                {needsConversion ? (
                  <>
                    <strong>That file isn’t a Test Parrot file yet.</strong>{' '}
                    Copy these instructions and give them to an AI along with
                    your test — as a PDF, scan or screenshot — and it will
                    produce a file with your questions and the test itself,
                    ready to drop here.
                  </>
                ) : (
                  <>
                    Already have a test? Copy these instructions for an AI to
                    turn any PDF or screenshot into a file with your questions
                    and the test itself, ready to import here.
                  </>
                )}
              </span>
              <button
                type="button"
                className={needsConversion ? 'primary-button' : 'secondary-button'}
                disabled={busy}
                onClick={() => {
                  void navigator.clipboard.writeText(extractInstructions).then(() => setCopied(true))
                }}
              >
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy instructions'}
              </button>
            </div>
          </div>
        )}

        <div
          className="bank-import-announcements"
          aria-live="polite"
          aria-atomic="true"
        >
          {phase === 'inspecting' && <p role="status">Validating file…</p>}
          {phase === 'saving' && <p role="status">Importing…</p>}
          {error && !needsConversion && <p className="home-error" role="alert">{error}</p>}
        </div>

        {proposal && selection && focus && (
          <section
            id={`${tabsId}-panel`}
            className="bank-import-body"
            role="tabpanel"
            aria-labelledby={tabId(focus)}
          >
            <div
              className="bank-import-preview"
              aria-label={focusedExam ? 'Test preview' : 'Question Bank preview'}
            >
              {focusedBank && <BankPreview bank={focusedBank} previewDocument={previewDocument} />}
              {focusedExam && <ExamPreview proposal={proposal} exam={focusedExam} sources={sources} />}
            </div>

            {focusedBank && (() => {
              const bank = focusedBank
              const chosen = selection.banks[bank.id]!
              const name = bank.record.bank.name || 'Untitled Question Bank'
              const targetName = names[bank.id] ?? ''
              const fallbackExisting = targetBankId ?? existingBanks[0]?.id
              return <aside
                className="bank-import-controls"
                data-allowed={chosen.allowed ? 'true' : 'false'}
                aria-label={`Question Bank ${name}`}
              >
                <label className="bank-import-allow">
                  <input
                    type="checkbox"
                    checked={chosen.allowed}
                    disabled={busy}
                    onChange={(event) => setSelection(setBankAllowed(proposal, selection, bank.id, event.target.checked))}
                  />
                  <span>Import this Question Bank</span>
                </label>
                {chosen.allowed && <fieldset className="bank-import-target" disabled={busy}>
                  <legend className="sr-only">Where {name} goes</legend>
                  <label>
                    <input
                      type="radio"
                      name={`target-${bank.id}`}
                      checked={chosen.target.kind === 'new'}
                      onChange={() => setSelection(setBankTarget(selection, bank.id, { kind: 'new', name: targetName }))}
                    />
                    <span>Create new question bank</span>
                  </label>
                  {chosen.target.kind === 'new' && <input
                    className="bank-import-target-name"
                    aria-label={`New Question Bank name for ${name}`}
                    value={targetName}
                    onChange={(event) => {
                      setNames({ ...names, [bank.id]: event.target.value })
                      setSelection(setBankTarget(selection, bank.id, { kind: 'new', name: event.target.value }))
                    }}
                  />}
                  <label>
                    <input
                      type="radio"
                      name={`target-${bank.id}`}
                      checked={chosen.target.kind === 'existing'}
                      disabled={!fallbackExisting}
                      onChange={() => fallbackExisting && setSelection(setBankTarget(selection, bank.id, { kind: 'existing', bankId: fallbackExisting }))}
                    />
                    <span>Add to an existing one</span>
                  </label>
                  {chosen.target.kind === 'existing' && <select
                    className="bank-import-target-bank"
                    aria-label={`Existing Question Bank for ${name}`}
                    value={chosen.target.bankId}
                    onChange={(event) => setSelection(setBankTarget(selection, bank.id, { kind: 'existing', bankId: event.target.value }))}
                  >
                    {!existingBanks.some(({ id }) => id === (chosen.target as { bankId: string }).bankId) && (
                      <option value={chosen.target.bankId}>This Question Bank</option>
                    )}
                    {existingBanks.map((existing) => (
                      <option key={existing.id} value={existing.id}>{existing.name}</option>
                    ))}
                  </select>}
                </fieldset>}

                <BankSummary bank={bank} />

                {proposal.exams.length > 0 && <section className="bank-import-uses">
                  <h4>Used by</h4>
                  {bank.exams.length > 0
                    ? bank.exams.map((key) => (
                        <TabLink
                          key={key}
                          kind="exam"
                          name={examName(key)}
                          onShow={() => showTab({ kind: 'exam', key }, true)}
                        />
                      ))
                    : <p>No Test in this file</p>}
                </section>}
              </aside>
            })()}

            {focusedExam && (() => {
              const exam = focusedExam
              const chosen = selection.exams[exam.key]!
              const name = exam.name || 'Untitled Test'
              const denied = deniedBanksOf(proposal, selection, exam.key)
              return <aside
                className="bank-import-controls"
                data-allowed={chosen.allowed ? 'true' : 'false'}
                aria-label={`Test ${name}`}
              >
                <label className="bank-import-allow">
                  <input
                    type="checkbox"
                    checked={chosen.allowed}
                    disabled={busy}
                    onChange={(event) => setSelection(setExamAllowed(proposal, selection, exam.key, event.target.checked))}
                  />
                  <span>Import this Test</span>
                </label>
                {!chosen.allowed && denied.length > 0 && <p className="bank-import-denied-reason">
                  Not imported because {denied.map(bankName).join(' and ')} {denied.length === 1 ? 'is' : 'are'} not being imported.
                </p>}

                <dl className="bank-import-summary">
                  <div>
                    <dt>Questions</dt>
                    <dd>{exam.positions.length}</dd>
                  </div>
                  <div>
                    <dt>Format version</dt>
                    <dd>{exam.formatVersion}</dd>
                  </div>
                </dl>

                <section className="bank-import-uses">
                  <h4>{exam.banks.length === 1 ? 'Question Bank' : 'Question Banks'} it draws on</h4>
                  {exam.banks.map((id) => (
                    <TabLink
                      key={id}
                      kind="bank"
                      onShow={() => showTab({ kind: 'bank', id }, true)}
                      name={bankName(id)}
                      detail={plural(
                        exam.positions.filter(({ question }) => question.bank === id).length,
                        'Question',
                      )}
                    />
                  ))}
                </section>
              </aside>
            })()}
          </section>
        )}

        <footer className="dialog-actions">
          {proposal && (
            <button
              type="button"
              className="secondary-button bank-import-back"
              disabled={busy}
              onClick={() => {
                setProposal(null)
                setSelection(null)
                setError(null)
              }}
            >
              Choose a different file
            </button>
          )}
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          {proposal && selection && (
            <button
              type="button"
              className="primary-button"
              disabled={busy || !importable}
              onClick={() => void confirm()}
            >
              {phase === 'saving' ? 'Importing…' : importActionLabel(proposal, selection)}
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}
