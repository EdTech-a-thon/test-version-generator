import { readFile } from 'node:fs/promises'
import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test'

/** Creates a Question Bank holding one Question with an image in it. */
async function seedAccount(page: Page, bankName: string) {
  await page.goto('/about')
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  await page.evaluate(async (name) => {
    const { createQuestionBankWorkspaceService } = (await import(
      /* @vite-ignore */ '/src/question-bank-workspaces.ts'
    )) as typeof import('../src/question-bank-workspaces')
    const { saveImage } = (await import(
      /* @vite-ignore */ '/src/local-images.ts'
    )) as typeof import('../src/local-images')
    const canvas = new OffscreenCanvas(4, 3)
    const context = canvas.getContext('2d')!
    context.fillStyle = '#9f5037'
    context.fillRect(0, 0, 4, 3)
    const src = await saveImage(await canvas.convertToBlob({ type: 'image/png' }))
    const banks = createQuestionBankWorkspaceService()
    const bank = await banks.create()
    await banks.commit(bank.id, { kind: 'rename', name })
    await banks.commit(bank.id, {
      kind: 'create-question',
      question: {
        id: `question-${crypto.randomUUID()}`,
        type: 'open',
        columns: 1,
        topics: [],
        doc: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Label the cell.' }] },
            { type: 'image', attrs: { src, alt: '', title: '' } },
          ],
        },
      },
    })
  }, bankName)
}

async function bankNames(page: Page) {
  return page.evaluate(async () => {
    const { createQuestionBankWorkspaceService } = (await import(
      /* @vite-ignore */ '/src/question-bank-workspaces.ts'
    )) as typeof import('../src/question-bank-workspaces')
    return (await createQuestionBankWorkspaceService().recent()).map((bank) => bank.name).sort()
  })
}

async function mediaCount(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('test-parrot-exams-v1')
    const database = await new Promise<IDBDatabase>((resolve) => { request.onsuccess = () => resolve(request.result) })
    const count = database.transaction('media-assets').objectStore('media-assets').count()
    const result = await new Promise<number>((resolve) => { count.onsuccess = () => resolve(count.result) })
    database.close()
    return result
  })
}

async function renameOnlyBank(page: Page, name: string) {
  await page.evaluate(async (next) => {
    const { createQuestionBankWorkspaceService } = (await import(
      /* @vite-ignore */ '/src/question-bank-workspaces.ts'
    )) as typeof import('../src/question-bank-workspaces')
    const banks = createQuestionBankWorkspaceService()
    const [bank] = await banks.recent()
    await banks.commit(bank!.id, { kind: 'rename', name: next })
  }, name)
}

function panel(page: Page) {
  return page.getByRole('region', { name: 'Backup and sync' })
}

async function openPanel(page: Page) {
  await page.getByRole('button', { name: /Where your work is stored|Backup and sync/ }).click()
  await expect(panel(page)).toBeVisible()
}

function backupCard(page: Page) {
  return page.getByRole('region', { name: 'Back up your work' })
}

function syncCard(page: Page) {
  return page.getByRole('region', { name: 'Sync with Google Drive' })
}

/** The way in a teacher takes: the top-bar badge, then its Settings button. */
async function openSettings(page: Page) {
  await openPanel(page)
  await panel(page).getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
}

