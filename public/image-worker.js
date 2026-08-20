const cacheName = 'crepe-local-images-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/local-images/')) return

  event.respondWith(
    caches.open(cacheName).then(async (cache) => {
      const image = await cache.match(event.request)
      return image ?? new Response('Image not found', { status: 404 })
    }),
  )
})
