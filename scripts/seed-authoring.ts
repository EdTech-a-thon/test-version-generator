// Seeding the browser with authoring state.
//
// Every browser test that starts from an exam rather than building one puts its
// fixture where the application looks for it. The storage identifier comes from
// the application itself, so a storage generation can never be changed in one
// place and left stale in seven others.

import type { Page } from '@playwright/test'
import type { AuthoringState } from '../src/exam-store'
import {
  AUTHORING_STATE_STORE,
  indexedDBAuthoringRecordsOf,
  QUESTION_BANK_STORE,
  VERSIONED_STORAGE_NAME,
} from '../src/indexeddb-authoring'

/** Puts one authoring state where the application reads it, before it loads. */
export async function seedAuthoringState(
  page: Page,
  state: AuthoringState,
): Promise<void> {
  // Establish the application's origin and let startup finish before opening
  // the same database. The caller's next navigation then observes this exact
  // normalized snapshot through the production adapter.
  await page.goto('/')
  await page.getByRole('textbox', { name: 'Exam name' }).waitFor()
  const records = indexedDBAuthoringRecordsOf(state)
  await page.evaluate(
    async ({ databaseName, questionStore, controlStore, value }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(
            [questionStore, controlStore],
            'readwrite',
          )
          const questions = transaction.objectStore(questionStore)
          questions.clear()
          for (const question of value.questions) {
            questions.put(question)
          }
          transaction.objectStore(controlStore).put(value.control)
          transaction.oncomplete = () => resolve()
          transaction.onabort = () => reject(transaction.error)
          transaction.onerror = () => reject(transaction.error)
        })
      } finally {
        database.close()
      }
    },
    {
      databaseName: VERSIONED_STORAGE_NAME,
      questionStore: QUESTION_BANK_STORE,
      controlStore: AUTHORING_STATE_STORE,
      value: records,
    },
  )
}
