"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";

const links = [
  { href: "/banks", label: "Question banks" },
  { href: "/questions/new", label: "Author" },
  { href: "/ingest", label: "Import" },
  { href: "/tests/new", label: "Create test" },
];

export function AppHeader({ current }: { current?: string }) {
  const pathname = usePathname();
  const [name, setName] = useState("");
  useEffect(() => { void fetch("/api/auth/session").then((response) => response.ok ? response.json() : null).then((session) => setName(session?.user?.name || session?.user?.email || "")); }, []);

  return (
    <header className="topbar">
      <Link href="/" className="brand">Test Generator</Link>
      <nav aria-label="Main navigation">
        {links.map((link) => {
          const active = pathname === link.href || (link.href === "/banks" && pathname.startsWith("/banks"));
          return <Link href={link.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined} key={link.href}>{link.label}</Link>;
        })}
      </nav>
      {name ? <div className="account-menu"><span>{name}</span><button className="text-button" onClick={() => void signOut({ callbackUrl: "/" })}>Sign out</button></div> : <Link href="/login" className="account-link">Sign in</Link>}
      <span className="page-context">{current}</span>
    </header>
  );
}
