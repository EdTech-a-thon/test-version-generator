import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { BanksWorkspace, type BankSummary } from "@/components/banks-workspace";
import { db } from "@/lib/db";
import { auth } from "@/auth";

export default async function BanksPage() {
  const session = await auth();
  const orgId = session?.selectedOrgId;
  const banks: BankSummary[] | null = orgId ? await db.bank.findMany({ where: { orgId, status: "ACTIVE" }, include: { _count: { select: { questions: true } } }, orderBy: { name: "asc" } }) : null;

  return <main><AppHeader current="Question banks" /><section className="workspace"><div className="section-heading"><div><p className="eyebrow">Your starting point</p><h1>Question banks</h1><p className="lead">Make one bank for each unit or assessment topic. Add questions there, then create a test from that bank.</p></div><Link className="secondary" href="/ingest">Import questions</Link></div><BanksWorkspace initialBanks={banks} /></section></main>;
}
