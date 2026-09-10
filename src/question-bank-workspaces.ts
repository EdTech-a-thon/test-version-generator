import { duplicateQuestion, type Question } from './exam'
import { NO_FILTER, type QuestionBankFilter } from './question-bank-view'
import {
  CANONICAL_QUESTION_STORE,
  EDITOR_WORKSPACE_STORE,
  EXAM_STORE,
  EXAM_WORKSPACE_STORE,
  QUESTION_BANK_REGISTRY_STORE,
  QUESTION_BANK_WORKSPACE_STORE,
  VERSIONED_STORAGE_NAME,
  VERSIONED_STORAGE_VERSION,
} from './storage-schema'

export const UNTITLED_QUESTION_BANK = 'Untitled Question Bank'

export type QuestionBankResource = {
  id: string
  name: string
  createdAt: string
  lastUpdatedAt: string
  questions: Question[]
}

export type QuestionBankSummary = Omit<QuestionBankResource, 'questions'> & {
  questionCount: number
  topics: string[]
}

type StoredBank = Omit<QuestionBankResource, 'questions'> & { questionIds: string[] }
type StoredQuestion = Question & { bankId: string }
type BankWorkspace = { key: 'active'; bankId: string }
export type EditorWorkspace = {
  key: 'active'
  mode: 'exam' | 'bank'
  resourceId: string
}

export type BankWorkspaceContext = {
  mode: 'bank' | 'exam'
  resourceId: string
}

export type QuestionBankTabsWorkspace = {
  openBankIds: string[]
  activeBankId: string | null
  filters: Record<string, QuestionBankFilter>
  pane: { bankPercent: number }
}

export const DEFAULT_BANK_TABS_WORKSPACE: QuestionBankTabsWorkspace = {
  openBankIds: [],
  activeBankId: null,
  filters: {},
  pane: { bankPercent: 33 },
}

type StoredTabsWorkspace = QuestionBankTabsWorkspace & {
  key: string
  mode: BankWorkspaceContext['mode']
  resourceId: string
}

const copyFilter = (filter: QuestionBankFilter = NO_FILTER): QuestionBankFilter => ({
  search: filter.search,
  types: [...filter.types],
  difficulties: [...filter.difficulties],
  topics: [...filter.topics],
})

const copyTabsWorkspace = (workspace: QuestionBankTabsWorkspace): QuestionBankTabsWorkspace => ({
  openBankIds: [...workspace.openBankIds],
  activeBankId: workspace.activeBankId,
  filters: Object.fromEntries(
    Object.entries(workspace.filters).map(([id, filter]) => [id, copyFilter(filter)]),
  ),
  pane: { ...workspace.pane },
})

export function openBankTab(
  workspace: QuestionBankTabsWorkspace,
  bankId: string,
): QuestionBankTabsWorkspace {
  const next = copyTabsWorkspace(workspace)
  if (!next.openBankIds.includes(bankId)) next.openBankIds.push(bankId)
  next.activeBankId = bankId
  if (!next.filters[bankId]) next.filters[bankId] = copyFilter()
  return next
}

export function closeBankTab(
  workspace: QuestionBankTabsWorkspace,
  bankId: string,
): QuestionBankTabsWorkspace {
  const index = workspace.openBankIds.indexOf(bankId)
  if (index === -1) return copyTabsWorkspace(workspace)
  const next = copyTabsWorkspace(workspace)
  next.openBankIds.splice(index, 1)
  delete next.filters[bankId]
  if (next.activeBankId === bankId) {
    next.activeBankId = next.openBankIds[Math.min(index, next.openBankIds.length - 1)] ?? null
  }
  return next
}

export function updateBankTabFilter(
  workspace: QuestionBankTabsWorkspace,
  bankId: string,
  filter: QuestionBankFilter,
): QuestionBankTabsWorkspace {
  const next = copyTabsWorkspace(workspace)
  next.filters[bankId] = copyFilter(filter)
  return next
}

