import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { BanksWorkspace, type BankSummary } from "@/components/banks-workspace";
import { db } from "@/lib/db";
import { auth } from "@/auth";

export default async function BanksPage() {
  const session = await auth();
  const orgId = session?.selectedOrgId;
  const banks: BankSummary[] | null = orgId ? await db.bank.findMany({ where: { orgId, status: "ACTIVE" }, include: { _count: { select: { questions: true } } }, orderBy: { name: "asc" } }) : null;

  return <main><AppHeader current="Question banks" /><section className="workspace"><div className="section-heading"><div><p className="eyebrow">Step 1 of 3: Build your library</p><h1>Question banks</h1><p className="lead">Organize questions by unit, course, grade, or shared collection so they are ready when you need them.</p></div><Link className="primary" href="/questions/new">Author a question</Link></div><BanksWorkspace initialBanks={banks} /></section></main>;
}
