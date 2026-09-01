// Seeding the browser with authoring state.
//
// Every browser test that starts from an exam rather than building one puts its
// fixture where the application looks for it. The storage identifier comes from
// the application itself, so a storage generation can never be changed in one
// place and left stale in seven others.

import type { Page } from '@playwright/test'
import { DRAFT_STORAGE_KEY } from '../src/exam-store'
import type { AuthoringState } from '../src/exam-store'

/** Puts one authoring state where the application reads it, before it loads. */
export async function seedAuthoringState(
  page: Page,
  state: AuthoringState,
): Promise<void> {
  await page.addInitScript(
    ({ key, value }: { key: string; value: AuthoringState }) => {
      localStorage.setItem(key, JSON.stringify(value))
    },
    { key: DRAFT_STORAGE_KEY, value: state },
  )
}
