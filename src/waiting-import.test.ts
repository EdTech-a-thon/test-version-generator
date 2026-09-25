import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { accountDatabaseNames } from './account-backup'
import { PIXEL_PNG } from './export-fixtures'
import { initialSelection } from './import-selection'
import { inspectImportRecord } from './package-import'
import { mediaAssetOf, pendingImagesOf } from './pending-images'
import { createQuestionBankWorkspaceService } from './question-bank-workspaces'
import { MEDIA_ASSET_STORE, STORAGE_NAME } from './storage-schema'
import {
  WAITING_IMPORT_DATABASE,
  discardWaitingImport,
  expireWaitingImport,
  readWaitingImport,
  saveWaitingImport,
  type WaitingImport,
} from './waiting-import'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

const waiting = (fileName: string, createdAt = new Date().toISOString()): WaitingImport => ({
  fileName,
  bytes: new Uint8Array([37, 80, 68, 70, 1, 2, 3]),
  pageCount: 2,
  tags: [{ tag: 1, page: 1, box: { left: 100, top: 100, right: 500, bottom: 400 }, width: 40, height: 30 }],
  pageText: ['Use the map.', ''],
  createdAt,
})

describe('the waiting import', () => {
  test('keeps the Source Document until it is discarded', async () => {
    expect(await readWaitingImport()).toBeNull()
    await saveWaitingImport(waiting('unit-test.pdf'))

    const resumed = await readWaitingImport()
    expect(resumed).toMatchObject({ fileName: 'unit-test.pdf', pageCount: 2, pageText: ['Use the map.', ''] })
    expect([...resumed!.bytes]).toEqual([37, 80, 68, 70, 1, 2, 3])
    expect(resumed!.tags[0]).toMatchObject({ tag: 1, page: 1 })

    await discardWaitingImport()
    expect(await readWaitingImport()).toBeNull()
  })

  test('only one import waits: a new Source Document replaces the old one', async () => {
    await saveWaitingImport(waiting('first.pdf'))
    await saveWaitingImport(waiting('second.pdf'))
    expect((await readWaitingImport())!.fileName).toBe('second.pdf')
  })

  test('is deleted once it is more than seven days old', async () => {
    const created = new Date('2026-09-01T09:00:00Z')
    await saveWaitingImport(waiting('old.pdf', created.toISOString()))

    await expireWaitingImport(new Date('2026-09-07T09:00:00Z'))
    expect(await readWaitingImport(new Date('2026-09-07T09:00:00Z'))).not.toBeNull()

    await expireWaitingImport(new Date('2026-09-08T09:00:01Z'))
    expect(await readWaitingImport(new Date('2026-09-01T09:00:00Z'))).toBeNull()
  })

  test('is left out of Account Backups', async () => {
    const banks = createQuestionBankWorkspaceService()
    await banks.create()
    await saveWaitingImport(waiting('unit-test.pdf'))

    const names = await accountDatabaseNames()
    expect(names).toContain(STORAGE_NAME)
    expect(names).not.toContain(WAITING_IMPORT_DATABASE)
  })
})

const example = join(import.meta.dir, '..', 'public', 'formats', 'question-bank', '0.4.0', 'examples', 'pending-images.json')

async function storedMediaHashes(): Promise<string[]> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(STORAGE_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise((resolve) => {
      const request = database.transaction(MEDIA_ASSET_STORE, 'readonly').objectStore(MEDIA_ASSET_STORE).getAllKeys()
      request.onsuccess = () => resolve(request.result.map(String))
    })
  } finally {
    database.close()
  }
}

const imagesOf = (value: unknown): Record<string, unknown>[] => {
  const found: Record<string, unknown>[] = []
  const visit = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(visit)
    else if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>
      if (record.type === 'image' || record.type === 'image-block') found.push(record.attrs as Record<string, unknown>)
      Object.values(record).forEach(visit)
    }
  }
  visit(value)
  return found
}

describe('committing an import with Pending Images', () => {
  test('resolved ones become stored images, a shared tag is one asset, and the rest stay pending', async () => {
    const banks = createQuestionBankWorkspaceService()
    const proposal = await inspectImportRecord(await Bun.file(example).bytes())
    const occurrences = pendingImagesOf(proposal)
    expect(occurrences.map(({ questionNumber, where, pending }) => [questionNumber, where, pending])).toEqual([
      [1, 'Question', { image: 1 }],
      [2, 'Answer A', { image: 2 }],
      [2, 'Answer B', { image: 3 }],
      [2, 'Answer C', { image: 4 }],
      [3, 'Question', { image: 1 }],
      [4, 'Question', { page: 4 }],
    ])
    const map = await mediaAssetOf(PIXEL_PNG.data, 'image/png')
    // IMG 1 is resolved everywhere it is used; IMG 2–4 and the page are left.
    const resolution = new Map(
      occurrences.filter(({ pending }) => 'image' in pending && pending.image === 1).map(({ key }) => [key, map]),
    )
    await saveWaitingImport(waiting('history.pdf'))

    const result = await banks.commitImport(proposal, initialSelection(proposal), {
      resolution,
      finishesWaitingImport: true,
    })

    const bank = (await banks.read(result.createdBankIds[0]!))!
    const images = bank.questions.map((question) => imagesOf(question.doc))
    const hash = map.id.slice('sha256:'.length)
    expect(images[0]).toEqual([
      expect.objectContaining({ src: `/local-images/${hash}`, caption: 'Major European Trading Stations c. 1750' }),
    ])
    expect(images[0]![0]!.pending).toBeUndefined()
    expect(images[2]![0]).toMatchObject({ src: `/local-images/${hash}` })
    expect(images[1]!.map((attrs) => attrs.pending)).toEqual([{ image: 2 }, { image: 3 }, { image: 4 }])
    expect(images[3]![0]).toMatchObject({ src: '', pending: { page: 4 } })
    expect(await storedMediaHashes()).toEqual([hash])
    expect(await readWaitingImport()).toBeNull()
  })

  test('an import not paired with the waiting one leaves it waiting', async () => {
    const banks = createQuestionBankWorkspaceService()
    const proposal = await inspectImportRecord(await Bun.file(example).bytes())
    await saveWaitingImport(waiting('history.pdf'))

    await banks.commitImport(proposal, initialSelection(proposal))

    expect(await readWaitingImport()).not.toBeNull()
  })
})
