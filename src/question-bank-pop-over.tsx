// The Question Bank Pop-over: a compact, read-only view of Question Banks that
// stays on top of the document a teacher is writing, so a Question can be
// found and Copied across (see CONTEXT.md and ADR-0029).
//
// It is a Document Picture-in-Picture window. That window has no page of its
// own: this document renders into it through a portal, which is why the
// provider sits above every route and why every screen is reached without a
// document load — the window closes with the document that opened it.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, CircleAlert, Copy, Plus, Search, SlidersHorizontal, X } from 'lucide-react'
import type { Question } from './exam'
import type { ProseMirrorJSON } from './question-doc'
import { QuestionReading } from './question-reading'
import { readingOfQuestion } from './question-reading-content'
import { stemPreview } from './stem-preview'
import { COPY_FAILED_MESSAGE, useQuestionCopy } from './use-question-copy'
import { DIFFICULTY_OPTIONS, SORT_OPTIONS, TYPE_OPTIONS } from './question-bank-filter-options'
import { PopOverContext } from './pop-over-context'
import {
  NO_FILTER,
  browseQuestionBank,
  isFilterActive,
  topicOptions,
  type QuestionBankFilter,
  type QuestionBankSort,
} from './question-bank-view'
import {
  closeBankTab,
  openBankTab,
  updateBankTabFilter,
  type QuestionBankResource,
  type QuestionBankSummary,
  type QuestionBankTabsWorkspace,
  type QuestionBankWorkspaceService,
} from './question-bank-workspaces'

/** Chrome's Document Picture-in-Picture, which not every browser offers. */
type DocumentPictureInPicture = {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>
  window: Window | null
}

function pictureInPicture(): DocumentPictureInPicture | undefined {
  return typeof window === 'undefined'
    ? undefined
    : (window as Window & { documentPictureInPicture?: DocumentPictureInPicture }).documentPictureInPicture
}

/** The size the window opens at: a narrow column beside a document. The
 *  teacher can resize it, and the browser remembers what they chose. */
const POP_OVER_SIZE = { width: 380, height: 680 }

/** Give the new window this document's styles, so the Pop-over is drawn as
 *  everything else is. */
function prepareWindow(view: Window) {
  const target = view.document
  const base = target.createElement('base')
  base.href = window.location.origin
  target.head.append(base)
  for (const node of document.head.querySelectorAll('link[rel="stylesheet"], style')) {
    target.head.append(node.cloneNode(true))
  }
  target.title = 'Question Bank Pop-over'
  target.documentElement.lang = document.documentElement.lang || 'en'
  target.body.className = 'pop-over-body'
}

export function PopOverProvider({
  service,
  children,
}: {
  service: QuestionBankWorkspaceService
  children: ReactNode
}) {
  const [view, setView] = useState<Window | null>(null)
  const [request, setRequest] = useState<{ bankId: string; nonce: number } | null>(null)
  const viewRef = useRef<Window | null>(null)
  const supported = pictureInPicture() !== undefined
  const open = useCallback((bankId: string) => {
    setRequest({ bankId, nonce: performance.now() })
    const existing = viewRef.current
    if (existing && !existing.closed) {
      existing.focus()
      return
    }
    // Asked for at once, inside the click: the browser opens this window only
    // for a gesture.
    void pictureInPicture()?.requestWindow(POP_OVER_SIZE).then((opened) => {
      prepareWindow(opened)
      opened.addEventListener('pagehide', () => {
        viewRef.current = null
        setView(null)
      }, { once: true })
      viewRef.current = opened
      setView(opened)
    })
  }, [])
  const value = useMemo(() => ({ supported, open }), [open, supported])
  return <PopOverContext.Provider value={value}>
    {children}
    {view && request && createPortal(
      <QuestionBankPopOver service={service} view={view} request={request} />,
      view.document.body,
    )}
  </PopOverContext.Provider>
}

const childrenOf = (node: ProseMirrorJSON): ProseMirrorJSON[] =>
  Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []

const isPicture = (node: ProseMirrorJSON) => node.type === 'image' || node.type === 'image-block'