test('a downloaded account backup restores every Question Bank and image', async ({ page }) => {
  await seedAccount(page, 'Biology Bank')
  await page.goto('/question-banks')
  await openPanel(page)
  await expect(panel(page)).toContainText('Your work is saved in your browser.')
  await expect(panel(page)).toContainText('Go to Settings to either export your data or sync it across devices.')
  await panel(page).getByRole('button', { name: 'Settings' }).click()
  await expect(page).toHaveURL(/\/settings$/)

  const downloading = page.waitForEvent('download')
  await backupCard(page).getByRole('button', { name: 'Download backup' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/^test-parrot-account-\d{4}-\d{2}-\d{2}\.zip$/)
  const backup = await readFile((await download.path())!)

  // Work that happens after the backup is what a restore replaces.
  await renameOnlyBank(page, 'Renamed after backup')
  await seedAccount(page, 'Made after backup')
  expect(await bankNames(page)).toEqual(['Made after backup', 'Renamed after backup'])
  expect(await mediaCount(page)).toBe(1)

  // Settings is also a destination in the left nav.
  await page.goto('/question-banks')
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page.getByLabel('Choose an account backup to restore').setInputFiles({
    name: 'test-parrot-account.zip', mimeType: 'application/zip', buffer: backup,
  })
  const confirm = page.getByRole('dialog', { name: 'Restore this backup?' })
  await expect(confirm).toContainText('replaces every Exam, Question Bank')
  await confirm.getByRole('button', { name: 'Replace and reload' }).click()

  await expect(backupCard(page)).toBeVisible()
  await page.goto('/question-banks')
  await expect(page.getByRole('button', { name: `Open Biology Bank. 1` })).toBeVisible()
  await expect(page.getByRole('button', { name: `Open Made after backup. 1` })).toHaveCount(0)
  expect(await bankNames(page)).toEqual(['Biology Bank'])
  expect(await mediaCount(page)).toBe(1)
})

test('a file that is not a backup is refused without changing anything', async ({ page }) => {
  await seedAccount(page, 'Keep me')
  await page.goto('/settings')
  await page.getByLabel('Choose an account backup to restore').setInputFiles({
    name: 'notes.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip'),
  })
  await expect(backupCard(page).getByRole('alert')).toHaveText('This file is not a Test Parrot account backup.')
  await expect(page.getByRole('dialog', { name: 'Restore this backup?' })).toHaveCount(0)
  expect(await bankNames(page)).toEqual(['Keep me'])
})

// ---------------------------------------------------------------------------
// Google: a fake auth broker and an in-memory Drive shared by two devices.

type FakeFile = {
  id: string
  name: string
  mimeType: string
  parents: string[]
  appProperties: Record<string, string>
  body: Buffer
  version: number
  modifiedTime: string
}