function tabsKey(context: BankWorkspaceContext): string {
  return context.mode === 'exam' ? `exam:${context.resourceId}` : 'bank-only'
}

export type BankChange =
  | { kind: 'rename'; name: string }
  | { kind: 'create-question'; question: Question }
  | { kind: 'update-question'; question: Question }
  | { kind: 'duplicate-question'; questionId: string }
  | { kind: 'delete-question'; questionId: string }

function questionOf(stored: StoredQuestion): Question {
  const question: Question = {
    id: stored.id,
    type: stored.type,
    doc: stored.doc,
    columns: stored.columns,
  }
  if (stored.difficulty) question.difficulty = stored.difficulty
  if (stored.topics) question.topics = [...stored.topics]
  return question
}

export function isPristineQuestionBank(bank: QuestionBankResource | null): boolean {
  return Boolean(
    bank
    && bank.name === UNTITLED_QUESTION_BANK
    && bank.questions.length === 0,
  )
}

function requestOf<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function completionOf(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })
}

function createGlobalStores(database: IDBDatabase) {
  if (!database.objectStoreNames.contains(EXAM_STORE)) database.createObjectStore(EXAM_STORE, { keyPath: 'id' })
  if (!database.objectStoreNames.contains(EXAM_WORKSPACE_STORE)) database.createObjectStore(EXAM_WORKSPACE_STORE, { keyPath: 'key' })
  if (!database.objectStoreNames.contains(QUESTION_BANK_REGISTRY_STORE)) database.createObjectStore(QUESTION_BANK_REGISTRY_STORE, { keyPath: 'id' })
  if (!database.objectStoreNames.contains(CANONICAL_QUESTION_STORE)) database.createObjectStore(CANONICAL_QUESTION_STORE, { keyPath: 'id' })
  if (!database.objectStoreNames.contains(QUESTION_BANK_WORKSPACE_STORE)) database.createObjectStore(QUESTION_BANK_WORKSPACE_STORE, { keyPath: 'key' })
  if (!database.objectStoreNames.contains(EDITOR_WORKSPACE_STORE)) database.createObjectStore(EDITOR_WORKSPACE_STORE, { keyPath: 'key' })
}

function openRegistry(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VERSIONED_STORAGE_NAME, VERSIONED_STORAGE_VERSION)
    request.onupgradeneeded = () => createGlobalStores(request.result)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error(`Could not open ${VERSIONED_STORAGE_NAME}`))
  })
}

async function readBank(database: IDBDatabase, id: string): Promise<QuestionBankResource | null> {
  const transaction = database.transaction(
    [QUESTION_BANK_REGISTRY_STORE, CANONICAL_QUESTION_STORE],
    'readonly',
  )
  const bankRequest = transaction.objectStore(QUESTION_BANK_REGISTRY_STORE).get(id)
  const questionsRequest = transaction.objectStore(CANONICAL_QUESTION_STORE).getAll()
  const [bank, questions] = await Promise.all([
    requestOf(bankRequest) as Promise<StoredBank | undefined>,
    requestOf(questionsRequest) as Promise<StoredQuestion[]>,
    completionOf(transaction),
  ])
  if (!bank) return null
  const byId = new Map(
    questions
      .filter((question) => question.bankId === bank.id)
      .map((question) => [question.id, question]),
  )
  return {
    id: bank.id,
    name: bank.name,
    createdAt: bank.createdAt,
    lastUpdatedAt: bank.lastUpdatedAt,
    questions: bank.questionIds.flatMap((questionId) => {
      const stored = byId.get(questionId)
      if (!stored) return []
      return [questionOf(stored)]
    }),
  }
}

