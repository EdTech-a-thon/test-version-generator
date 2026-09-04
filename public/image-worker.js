const databaseName = 'test-parrot-version-history-v1'
const databaseVersion = 2
const questionBankStore = 'question-bank'
const authoringStateStore = 'authoring-state'
const savedAuthoringStore = 'saved-authoring-state'
const mediaStore = 'media-assets'

// The worker can be the first client to open an existing v1 database: a
// persisted image may be requested before the application starts its normal
// authoring backend. Its upgrade must therefore establish the complete v2
// schema, not merely the store it reads.
function upgradeSchema(database) {
  if (!database.objectStoreNames.contains(questionBankStore)) {
    database.createObjectStore(questionBankStore, { keyPath: 'id' })
  }
  if (!database.objectStoreNames.contains(authoringStateStore)) {
    database.createObjectStore(authoringStateStore, { keyPath: 'key' })
  }
  if (!database.objectStoreNames.contains(savedAuthoringStore)) {
    database.createObjectStore(savedAuthoringStore)
  }
  if (!database.objectStoreNames.contains(mediaStore)) {
    database.createObjectStore(mediaStore, { keyPath: 'hash' })
  }
}

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

function assetFor(hash) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = () => upgradeSchema(request.result)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction(mediaStore, 'readonly')
      const get = transaction.objectStore(mediaStore).get(hash)
      get.onsuccess = () => resolve(get.result ?? null)
      get.onerror = () => reject(get.error)
      transaction.oncomplete = () => database.close()
    }
  })
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/local-images/')) return
  const hash = url.pathname.slice('/local-images/'.length)
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    event.respondWith(new Response('Image not found', { status: 404 }))
    return
  }

  event.respondWith(
    assetFor(hash).then(
      (asset) => asset
        ? new Response(asset.bytes, { headers: { 'Content-Type': asset.mimeType } })
        : new Response('Image not found', { status: 404 }),
      () => new Response('Image not found', { status: 404 }),
    ),
  )
})
