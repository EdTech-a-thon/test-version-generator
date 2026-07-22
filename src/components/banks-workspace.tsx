"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export type BankSummary = { id: string; name: string; description: string | null; _count: { questions: number } };

export function BanksWorkspace({ initialBanks }: { initialBanks: BankSummary[] | null }) {
  const [banks, setBanks] = useState(initialBanks ?? []);
  const [name, setName] = useState("");
  const [error, setError] = useState(initialBanks === null ? "Sign in to view and create question banks." : "");
  const [saving, setSaving] = useState(false);

  async function create(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError("");
    const response = await fetch("/api/banks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Could not create a question bank."); setSaving(false); return; }
    setBanks((current) => [...current, { ...data, _count: { questions: 0 } }].sort((a, b) => a.name.localeCompare(b.name)));
    setName(""); setSaving(false);
  }

  return <><form className="toolbar" onSubmit={create}><label className="sr-only" htmlFor="bank-name">New bank name</label><input id="bank-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="New bank name, for example Unit 3" required /><button className="primary" disabled={saving}>{saving ? "Creating..." : "Create bank"}</button></form>{error && <p className="warning">{error} <Link href="/register">Create an account</Link> or <Link href="/login">sign in</Link> to continue.</p>}{banks.length ? <><p className="collection-summary">{banks.length} bank{banks.length === 1 ? "" : "s"} available. Open a bank to review its questions.</p><section className="bank-list">{banks.map((bank) => <article className="card" key={bank.id}><h2>{bank.name}</h2><p>{bank.description || "A reusable collection of assessment questions."}</p><strong>{bank._count.questions} question{bank._count.questions === 1 ? "" : "s"}</strong><Link className="quiet-link" href={`/banks/${bank.id}`}>Open bank</Link></article>)}</section></> : <section className="empty"><p className="eyebrow">Start here</p><h2>Create your first question bank</h2><p>A bank can be a unit, course, grade level, or shared department collection. Then add questions to use in any future assessment.</p><form className="inline-action" onSubmit={create}><label className="sr-only" htmlFor="empty-bank-name">New bank name</label><input id="empty-bank-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="For example: Grade 8 science" required /><button className="primary" disabled={saving}>{saving ? "Creating..." : "Create first bank"}</button></form></section>}</>;
}
