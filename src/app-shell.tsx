import type { ReactNode } from 'react'
import { FileText, HardDrive, House, Library } from 'lucide-react'
import type { PersistentStorageStatus } from './durable-storage'
import { Footer, Link } from './site-chrome'
import { useRoute } from './use-route'

/**
 * The utility-app chrome every page outside the editor wears: a fixed left nav
 * naming the resource destinations, breadcrumbs across the top, and the page
 * itself in between. The editor keeps its own full-width document bar and is
 * reached by opening or creating an Exam rather than by a separate nav entry.
 */

export type Crumb = { label: string; href?: string }

const NAV = [
  { href: '/', label: 'Home', Icon: House },
  { href: '/exams', label: 'Exams', Icon: FileText },
  { href: '/question-banks', label: 'Question Banks', Icon: Library },
] as const

/**
 * Where the work lives, said once, quietly. It is a standing fact about the
 * whole app rather than news, so it gets an icon in the bar and a tooltip —
 * not a banner across the top of Home.
 */
function StorageBadge({ status }: { status: PersistentStorageStatus }) {
  return (
    <div className="storage-badge">
      <button
        type="button"
        className="storage-badge-button"
        data-status={status}
        aria-label="Where your work is stored"
        aria-describedby="storage-tip"
      >
        <HardDrive aria-hidden="true" />
      </button>
      <div className="storage-tip" id="storage-tip" role="tooltip">
        <strong>Your work stays in this browser</strong>
        <p>
          Exams, Question Banks, Working Copies, and Export History are saved in this browser.
          There is no account, cloud sync, cross-device recovery, or archival guarantee. Export
          or back up important work externally.
        </p>
        {status === 'denied' && (
          <p className="storage-warning">
            Persistent storage was denied. Your browser may clear this local data when space is
            needed.
          </p>
        )}
        {status === 'granted' && (
          <p className="storage-status">Persistent browser storage is enabled.</p>
        )}
      </div>
    </div>
  )
}

export function AppShell({
  crumbs,
  persistentStorage,
  actions,
  children,
}: {
  crumbs: readonly Crumb[]
  persistentStorage: PersistentStorageStatus
  /** Page-level actions, shown in the top bar beside the storage badge. */
  actions?: ReactNode
  children: ReactNode
}) {
  const route = useRoute()
  return (
    <div className="app-shell">
      <aside className="app-nav">
        <Link href="/" className="site-wordmark app-nav-brand">
          <img className="app-logo" src="/logo.png" alt="" width={36} height={36} />
          Test Parrot
        </Link>
        <nav aria-label="Sections">
          <ul className="app-nav-list">
            {NAV.map(({ href, label, Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="app-nav-link"
                  {...(route === href ? { 'aria-current': 'page' } : {})}
                >
                  <Icon aria-hidden="true" />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="app-frame">
        <header className="app-topbar">
          <nav aria-label="Breadcrumb">
            <ol className="breadcrumbs">
              {crumbs.map((crumb, index) => {
                const last = index === crumbs.length - 1
                return (
                  <li key={crumb.label}>
                    {crumb.href && !last ? (
                      <Link href={crumb.href}>{crumb.label}</Link>
                    ) : (
                      <span {...(last ? { 'aria-current': 'page' as const } : {})}>
                        {crumb.label}
                      </span>
                    )}
                  </li>
                )
              })}
            </ol>
          </nav>
          <div className="app-topbar-actions">
            {actions}
            <StorageBadge status={persistentStorage} />
          </div>
        </header>
        <main className="app-main">{children}</main>
        <Footer />
      </div>
    </div>
  )
}