/** Global durable ownership for independent Question Banks and their Questions. */
export function createQuestionBankWorkspaceService(
  options: { now?: () => Date; createId?: () => string } = {},
) {
  const now = options.now ?? (() => new Date())
  const createId = options.createId ?? (() => crypto.randomUUID())
  const registry = openRegistry()

  const transact = async <T>(
    stores: string | string[],
    mode: IDBTransactionMode,
    operation: (transaction: IDBTransaction) => Promise<T> | T,
  ) => {
    const transaction = (await registry).transaction(stores, mode)
    const completed = completionOf(transaction)
    try {
      const result = await operation(transaction)
      await completed
      return result
    } catch (error) {
      try { transaction.abort() } catch { /* already settled */ }
      await completed.catch(() => undefined)
      throw error
    }
  }

  let workspaceWrites: Promise<void> = Promise.resolve()
  const queueWorkspaceWrite = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = workspaceWrites.then(operation)
    workspaceWrites = result.then(() => undefined, () => undefined)
    return result
  }

  const mutateWorkspace = (
    context: BankWorkspaceContext,
    change: (workspace: QuestionBankTabsWorkspace) => QuestionBankTabsWorkspace,
  ) => queueWorkspaceWrite(() =>
    transact(QUESTION_BANK_WORKSPACE_STORE, 'readwrite', async (transaction) => {
      const store = transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE)
      const stored = await requestOf(store.get(tabsKey(context))) as StoredTabsWorkspace | undefined
      const next = change(stored ?? DEFAULT_BANK_TABS_WORKSPACE)
      store.put({
        key: tabsKey(context), mode: context.mode, resourceId: context.resourceId, ...next,
      } satisfies StoredTabsWorkspace)
      return next
    }),
  )

  const service = {
    async activeId(): Promise<string | null> {
      return transact(QUESTION_BANK_WORKSPACE_STORE, 'readonly', async (transaction) => {
        const workspace = await requestOf(
          transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE).get('active'),
        ) as BankWorkspace | undefined
        return workspace?.bankId ?? null
      })
    },
    async activeEditor(): Promise<EditorWorkspace | null> {
      return transact(EDITOR_WORKSPACE_STORE, 'readonly', async (transaction) => {
        return await requestOf(
          transaction.objectStore(EDITOR_WORKSPACE_STORE).get('active'),
        ) as EditorWorkspace | undefined ?? null
      })
    },
    async resumeBankWorkspace(bankId: string | null) {
      await transact(
        [QUESTION_BANK_WORKSPACE_STORE, EDITOR_WORKSPACE_STORE],
        'readwrite',
        (transaction) => {
          const banks = transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE)
          if (bankId) banks.put({ key: 'active', bankId } satisfies BankWorkspace)
          else banks.delete('active')
          transaction.objectStore(EDITOR_WORKSPACE_STORE).put({
            key: 'active', mode: 'bank', resourceId: bankId ?? '',
          } satisfies EditorWorkspace)
        },
      )
    },
    async workspace(context: BankWorkspaceContext): Promise<QuestionBankTabsWorkspace> {
      await workspaceWrites
      return transact(QUESTION_BANK_WORKSPACE_STORE, 'readonly', async (transaction) => {
        const stored = await requestOf(
          transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE).get(tabsKey(context)),
        ) as StoredTabsWorkspace | undefined
        return stored ? copyTabsWorkspace(stored) : copyTabsWorkspace(DEFAULT_BANK_TABS_WORKSPACE)
      })
    },
    async saveWorkspace(
      context: BankWorkspaceContext,
      workspace: QuestionBankTabsWorkspace,
    ): Promise<QuestionBankTabsWorkspace> {
      const saved = copyTabsWorkspace(workspace)
      return queueWorkspaceWrite(async () => {
        await transact(QUESTION_BANK_WORKSPACE_STORE, 'readwrite', (transaction) => {
          transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE).put({
            key: tabsKey(context),
            mode: context.mode,
            resourceId: context.resourceId,
            ...saved,
          } satisfies StoredTabsWorkspace)
        })
        return saved
      })
    },
    async openTab(context: BankWorkspaceContext, bankId: string) {
      return queueWorkspaceWrite(async () => {
        const bank = await readBank(await registry, bankId)
        if (!bank) return null
        const workspace = await transact(
          [QUESTION_BANK_WORKSPACE_STORE, EDITOR_WORKSPACE_STORE],
          'readwrite',
          async (transaction) => {
            const workspaces = transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE)
            const stored = await requestOf(workspaces.get(tabsKey(context))) as StoredTabsWorkspace | undefined
            const next = openBankTab(stored ?? DEFAULT_BANK_TABS_WORKSPACE, bankId)
            workspaces.put({
              key: tabsKey(context), mode: context.mode, resourceId: context.resourceId, ...next,
            } satisfies StoredTabsWorkspace)
            transaction.objectStore(EDITOR_WORKSPACE_STORE).put({
              key: 'active',
              mode: context.mode,
              resourceId: context.mode === 'bank' ? bankId : context.resourceId,
            } satisfies EditorWorkspace)
            return next
          },
        )
        return { bank, workspace }
      })
    },
    async closeTab(context: BankWorkspaceContext, bankId: string) {
      return queueWorkspaceWrite(() => transact(
        [QUESTION_BANK_WORKSPACE_STORE, EDITOR_WORKSPACE_STORE],
        'readwrite',
        async (transaction) => {
          const workspaces = transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE)
          const stored = await requestOf(workspaces.get(tabsKey(context))) as StoredTabsWorkspace | undefined
          const next = closeBankTab(stored ?? DEFAULT_BANK_TABS_WORKSPACE, bankId)
          workspaces.put({
            key: tabsKey(context), mode: context.mode, resourceId: context.resourceId, ...next,
          } satisfies StoredTabsWorkspace)
          if (context.mode === 'bank') {
            transaction.objectStore(EDITOR_WORKSPACE_STORE).put({
              key: 'active', mode: 'bank', resourceId: next.activeBankId ?? '',
            } satisfies EditorWorkspace)
          }
          return next
        },
      ))
    },
    async updateFilter(
      context: BankWorkspaceContext,
      bankId: string,
      filter: QuestionBankFilter,
    ) {
      return mutateWorkspace(context, (workspace) => updateBankTabFilter(workspace, bankId, filter))
    },
    async updatePane(context: BankWorkspaceContext, bankPercent: number) {
      return mutateWorkspace(context, (workspace) => ({
        ...copyTabsWorkspace(workspace),
        pane: { bankPercent: Math.min(80, Math.max(20, bankPercent)) },
      }))
    },
    async carryWorkspace(from: BankWorkspaceContext, to: BankWorkspaceContext) {
      return service.saveWorkspace(to, await service.workspace(from))
    },
    async create(): Promise<QuestionBankResource> {
      const timestamp = now().toISOString()
      const bank: QuestionBankResource = {
        id: createId(),
        name: UNTITLED_QUESTION_BANK,
        createdAt: timestamp,
        lastUpdatedAt: timestamp,
        questions: [],
      }
      await transact(
        [QUESTION_BANK_REGISTRY_STORE, QUESTION_BANK_WORKSPACE_STORE, EDITOR_WORKSPACE_STORE],
        'readwrite',
        (transaction) => {
          transaction.objectStore(QUESTION_BANK_REGISTRY_STORE).add({
            id: bank.id,
            name: bank.name,
            createdAt: bank.createdAt,
            lastUpdatedAt: bank.lastUpdatedAt,
            questionIds: [],
          } satisfies StoredBank)
          transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE).put({ key: 'active', bankId: bank.id } satisfies BankWorkspace)
          transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE).put({
            key: 'bank-only',
            mode: 'bank',
            resourceId: bank.id,
            ...openBankTab(DEFAULT_BANK_TABS_WORKSPACE, bank.id),
          } satisfies StoredTabsWorkspace)
          transaction.objectStore(EDITOR_WORKSPACE_STORE).put({ key: 'active', mode: 'bank', resourceId: bank.id } satisfies EditorWorkspace)
        },
      )
      return bank
    },
    async read(id: string) {
      return readBank(await registry, id)
    },
    async ownerOfQuestion(questionId: string): Promise<QuestionBankResource | null> {
      const database = await registry
      const transaction = database.transaction(CANONICAL_QUESTION_STORE, 'readonly')
      const stored = await requestOf(
        transaction.objectStore(CANONICAL_QUESTION_STORE).get(questionId),
      ) as StoredQuestion | undefined
      await completionOf(transaction)
      return stored ? readBank(database, stored.bankId) : null
    },
    async open(id: string): Promise<QuestionBankResource | null> {
      const bank = await readBank(await registry, id)
      if (!bank) return null
      await transact([QUESTION_BANK_WORKSPACE_STORE, EDITOR_WORKSPACE_STORE], 'readwrite', (transaction) => {
        transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE).put({ key: 'active', bankId: id } satisfies BankWorkspace)
        transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE).put({
          key: 'bank-only',
          mode: 'bank',
          resourceId: id,
          ...openBankTab(DEFAULT_BANK_TABS_WORKSPACE, id),
        } satisfies StoredTabsWorkspace)
        transaction.objectStore(EDITOR_WORKSPACE_STORE).put({ key: 'active', mode: 'bank', resourceId: id } satisfies EditorWorkspace)
      })
      return bank
    },
    async commit(id: string, change: BankChange): Promise<QuestionBankResource> {
      const timestamp = now().toISOString()
      await transact(
        [QUESTION_BANK_REGISTRY_STORE, CANONICAL_QUESTION_STORE],
        'readwrite',
        async (transaction) => {
          const banks = transaction.objectStore(QUESTION_BANK_REGISTRY_STORE)
          const questions = transaction.objectStore(CANONICAL_QUESTION_STORE)
          const bank = await requestOf(banks.get(id)) as StoredBank | undefined
          if (!bank) throw new Error('That Question Bank is unavailable on this device.')

          if (change.kind === 'rename') {
            if (change.name === bank.name) return
            banks.put({ ...bank, name: change.name, lastUpdatedAt: timestamp })
            return
          }

          if (change.kind === 'create-question') {
            const existing = await requestOf(questions.get(change.question.id)) as StoredQuestion | undefined
            if (existing) throw new Error('That Question already belongs to a Question Bank.')
            questions.add({ ...change.question, bankId: id } satisfies StoredQuestion)
            banks.put({ ...bank, questionIds: [...bank.questionIds, change.question.id], lastUpdatedAt: timestamp })
            return
          }

          const questionId = change.kind === 'update-question'
            ? change.question.id
            : change.questionId
          const existing = await requestOf(questions.get(questionId)) as StoredQuestion | undefined
          if (!existing || existing.bankId !== id || !bank.questionIds.includes(questionId)) {
            throw new Error('That Question does not belong to this Question Bank.')
          }
          if (change.kind === 'update-question') {
            if (change.question.type !== existing.type) {
              throw new Error('A Question Type cannot be changed after creation.')
            }
            if (JSON.stringify(questionOf(existing)) === JSON.stringify(change.question)) return
            questions.put({ ...change.question, bankId: id } satisfies StoredQuestion)
            banks.put({ ...bank, lastUpdatedAt: timestamp })
          } else if (change.kind === 'duplicate-question') {
            const copy = duplicateQuestion(questionOf(existing))
            questions.add({ ...copy, bankId: id } satisfies StoredQuestion)
            const at = bank.questionIds.indexOf(questionId)
            const questionIds = [...bank.questionIds]
            questionIds.splice(at + 1, 0, copy.id)
            banks.put({ ...bank, questionIds, lastUpdatedAt: timestamp })
          } else {
            questions.delete(questionId)
            banks.put({ ...bank, questionIds: bank.questionIds.filter((candidate) => candidate !== questionId), lastUpdatedAt: timestamp })
          }
        },
      )
      const updated = await readBank(await registry, id)
      if (!updated) throw new Error('That Question Bank is unavailable on this device.')
      return updated
    },
    async recent(): Promise<QuestionBankSummary[]> {
      const database = await registry
      const transaction = database.transaction(
        [QUESTION_BANK_REGISTRY_STORE, CANONICAL_QUESTION_STORE],
        'readonly',
      )
      const [banks, questions] = await Promise.all([
        requestOf(transaction.objectStore(QUESTION_BANK_REGISTRY_STORE).getAll()) as Promise<StoredBank[]>,
        requestOf(transaction.objectStore(CANONICAL_QUESTION_STORE).getAll()) as Promise<StoredQuestion[]>,
        completionOf(transaction),
      ])
      return banks.map((bank) => {
        const owned = questions.filter((question) => question.bankId === bank.id)
        return {
          id: bank.id,
          name: bank.name,
          createdAt: bank.createdAt,
          lastUpdatedAt: bank.lastUpdatedAt,
          questionCount: owned.length,
          topics: [...new Set(owned.flatMap((question) => question.topics ?? []))],
        }
      }).sort((left, right) => right.lastUpdatedAt.localeCompare(left.lastUpdatedAt))
    },
    async removePristine(id: string): Promise<boolean> {
      const bank = await readBank(await registry, id)
      if (!isPristineQuestionBank(bank)) return false
      await transact(
        [QUESTION_BANK_REGISTRY_STORE, QUESTION_BANK_WORKSPACE_STORE, EDITOR_WORKSPACE_STORE],
        'readwrite',
        async (transaction) => {
          transaction.objectStore(QUESTION_BANK_REGISTRY_STORE).delete(id)
          const bankWorkspace = await requestOf(transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE).get('active')) as BankWorkspace | undefined
          if (bankWorkspace?.bankId === id) transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE).delete('active')
          const editorWorkspace = await requestOf(transaction.objectStore(EDITOR_WORKSPACE_STORE).get('active')) as EditorWorkspace | undefined
          if (editorWorkspace?.mode === 'bank' && editorWorkspace.resourceId === id) transaction.objectStore(EDITOR_WORKSPACE_STORE).delete('active')
        },
      )
      return true
    },
    async cleanupPristine({ includeActive = false }: { includeActive?: boolean } = {}) {
      const active = await service.activeId()
      const banks = await service.recent()
      await Promise.all(
        banks
          .filter((bank) => includeActive || bank.id !== active)
          .map((bank) => service.removePristine(bank.id)),
      )
    },
  }
  return service
}

export type QuestionBankWorkspaceService = ReturnType<typeof createQuestionBankWorkspaceService>

/** React-facing commit boundary. State changes only after the durable operation succeeds. */
export function createQuestionBankResourceStore(
  initial: QuestionBankResource,
  commit: (change: BankChange) => Promise<QuestionBankResource>,
) {
  let state = initial
  const listeners = new Set<() => void>()
  const apply = async (change: BankChange) => {
    const durable = await commit(change)
    state = durable
    for (const listener of listeners) listener()
  }
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    rename: (name: string) => apply({ kind: 'rename', name }),
    createQuestion: (question: Question) => apply({ kind: 'create-question', question }),
    updateQuestion: (question: Question) => apply({ kind: 'update-question', question }),
    duplicateQuestion: (questionId: string) => apply({ kind: 'duplicate-question', questionId }),
    deleteQuestion: (questionId: string) => apply({ kind: 'delete-question', questionId }),
  }
}

export type QuestionBankResourceStore = ReturnType<typeof createQuestionBankResourceStore>
