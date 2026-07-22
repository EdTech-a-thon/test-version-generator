"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/banks", label: "Question banks" },
  { href: "/questions/new", label: "Author" },
  { href: "/ingest", label: "Import" },
  { href: "/tests/new", label: "Create test" },
];

export function AppHeader({ current }: { current?: string }) {
  const pathname = usePathname();

  return (
    <header className="topbar">
      <Link href="/" className="brand">FormForge</Link>
      <nav aria-label="Main navigation">
        {links.map((link) => {
          const active = pathname === link.href || (link.href === "/banks" && pathname.startsWith("/banks"));
          return <Link href={link.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined} key={link.href}>{link.label}</Link>;
        })}
      </nav>
      <Link href="/login" className="account-link">Sign in</Link>
      <span className="page-context">{current}</span>
    </header>
  );
}
