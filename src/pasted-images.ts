import type { Ctx } from '@milkdown/kit/ctx'
import { editorViewOptionsCtx } from '@milkdown/kit/core'

const IMAGE_PROTOCOLS = new Set(['http:', 'https:', 'blob:'])

export function safePastedImageSource(value: string): string | undefined {
  const source = value.trim()
  if (!source) return undefined

  if (source.startsWith('/')) return source

  if (source.startsWith('data:')) {
    return source.startsWith('data:image/') ? source : undefined
  }

  try {
    const base = globalThis.location?.href ?? 'https://example.invalid/'
    const url = new URL(source, base)
    return IMAGE_PROTOCOLS.has(url.protocol) ? source : undefined
  } catch {
    return undefined
  }
}

export function firstPastedImageSource(html: string): string | undefined {
  if (!html || typeof DOMParser === 'undefined') return undefined

  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const img of doc.querySelectorAll('img')) {
    const source = safePastedImageSource(img.getAttribute('src') ?? '')
    if (source) return source
  }
  return undefined
}

export function configurePastedImages(ctx: Ctx) {
  ctx.update(editorViewOptionsCtx, (prev) => ({
    ...prev,
    handlePaste(view, event, slice) {
      const source = firstPastedImageSource(
        event.clipboardData?.getData('text/html') ?? '',
      )
      if (source) {
        const imageBlock = view.state.schema.nodes['image-block']
        const node = imageBlock?.createAndFill({
          src: source,
          caption: '',
          ratio: 1,
        })
        if (node) {
          event.preventDefault()
          view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView())
          return true
        }
      }

      return prev.handlePaste?.(view, event, slice) ?? false
    },
  }))
}