function fakeGoogle(appOrigin: string) {
  const google = { signedIn: false, allowed: false }
  const files = new Map<string, FakeFile>()
  const uploads = new Map<string, { method: string; id?: string; metadata: Partial<FakeFile> }>()
  let next = 1
  const cors = {
    'Access-Control-Allow-Origin': appOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With, Authorization, X-Upload-Content-Type, X-Upload-Content-Length',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': 'Location',
  }
  const json = (route: Route, status: number, body?: unknown, headers: Record<string, string> = {}) =>
    route.fulfill({ status, headers: { ...cors, 'Content-Type': 'application/json', ...headers }, body: body === undefined ? '' : JSON.stringify(body) })
  const resource = (file: FakeFile) => ({
    id: file.id, name: file.name, version: String(file.version), modifiedTime: file.modifiedTime, appProperties: file.appProperties, trashed: false,
  })
  const save = (file: Omit<FakeFile, 'version' | 'modifiedTime'> & { version?: number }) => {
    const stored = { ...file, version: (file.version ?? 0) + 1, modifiedTime: new Date().toISOString() }
    files.set(stored.id, stored)
    return stored
  }

  async function broker(route: Route) {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const path = new URL(request.url()).pathname
    const returnTo = () => (JSON.parse(request.postData() ?? '{}') as { returnTo?: string }).returnTo ?? '/'
    if (path === '/auth/google/start') {
      google.signedIn = true
      return json(route, 200, { authorizationUrl: `${appOrigin}${returnTo()}` })
    }
    if (path === '/oauth/google/start') {
      if (!google.signedIn) return json(route, 401, { error: 'unauthorized' })
      google.allowed = true
      return json(route, 200, { authorizationUrl: `${appOrigin}${returnTo()}` })
    }
    if (path === '/oauth/google/connection') {
      if (!google.signedIn) return json(route, 401, { error: 'unauthorized' })
      return json(route, 200, google.allowed
        ? { connected: true, status: 'active', googleEmail: 'teacher@example.com', grantedScopes: ['https://www.googleapis.com/auth/drive.file'] }
        : { connected: false, googleEmail: 'teacher@example.com' })
    }
    if (path === '/oauth/google/token') {
      if (!google.allowed) return json(route, 404, { error: 'not_connected' })
      return json(route, 200, { accessToken: 'fake-token', expiresAt: new Date(Date.now() + 3_600_000).toISOString(), grantedScopes: ['https://www.googleapis.com/auth/drive.file'] })
    }
    if (path === '/auth/logout') { google.signedIn = false; return route.fulfill({ status: 204, headers: cors }) }
    return json(route, 404, { error: 'not_found' })
  }

  async function drive(route: Route) {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const url = new URL(request.url())
    const method = request.method()
    const segments = url.pathname.split('/').filter(Boolean)
    if (url.pathname.startsWith('/upload/session/')) {
      const session = uploads.get(segments.at(-1)!)!
      const body = request.postDataBuffer() ?? Buffer.alloc(0)
      const existing = session.id ? files.get(session.id) : undefined
      const stored = save({
        id: existing?.id ?? `file-${next++}`,
        name: session.metadata.name ?? existing?.name ?? 'untitled',
        mimeType: session.metadata.mimeType ?? existing?.mimeType ?? 'application/zip',
        parents: session.metadata.parents ?? existing?.parents ?? [],
        appProperties: { ...existing?.appProperties, ...session.metadata.appProperties },
        body,
        version: existing?.version,
      })
      return json(route, 200, resource(stored))
    }
    if (url.pathname.startsWith('/upload/drive/v3/files')) {
      const id = `session-${next++}`
      uploads.set(id, { method, id: segments[4], metadata: JSON.parse(request.postData() ?? '{}') })
      return json(route, 200, {}, { Location: `https://www.googleapis.com/upload/session/${id}` })
    }
    // /drive/v3/files[/id[/copy]]
    const id = segments[3]
    if (!id && method === 'GET') {
      const match = /value='([^']+)'/.exec(url.searchParams.get('q') ?? '')
      const found = [...files.values()].filter((file) => file.appProperties.testParrot === match?.[1])
      return json(route, 200, { files: found.map(resource) })
    }
    if (!id && method === 'POST') {
      const metadata = JSON.parse(request.postData() ?? '{}') as FakeFile
      return json(route, 200, resource(save({ ...metadata, id: `folder-${next++}`, parents: [], body: Buffer.alloc(0) })))
    }
    const file = files.get(id!)
    if (!file) return json(route, 404, { error: { message: 'File not found' } })
    if (segments[4] === 'copy') {
      const metadata = JSON.parse(request.postData() ?? '{}') as Partial<FakeFile>
      return json(route, 200, resource(save({ ...file, ...metadata, id: `file-${next++}`, version: 0 })))
    }
    if (url.searchParams.get('alt') === 'media') {
      return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/zip' }, body: file.body })
    }
    return json(route, 200, resource(file))
  }

  return {
    google,
    files,
    async connect(context: BrowserContext) {
      await context.route('https://auth.teacher.dev/**', broker)
      await context.route('https://www.googleapis.com/**', drive)
    },
    accountFile() { return [...files.values()].find((file) => file.appProperties.testParrot === 'account') },
    copies() { return [...files.values()].filter((file) => file.appProperties.testParrot === 'copy') },
  }
}