function localPictureSources(questions: readonly Question[]): string[] {
  const found = new Set<string>()
  const visit = (node: ProseMirrorJSON) => {
    const src = (node.attrs as Record<string, unknown> | undefined)?.src
    if (isPicture(node) && typeof src === 'string' && src.startsWith('/local-images/')) found.add(src)
    childrenOf(node).forEach(visit)
  }
  questions.forEach((question) => visit(question.doc))
  return [...found]
}

function withPictureSources(node: ProseMirrorJSON, sources: ReadonlyMap<string, string>): ProseMirrorJSON {
  const attrs = node.attrs as Record<string, unknown> | undefined
  const src = typeof attrs?.src === 'string' ? sources.get(attrs.src) : undefined
  const content = Array.isArray(node.content)
    ? { content: childrenOf(node).map((child) => withPictureSources(child, sources)) }
    : {}
  return { ...node, ...content, ...(isPicture(node) && src ? { attrs: { ...attrs, src } } : {}) }
}

/**
 * The Pop-over's window has no service worker of its own, so a Media Asset's
 * local address finds nothing there. Each picture is fetched here, where the
 * worker answers, and handed across as an object URL; a Question is shown
 * with those, and still Copied from its own.
 */
function usePictureSources(questions: readonly Question[]): (question: Question) => Question {
  const [sources, setSources] = useState<ReadonlyMap<string, string>>(new Map())
  const made = useRef(new Map<string, string>())
  const wanted = localPictureSources(questions).filter((src) => !made.current.has(src)).join(' ')
  useEffect(() => {
    if (!wanted) return
    let current = true
    void Promise.all(wanted.split(' ').map(async (src) => {
      const response = await fetch(src)
      return response.ok ? [src, URL.createObjectURL(await response.blob())] as const : null
    })).then((fetched) => {
      for (const entry of fetched) if (entry) made.current.set(...entry)
      if (current) setSources(new Map(made.current))
    }, () => undefined)
    return () => { current = false }
  }, [wanted])
  useEffect(() => {
    const urls = made.current
    return () => { for (const url of urls.values()) URL.revokeObjectURL(url) }
  }, [])
  return useCallback(
    (question: Question) => sources.size === 0 ? question : { ...question, doc: withPictureSources(question.doc, sources) },
    [sources],
  )
}

/** Every bank these tabs name that still exists, read afresh. */
async function readOpenBanks(
  service: QuestionBankWorkspaceService,
  ids: readonly string[],
): Promise<Record<string, QuestionBankResource>> {
  const banks = await Promise.all(ids.map((id) => service.read(id)))
  return Object.fromEntries(
    banks.filter((bank): bank is QuestionBankResource => bank !== null).map((bank) => [bank.id, bank]),
  )
}

/** The tabs, less any whose bank has gone. */
function withoutMissing(
  workspace: QuestionBankTabsWorkspace,
  banks: Record<string, QuestionBankResource>,
): QuestionBankTabsWorkspace {
  return workspace.openBankIds
    .filter((id) => !banks[id])
    .reduce(closeBankTab, workspace)
}

