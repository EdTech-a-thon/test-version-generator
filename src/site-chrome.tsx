import type { MouseEvent, ReactNode } from 'react'
import { navigate } from './use-route'

/**
 * An in-app link. Plain-clicked it routes without a reload; modified clicks
 * (new tab, new window, download) fall through to the browser, so the href
 * has to be a real path rather than a `#`.
 */
export function Link({
  href,
  className,
  children,
}: {
  href: string
  className?: string
  children: ReactNode
}) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (event.button !== 0) return
    event.preventDefault()
    navigate(href)
  }
  return (
    <a href={href} className={className} onClick={onClick}>
      {children}
    </a>
  )
}

/** The bar the About and Privacy pages wear in place of the editor's. */
export function SiteHeader() {
  return (
    <header className="document-bar">
      <Link href="/" className="site-wordmark">
        <img className="app-logo" src="/logo.png" alt="" width={36} height={36} />
        Test Parrot
      </Link>
      <div className="header-actions">
        <Link href="/" className="site-link">
          ← Back to the editor
        </Link>
      </div>
    </header>
  )
}

export function Footer() {
  return (
    <footer className="site-footer">
      <a
        href="https://edtechathon.com"
        target="_blank"
        rel="noopener noreferrer"
        className="site-footer-credit"
      >
        <img src="/edtechathon-logo.svg" alt="" width={24} height={24} />
        Built by the EdTech-a-thon
      </a>
      <Link href="/about" className="site-footer-link">
        about
      </Link>
      <Link href="/privacy" className="site-footer-link">
        privacy
      </Link>
    </footer>
  )
}