test('two devices sync through a Test Parrot folder in Google Drive', async ({ browser, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const fake = fakeGoogle(origin)
  const storageState = { cookies: [], origins: [{ origin, localStorage: [{ name: 'test-parrot:welcomed', value: 'true' }] }] }

  // Device A: sign in, allow Drive, and its work goes up.
  const deviceA = await browser.newContext({ storageState })
  await fake.connect(deviceA)
  const a = await deviceA.newPage()
  await seedAccount(a, 'Chemistry Bank')
  await a.goto('/question-banks')
  await openSettings(a)

  const dialog = syncCard(a)
  const signInStep = dialog.getByRole('listitem').filter({ hasText: 'Sign in with Google' })
  const driveStep = dialog.getByRole('listitem').filter({ hasText: 'Allow Google Drive access' })
  await expect(signInStep).toContainText('(to do)')
  await expect(driveStep).toContainText('(to do)')
  await expect(driveStep.getByRole('button', { name: 'Allow' })).toBeDisabled()

  await signInStep.getByRole('button', { name: 'Sign in' }).click()
  // Back from Google, Settings shows the first check earned.
  await expect(signInStep).toContainText('(done)')
  await expect(signInStep).toContainText('Signed in as teacher@example.com')
  await expect(driveStep).toContainText('(to do)')

  await driveStep.getByRole('button', { name: 'Allow' }).click()
  await expect(signInStep).toContainText('(done)')
  await expect(driveStep).toContainText('(done)')
  await expect(dialog.getByRole('definition').first()).toHaveText(/Synced/)
  await expect(dialog.getByRole('link', { name: 'Open in Google Drive' })).toHaveAttribute('href', /drive\.google\.com\/drive\/folders\/folder-/)
  expect(fake.accountFile()?.name).toBe('Test Parrot account.zip')
  expect([...fake.files.values()].find((file) => file.appProperties.testParrot === 'folder')?.name).toBe('Test Parrot')

  // Device B: empty, joins the same Google account and receives A's work.
  const deviceB = await browser.newContext({ storageState })
  await fake.connect(deviceB)
  const b = await deviceB.newPage()
  await b.goto('/question-banks')
  expect(await bankNames(b)).toEqual([])
  await openSettings(b)
  await syncCard(b).getByRole('button', { name: 'Turn on sync' }).click()
  await expect(syncCard(b).getByRole('definition').first()).toHaveText(/Synced/)
  await b.goto('/question-banks')
  await expect(b.getByRole('button', { name: `Open Chemistry Bank. 1` })).toBeVisible()
  expect(await bankNames(b)).toEqual(['Chemistry Bank'])
  expect(await mediaCount(b)).toBe(1)

  // A changes; B picks it up the next time it opens.
  await renameOnlyBank(a, 'Chemistry, revised')
  await a.goto('/settings')
  await syncCard(a).getByRole('button', { name: 'Sync now' }).click()
  await expect(syncCard(a).getByRole('definition').first()).toHaveText(/Synced/)
  await b.reload()
  await expect(b.getByRole('button', { name: `Open Chemistry, revised. 1` })).toBeVisible()

  // Both change before syncing: B chooses, and A's version is kept as a copy.
  await renameOnlyBank(a, 'Chemistry from A')
  await a.goto('/settings')
  await syncCard(a).getByRole('button', { name: 'Sync now' }).click()
  await expect(syncCard(a).getByRole('definition').first()).toHaveText(/Synced/)

  await renameOnlyBank(b, 'Chemistry from B')
  await b.goto('/question-banks')
  await openPanel(b)
  // Opening the page already ran a sync pass, which found both sides changed.
  await expect(panel(b)).toContainText('Needs your choice')
  await panel(b).getByRole('button', { name: 'Settings' }).click()
  const conflictDialog = syncCard(b)
  await expect(conflictDialog.getByRole('button', { name: 'Sync now' })).toBeDisabled()
  await expect(conflictDialog).toContainText('This device and Google Drive both have changes.')
  await conflictDialog.getByRole('button', { name: 'Keep this device’s work' }).click()
  await expect(conflictDialog.getByRole('definition').first()).toHaveText(/Synced/)
  expect(fake.copies().map((file) => file.name)).toEqual([expect.stringMatching(/^Test Parrot account \(replaced .+\)\.zip$/)])

  await a.goto('/question-banks')
  await expect(a.getByRole('button', { name: `Open Chemistry from B. 1` })).toBeVisible()

  await deviceA.close()
  await deviceB.close()
})
