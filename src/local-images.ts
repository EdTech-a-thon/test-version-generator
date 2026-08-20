const imagePath = '/local-images/'

export async function saveImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file.')
  }

  const id = crypto.randomUUID()
  const url = `${imagePath}${id}`
  const cache = await caches.open('crepe-local-images-v1')
  await cache.put(
    url,
    new Response(file, {
      headers: {
        'Content-Type': file.type,
        'Content-Length': String(file.size),
      },
    }),
  )
  return url
}
