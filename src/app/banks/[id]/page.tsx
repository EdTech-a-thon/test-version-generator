import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { BankQuestions } from "@/components/bank-questions";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export default async function BankPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const bank = session?.selectedOrgId ? await db.bank.findFirst({ where: { id, orgId: session.selectedOrgId, status: "ACTIVE" }, select: { id: true, name: true } }) : null;
  if (!bank) return <main><AppHeader current="Question bank" /><section className="workspace"><h1>Question bank not found</h1><p>This bank is unavailable, or you do not have access to it.</p><Link className="quiet-link" href="/banks">Return to question banks</Link></section></main>;
  return <main><AppHeader current={bank.name} /><section className="workspace"><div className="section-heading"><div><p className="eyebrow">Question bank</p><h1>{bank.name}</h1><p className="lead">Build this collection, then use it to create a focused assessment.</p></div><div className="section-actions"><Link className="secondary" href={`/ingest?bank=${bank.id}`}>Import questions</Link><Link className="primary" href={`/questions/new?bank=${bank.id}`}>Add question</Link></div></div><BankQuestions bankId={bank.id} /></section></main>;
}
