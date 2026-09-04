const databaseName = 'test-parrot-version-history-v1'
const databaseVersion = 2
const mediaStore = 'media-assets'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

function assetFor(hash) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(mediaStore)) {
        request.result.createObjectStore(mediaStore, { keyPath: 'hash' })
      }
    }
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
