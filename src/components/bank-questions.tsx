"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { renderMarkup } from "@/lib/render-markup";

type Question = { id: string; stem: string; difficulty: number; tags: string[] };
type Bank = { name: string; questions: Question[] };

export function BankQuestions({ bankId }: { bankId: string }) {
  const [bank, setBank] = useState<Bank | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => { void fetch(`/api/banks/${bankId}/questions`).then((response) => response.json()).then((data) => { if (data.questions) setBank(data); else setMessage(data.error ?? "Could not load questions."); }); }, [bankId]);
  async function remove(questionId: string) {
    const response = await fetch(`/api/banks/${bankId}/questions?questionId=${questionId}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error ?? "Could not remove this question.");
    setBank((current) => current ? { ...current, questions: current.questions.filter((question) => question.id !== questionId) } : current);
  }
  if (!bank && !message) return <p className="notice">Loading questions...</p>;
  if (message) return <p className="warning">{message}</p>;
  return bank?.questions.length ? <>
    <section className="bank-progress">
      <div><p className="eyebrow">Ready for the next step</p><h2>{bank.questions.length} question{bank.questions.length === 1 ? "" : "s"} in this bank</h2><p>Create a test from this collection when you have the questions you need.</p></div>
      <Link className="primary" href={`/tests/new?bank=${bankId}`}>Create a test from this bank</Link>
    </section>
    <section className="bank-list">{bank.questions.map((question) => <article className="card" key={question.id}><p className="eyebrow">Difficulty {question.difficulty} of 5</p><h2>{renderMarkup(question.stem)}</h2><p>{question.tags.length ? question.tags.join(", ") : "No tags yet"}</p><div className="completion-actions"><Link className="secondary" href={`/questions/new?id=${question.id}&bank=${bankId}`}>Edit</Link><button className="secondary" onClick={() => void remove(question.id)}>Remove from bank</button></div></article>)}</section>
  </> : <section className="empty"><p className="eyebrow">Next step</p><h2>Add questions to {bank?.name}</h2><p>Write new questions or import existing ones. Once this bank has questions, you can create a test from it.</p><div className="completion-actions"><Link className="primary" href={`/questions/new?bank=${bankId}`}>Add a question</Link><Link className="secondary" href={`/ingest?bank=${bankId}`}>Import questions</Link></div></section>;
}
