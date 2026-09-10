const registryDatabaseName = 'test-parrot-exams-v1'
const databaseVersion = 5
const workspaceStore = 'exam-workspace'
const mediaStore = 'media-assets'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

function activeExamDatabaseName() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(registryDatabaseName, databaseVersion)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(workspaceStore)) {
        database.close()
        resolve(null)
        return
      }
      const transaction = database.transaction(workspaceStore, 'readonly')
      const get = transaction.objectStore(workspaceStore).get('active')
      get.onsuccess = () => resolve(
        typeof get.result?.examId === 'string'
          ? `${registryDatabaseName}-exam-${get.result.examId}`
          : null,
      )
      get.onerror = () => reject(get.error)
      transaction.oncomplete = () => database.close()
    }
  })
}

function assetFor(hash) {
  return activeExamDatabaseName().then((databaseName) => {
    if (!databaseName) return null
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(mediaStore)) {
          database.close()
          resolve(null)
          return
        }
        const transaction = database.transaction(mediaStore, 'readonly')
        const get = transaction.objectStore(mediaStore).get(hash)
        get.onsuccess = () => resolve(get.result ?? null)
        get.onerror = () => reject(get.error)
        transaction.oncomplete = () => database.close()
      }
    })
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
  event.respondWith(assetFor(hash).then(
    (asset) => asset
      ? new Response(asset.bytes, { headers: { 'Content-Type': asset.mimeType } })
      : new Response('Image not found', { status: 404 }),
    () => new Response('Image not found', { status: 404 }),
  ))
})