function QuestionBankPopOver({
  service,
  view,
  request,
}: {
  service: QuestionBankWorkspaceService
  view: Window
  request: { bankId: string; nonce: number }
}) {
  const [workspace, setWorkspace] = useState<QuestionBankTabsWorkspace | null>(null)
  const [banks, setBanks] = useState<Record<string, QuestionBankResource>>({})
  const [picker, setPicker] = useState<QuestionBankSummary[] | null>(null)
  const workspaceRef = useRef<QuestionBankTabsWorkspace | null>(null)

  const commit = useCallback((next: QuestionBankTabsWorkspace) => {
    workspaceRef.current = next
    setWorkspace(next)
    void service.savePopOverWorkspace(next)
  }, [service])

  // Opened on a bank, or asked for it again: that bank's tab, beside the ones
  // it was left with.
  useEffect(() => {
    let current = true
    void (async () => {
      const saved = workspaceRef.current ?? await service.popOverWorkspace()
      const next = openBankTab(saved, request.bankId)
      const read = await readOpenBanks(service, next.openBankIds)
      if (!current) return
      setBanks(read)
      setPicker(null)
      commit(withoutMissing(next, read))
    })()
    return () => { current = false }
  }, [commit, request, service])

  // What changed in the tab behind arrives when the teacher comes back here.
  useEffect(() => {
    const refresh = () => {
      const ids = workspaceRef.current?.openBankIds ?? []
      void readOpenBanks(service, ids).then((read) => {
        setBanks(read)
        const current = workspaceRef.current
        if (current && Object.keys(read).length !== current.openBankIds.length) {
          commit(withoutMissing(current, read))
        }
      })
    }
    view.addEventListener('focus', refresh)
    return () => view.removeEventListener('focus', refresh)
  }, [commit, service, view])

  const openPicker = async () => setPicker(await service.recent())
  const choose = async (id: string) => {
    const bank = await service.read(id)
    if (!bank || !workspaceRef.current) return
    setBanks((current) => ({ ...current, [id]: bank }))
    setPicker(null)
    commit(openBankTab(workspaceRef.current, id))
  }
  const close = (id: string) => {
    if (!workspaceRef.current) return
    commit(closeBankTab(workspaceRef.current, id))
  }

  if (!workspace) return <p className="pop-over-loading">Opening…</p>
  const active = workspace.activeBankId ? banks[workspace.activeBankId] : undefined
  const showingPicker = picker !== null || !active
  return <div className="pop-over">
    <div className="pop-over-tabs">
      <div role="tablist" aria-label="Open Question Banks">
        {workspace.openBankIds.map((id) => {
          const bank = banks[id]
          if (!bank) return null
          const selected = id === workspace.activeBankId && picker === null
          return <div className="pop-over-tab" key={id} data-active={selected ? 'true' : undefined}>
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              title={bank.name}
              onClick={() => {
                setPicker(null)
                commit(openBankTab(workspace, id))
              }}
            >{bank.name}</button>
            <button type="button" aria-label={`Close ${bank.name}`} onClick={() => close(id)}><X /></button>
          </div>
        })}
      </div>
      <button
        type="button"
        className="pop-over-add"
        aria-label="Open Question Bank"
        title="Open Question Bank"
        aria-pressed={picker !== null}
        onClick={() => void (picker ? setPicker(null) : openPicker())}
      ><Plus /></button>
    </div>
    {showingPicker
      ? <BankPicker
          banks={picker}
          openIds={workspace.openBankIds}
          onLoad={openPicker}
          onChoose={(id) => void choose(id)}
        />
      : <PopOverBank
          key={active.id}
          bank={active}
          view={view}
          filter={workspace.filters[active.id] ?? NO_FILTER}
          onFilterChange={(filter) => commit(updateBankTabFilter(workspace, active.id, filter))}
        />}
  </div>
}

function BankPicker({
  banks,
  openIds,
  onLoad,
  onChoose,
}: {
  banks: QuestionBankSummary[] | null
  openIds: readonly string[]
  onLoad: () => void
  onChoose: (id: string) => void
}) {
  // With every tab closed the picker is all there is, so it fetches its own
  // list rather than waiting for the plus.
  useEffect(() => { if (!banks) onLoad() }, [banks, onLoad])
  if (!banks) return <p className="pop-over-loading">Loading Question Banks…</p>
  return <section className="pop-over-picker" aria-label="Open a Question Bank">
    <h2>Open a Question Bank</h2>
    {banks.length === 0
      ? <p className="pop-over-empty">No Question Banks yet.</p>
      : <ul>
          {banks.map((bank) => (
            <li key={bank.id}>
              <button type="button" onClick={() => onChoose(bank.id)}>
                <span>{bank.name}</span>
                <small>
                  {bank.questionCount} {bank.questionCount === 1 ? 'Question' : 'Questions'}
                  {openIds.includes(bank.id) && ' · open'}
                </small>
              </button>
            </li>
          ))}
        </ul>}
  </section>
}

function Checkboxes<T extends string>({
  legend,
  options,
  selected,
  onChange,
}: {
  legend: string
  options: readonly { value: T; label: string }[]
  selected: readonly T[]
  onChange: (values: T[]) => void
}) {
  if (options.length === 0) return null
  return <fieldset className="pop-over-filter-group">
    <legend>{legend}</legend>
    {options.map((option) => (
      <label key={option.value}>
        <input
          type="checkbox"
          checked={selected.includes(option.value)}
          onChange={(event) => onChange(event.target.checked
            ? [...selected, option.value]
            : selected.filter((value) => value !== option.value))}
        />
        {option.label}
      </label>
    ))}
  </fieldset>
}

