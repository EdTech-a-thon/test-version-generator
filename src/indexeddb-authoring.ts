// Browser-local persistence for the fresh Version History generation.
//
// The Question Bank records and the Exam Draft/control record are normalized
// into separate object stores. Every snapshot crosses those stores in one
// transaction, so a reload sees either the previous authoring state or the
// complete next one, never a bank and draft from different actions.

import type {
  AuthoringState,
  DurableAuthoringBackend,
  SavedState,
} from './exam-store'
import {
  MEDIA_ASSET_STORE,
  VERSIONED_STORAGE_NAME,
  VERSIONED_STORAGE_VERSION,
} from './storage-schema'

export { VERSIONED_STORAGE_NAME } from './storage-schema'
export const QUESTION_BANK_STORE = 'question-bank'
export const AUTHORING_STATE_STORE = 'authoring-state'
export const SAVED_AUTHORING_STORE = 'saved-authoring-state'

const DATABASE_VERSION = VERSIONED_STORAGE_VERSION
const CURRENT_AUTHORING_KEY = 'current'
const SAVED_AUTHORING_KEY = 'saved'

type AuthoringControl = {
  key: typeof CURRENT_AUTHORING_KEY
  questionIds: string[]
  examDraft: AuthoringState['examDraft']
  dirty: boolean
}

export type IndexedDBAuthoringRecords = {
  questions: AuthoringState['questionBank']['questions']
  control: AuthoringControl
}

function openDatabase(databaseName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(QUESTION_BANK_STORE)) {
        database.createObjectStore(QUESTION_BANK_STORE, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(AUTHORING_STATE_STORE)) {
        database.createObjectStore(AUTHORING_STATE_STORE, { keyPath: 'key' })
      }
      if (!database.objectStoreNames.contains(SAVED_AUTHORING_STORE)) {
        database.createObjectStore(SAVED_AUTHORING_STORE)
      }
      if (!database.objectStoreNames.contains(MEDIA_ASSET_STORE)) {
        database.createObjectStore(MEDIA_ASSET_STORE, { keyPath: 'hash' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error(`Could not open ${databaseName}`))
  })
}

function resultOf<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function completionOf(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
  })
}

/** The normalized records for one coherent authoring snapshot. The browser
 *  test seeder shares this encoder so schema changes have one owner. */
export function indexedDBAuthoringRecordsOf(
  state: AuthoringState,
): IndexedDBAuthoringRecords {
  return {
    questions: state.questionBank.questions,
    control: {
      key: CURRENT_AUTHORING_KEY,
      questionIds: state.questionBank.questions.map((question) => question.id),
      examDraft: state.examDraft,
      dirty: state.dirty,
    },
  }
}

function putAuthoringState(transaction: IDBTransaction, state: AuthoringState) {
  const records = indexedDBAuthoringRecordsOf(state)
  const questions = transaction.objectStore(QUESTION_BANK_STORE)
  questions.clear()
  for (const question of records.questions) questions.put(question)
  transaction.objectStore(AUTHORING_STATE_STORE).put(records.control)
}

async function readAuthoringState(database: IDBDatabase): Promise<AuthoringState | null> {
  const transaction = database.transaction(
    [QUESTION_BANK_STORE, AUTHORING_STATE_STORE],
    'readonly',
  )
  const questionsRequest = transaction.objectStore(QUESTION_BANK_STORE).getAll()
  const controlRequest = transaction
    .objectStore(AUTHORING_STATE_STORE)
    .get(CURRENT_AUTHORING_KEY)
  const [questions, control] = await Promise.all([
    resultOf(questionsRequest),
    resultOf(controlRequest) as Promise<AuthoringControl | undefined>,
    completionOf(transaction),
  ])
  if (!control) return null

  const byId = new Map(
    (questions as AuthoringState['questionBank']['questions']).map((question) => [
      question.id,
      question,
    ]),
  )
  return {
    questionBank: {
      questions: control.questionIds.flatMap((id) => {
        const question = byId.get(id)
        return question ? [question] : []
      }),
    },
    examDraft: control.examDraft,
    dirty: control.dirty,
  }
}

async function transactionally(
  database: IDBDatabase,
  stores: string[],
  operation: (transaction: IDBTransaction) => void,
): Promise<void> {
  const transaction = database.transaction(stores, 'readwrite')
  const completed = completionOf(transaction)
  try {
    operation(transaction)
  } catch (error) {
    transaction.abort()
    await completed.catch(() => undefined)
    throw error
  }
  await completed
}

/** The active authoring backend used by the application. A custom database
 *  name keeps real-browser adapter tests isolated from application state. */
export function createIndexedDBAuthoringBackend(
  databaseName = VERSIONED_STORAGE_NAME,
): DurableAuthoringBackend {
  // Opening is shared for this page lifetime. Once startup has loaded the
  // store, later authoring actions can begin their transaction on the next
  // microtask instead of queuing another database open that a reload can beat.
  let opened: IDBDatabase | null = null
  const database = openDatabase(databaseName).then((connection) => {
    opened = connection
    return connection
  })
  const transaction = (
    stores: string[],
    operation: (transaction: IDBTransaction) => void,
  ) =>
    opened
      ? transactionally(opened, stores, operation)
      : database.then((connection) => transactionally(connection, stores, operation))
  return {
    read: async () => {
      return await readAuthoringState(await database)
    },

    write: async (state) => {
      await transaction(
        [QUESTION_BANK_STORE, AUTHORING_STATE_STORE],
        (transaction) => putAuthoringState(transaction, state),
      )
    },

    readSaved: async () => {
      const transaction = (await database).transaction(SAVED_AUTHORING_STORE, 'readonly')
      const request = transaction.objectStore(SAVED_AUTHORING_STORE).get(SAVED_AUTHORING_KEY)
      const [saved] = await Promise.all([
        resultOf(request) as Promise<SavedState | undefined>,
        completionOf(transaction),
      ])
      return saved ?? null
    },

    commitSaved: async (saved) => {
      await transaction(
        [QUESTION_BANK_STORE, AUTHORING_STATE_STORE, SAVED_AUTHORING_STORE],
        (transaction) => {
          putAuthoringState(transaction, { ...saved, dirty: false })
          transaction.objectStore(SAVED_AUTHORING_STORE).put(saved, SAVED_AUTHORING_KEY)
        },
      )
    },
  }
}
