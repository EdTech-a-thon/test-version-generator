"use client";

import { useEffect, useState } from "react";

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
  return bank?.questions.length ? <section className="bank-list">{bank.questions.map((question) => <article className="card" key={question.id}><p className="eyebrow">Difficulty {question.difficulty} of 5</p><h2>{question.stem}</h2><p>{question.tags.length ? question.tags.join(", ") : "No tags yet"}</p><button className="secondary" onClick={() => void remove(question.id)}>Remove from bank</button></article>)}</section> : <section className="empty"><h2>No questions in this bank yet</h2><p>Use Author a question to begin building this collection.</p></section>;
}