function PopOverBank({
  bank,
  view,
  filter,
  onFilterChange,
}: {
  bank: QuestionBankResource
  view: Window
  filter: QuestionBankFilter
  onFilterChange: (filter: QuestionBankFilter) => void
}) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const copying = useQuestionCopy()
  const questions = browseQuestionBank(bank, filter)
  const shown = usePictureSources(bank.questions)
  const activeFilters = filter.types.length + filter.difficulties.length + filter.topics.length
  return <section className="pop-over-bank" aria-label={bank.name}>
    <div className="pop-over-controls">
      <div className="bank-search">
        <Search aria-hidden="true" />
        <input
          type="search"
          aria-label="Search question stems"
          placeholder="Search questions"
          value={filter.search}
          onChange={(event) => onFilterChange({ ...filter, search: event.target.value })}
        />
      </div>
      <button
        type="button"
        className="pop-over-filters-button"
        aria-expanded={filtersOpen}
        data-active={activeFilters > 0 ? 'true' : undefined}
        onClick={() => setFiltersOpen((open) => !open)}
      >
        <SlidersHorizontal aria-hidden="true" />
        Filters
        {activeFilters > 0 && <span className="bank-filter-count">{activeFilters}</span>}
      </button>
    </div>
    {filtersOpen && <div className="pop-over-filters">
      <Checkboxes
        legend="Question Type"
        options={TYPE_OPTIONS}
        selected={filter.types}
        onChange={(types) => onFilterChange({ ...filter, types })}
      />
      <Checkboxes
        legend="Difficulty"
        options={DIFFICULTY_OPTIONS}
        selected={filter.difficulties}
        onChange={(difficulties) => onFilterChange({ ...filter, difficulties })}
      />
      <Checkboxes
        legend="Topic"
        options={topicOptions(bank).map((topic) => ({ value: topic, label: topic }))}
        selected={filter.topics}
        onChange={(topics) => onFilterChange({ ...filter, topics })}
      />
      <label className="pop-over-sort">
        Sort
        <select
          value={filter.sort ?? 'newest'}
          onChange={(event) => onFilterChange({ ...filter, sort: event.target.value as QuestionBankSort })}
        >
          {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {isFilterActive(filter) && <button
        type="button"
        className="bank-filter-clear"
        onClick={() => onFilterChange({ ...NO_FILTER, sort: filter.sort ?? 'newest' })}
      >Clear filters</button>}
    </div>}
    <p className="pop-over-hint">Click a Question to copy it.</p>
    {questions.length === 0
      ? <p className="pop-over-empty">
          {isFilterActive(filter) ? 'No questions match this search and these filters.' : 'No questions in this bank yet.'}
        </p>
      : <ul className="pop-over-cards" aria-label="Questions">
          {questions.map((question) => {
            const name = stemPreview(question).text || 'Untitled question'
            const state = copying.state(question.id)
            const copy = () => copying.copy(question, view)
            return <li
              key={question.id}
              className="question-reading pop-over-card"
              role="button"
              tabIndex={0}
              aria-label={state === 'copied' ? `Copied ${name}` : state === 'failed' ? COPY_FAILED_MESSAGE : `Copy ${name}`}
              data-copy-state={state === 'idle' ? undefined : state}
              onClick={copy}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
                event.preventDefault()
                copy()
              }}
            >
              <div className="pop-over-card-content">
                <QuestionReading
                  content={readingOfQuestion(shown(question))}
                  aside={<span className="pop-over-card-state" aria-hidden="true">
                    {state === 'copied' ? <><Check /> Copied</> : state === 'failed' ? <><CircleAlert /> Not copied</> : <Copy />}
                  </span>}
                />
              </div>
              <span className="sr-only" role="status">{state === 'idle' ? '' : state === 'copied' ? 'Copied' : COPY_FAILED_MESSAGE}</span>
            </li>
          })}
        </ul>}
  </section>
}
