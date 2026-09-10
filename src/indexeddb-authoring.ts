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
import type {
  PublicationHistory,
  PublishedLayoutPlan,
  PublishedVersion,
  QuestionRevision,
} from './export-preparation'
import {
  EXAM_STORE,
  EXAM_WORKSPACE_STORE,
  LAYOUT_PLAN_STORE,
  MEDIA_ASSET_STORE,
  QUESTION_REVISION_STORE,
  VERSION_STORE,
  VERSIONED_STORAGE_NAME,
  VERSIONED_STORAGE_VERSION,
} from './storage-schema'

export { VERSIONED_STORAGE_NAME } from './storage-schema'
export const QUESTION_BANK_STORE = 'question-bank'
export const AUTHORING_STATE_STORE = 'authoring-state'
export const SAVED_AUTHORING_STORE = 'saved-authoring-state'

export type CanonicalProjectionSnapshot = {
  working: AuthoringState
  saved: SavedState | null
}

const DATABASE_VERSION = VERSIONED_STORAGE_VERSION
const CURRENT_AUTHORING_KEY = 'current'
const SAVED_AUTHORING_KEY = 'saved'

type AuthoringControl = {
  key: typeof CURRENT_AUTHORING_KEY
  questionIds: string[]
  examDraft: AuthoringState['examDraft']
  lastExportedVersionId?: string
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
      if (!database.objectStoreNames.contains(VERSION_STORE)) {
        database.createObjectStore(VERSION_STORE, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(QUESTION_REVISION_STORE)) {
        database.createObjectStore(QUESTION_REVISION_STORE, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(LAYOUT_PLAN_STORE)) {
        database.createObjectStore(LAYOUT_PLAN_STORE, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(EXAM_STORE)) {
        database.createObjectStore(EXAM_STORE, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(EXAM_WORKSPACE_STORE)) {
        database.createObjectStore(EXAM_WORKSPACE_STORE, { keyPath: 'key' })
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
      ...(state.lastExportedVersionId
        ? { lastExportedVersionId: state.lastExportedVersionId }
        : {}),
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
    ...(typeof control.lastExportedVersionId === 'string'
      ? { lastExportedVersionId: control.lastExportedVersionId }
      : {}),
    dirty: control.dirty,
  }
}

async function readPublicationHistory(database: IDBDatabase): Promise<PublicationHistory> {
  const transaction = database.transaction(
    [VERSION_STORE, QUESTION_REVISION_STORE, LAYOUT_PLAN_STORE],
    'readonly',
  )
  const versionsRequest = transaction.objectStore(VERSION_STORE).getAll()
  const revisionsRequest = transaction.objectStore(QUESTION_REVISION_STORE).getAll()
  const plansRequest = transaction.objectStore(LAYOUT_PLAN_STORE).getAll()
  const [versions, revisions, plans] = await Promise.all([
    resultOf(versionsRequest) as Promise<PublishedVersion[]>,
    resultOf(revisionsRequest) as Promise<QuestionRevision[]>,
    resultOf(plansRequest) as Promise<PublishedLayoutPlan[]>,
    completionOf(transaction),
  ])
  versions.sort((left, right) => left.historyPosition - right.historyPosition)
  return { versions, revisions, plans }
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
): DurableAuthoringBackend & {
  commitCanonicalProjection(snapshot: CanonicalProjectionSnapshot): Promise<void>
} {
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

    initialize: async (saved, working) => {
      await transaction(
        [QUESTION_BANK_STORE, AUTHORING_STATE_STORE, SAVED_AUTHORING_STORE],
        (transaction) => {
          putAuthoringState(transaction, working)
          transaction.objectStore(SAVED_AUTHORING_STORE).put(saved, SAVED_AUTHORING_KEY)
        },
      )
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

    commitCanonicalProjection: async ({ working, saved }) => {
      await transaction(
        [QUESTION_BANK_STORE, AUTHORING_STATE_STORE, SAVED_AUTHORING_STORE],
        (transaction) => {
          putAuthoringState(transaction, working)
          const savedStore = transaction.objectStore(SAVED_AUTHORING_STORE)
          if (saved) savedStore.put(saved, SAVED_AUTHORING_KEY)
          else savedStore.delete(SAVED_AUTHORING_KEY)
        },
      )
    },

    readPublicationHistory: async () => {
      return readPublicationHistory(await database)
    },

    commitPublication: async (working, publication) => {
      await transaction(
        [
          QUESTION_BANK_STORE,
          AUTHORING_STATE_STORE,
          VERSION_STORE,
          QUESTION_REVISION_STORE,
          LAYOUT_PLAN_STORE,
          MEDIA_ASSET_STORE,
        ],
        (transaction) => {
          // Publishing records output and the current Working Copy, but never
          // changes the separately explicit saved Exam.
          putAuthoringState(transaction, working)
          if (publication.version) {
            transaction.objectStore(VERSION_STORE).add(publication.version)
            const revisions = transaction.objectStore(QUESTION_REVISION_STORE)
            for (const revision of publication.revisions) revisions.add(revision)
            const plans = transaction.objectStore(LAYOUT_PLAN_STORE)
            for (const plan of publication.plans) plans.add(plan)
          }

          // Media is already ingested while authoring. Re-putting the immutable
          // record inside this transaction both verifies it exists and includes
          // every required asset in the publication durability boundary.
          const media = transaction.objectStore(MEDIA_ASSET_STORE)
          for (const hash of publication.mediaHashes) {
            const request = media.get(hash)
            request.onsuccess = () => {
              if (request.result === undefined) transaction.abort()
              else media.put(request.result)
            }
          }
        },
      )
    },
  }
}
