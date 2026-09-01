import { useEffect, useState } from 'react'

/**
 * The whole router. Test Parrot is one editor plus two static pages, so the
 * path is all the state a route needs and `history.pushState` is all the
 * navigation — no library, no route table.
 */
const NAVIGATE_EVENT = 'testparrot:navigate'

function currentPath(): string {
  return window.location.pathname || '/'
}

export function useRoute(): string {
  const [route, setRoute] = useState(currentPath)
  useEffect(() => {
    const onChange = () => setRoute(currentPath())
    // Back/forward buttons fire `popstate`; our own links fire the custom
    // event, because `pushState` deliberately does not.
    window.addEventListener('popstate', onChange)
    window.addEventListener(NAVIGATE_EVENT, onChange)
    return () => {
      window.removeEventListener('popstate', onChange)
      window.removeEventListener(NAVIGATE_EVENT, onChange)
    }
  }, [])
  return route
}

export function navigate(to: string): void {
  if (window.location.pathname === to) return
  window.history.pushState(null, '', to)
  window.dispatchEvent(new Event(NAVIGATE_EVENT))
  window.scrollTo(0, 0)
}
