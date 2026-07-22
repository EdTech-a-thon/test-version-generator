"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/app-header";

type Option = { id: string; text: string };
type Candidate = { id: string; stem: string; status: string; confidence: Record<string, number>; sourcePreview?: { row?: number }; proposedData: { options?: Option[]; correctAnswer?: string[]; tags?: string[]; difficulty?: number } };
type Job = { id: string; status: string; candidates: Candidate[] };
type Bank = { id: string; name: string };

function ReviewCandidate({ candidate, banks, onComplete }: { candidate: Candidate; banks: Bank[]; onComplete: (id: string, status: string) => void }) {
  const [stem, setStem] = useState(candidate.stem);
  const [options, setOptions] = useState<Option[]>(candidate.proposedData.options?.length ? candidate.proposedData.options : ["A", "B", "C", "D"].map((id) => ({ id, text: "" })));
  const [correctAnswer, setCorrectAnswer] = useState(candidate.proposedData.correctAnswer?.[0] ?? "");
  const [bankId, setBankId] = useState("");
  const [difficulty, setDifficulty] = useState(candidate.proposedData.difficulty ?? 3);
  const [tags, setTags] = useState(candidate.proposedData.tags?.join(", ") ?? "");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function decide(action: "APPROVE" | "REJECT") {
    setSaving(true); setMessage("");
    const response = await fetch(`/api/ingest/candidates/${candidate.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, bankId, stem, options: options.filter((option) => option.text.trim()), correctAnswer: correctAnswer ? [correctAnswer] : [], difficulty, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) }) });
    const result = await response.json();
    if (!response.ok) { setMessage(result.error ?? "Could not save this review decision."); setSaving(false); return; }
    onComplete(candidate.id, result.status); setSaving(false);
  }

  if (candidate.status !== "DRAFT") return <article className="card"><h3>{candidate.stem}</h3><p className="notice">{candidate.status === "APPROVED" ? "Saved to your question bank." : "This draft was rejected."}</p></article>;

  return <article className="card review-card"><p className="eyebrow">Source row {candidate.sourcePreview?.row ?? "not available"}</p><label>Question<textarea value={stem} rows={3} onChange={(event) => setStem(event.target.value)} required /></label><fieldset><legend>Answer choices</legend>{options.map((option, index) => <label className="choice-input" key={option.id}><input type="radio" name={`correct-${candidate.id}`} value={option.id} checked={correctAnswer === option.id} onChange={() => setCorrectAnswer(option.id)} aria-label={`Correct answer ${option.id}`} /><span>{option.id}</span><input value={option.text} onChange={(event) => setOptions((current) => current.map((value, currentIndex) => currentIndex === index ? { ...value, text: event.target.value } : value))} placeholder={`Choice ${option.id}`} /></label>)}</fieldset><div className="two-col"><label>Save to bank<select value={bankId} onChange={(event) => setBankId(event.target.value)}><option value="">Choose a bank</option>{banks.map((bank) => <option value={bank.id} key={bank.id}>{bank.name}</option>)}</select></label><label>Difficulty<select value={difficulty} onChange={(event) => setDifficulty(Number(event.target.value))}>{[1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value}</option>)}</select></label></div><label>Tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="For example: fractions, review" /></label><p className="field-help">Choose the circle beside the correct answer, then check the question before approving it.</p>{message && <p className="warning">{message}</p>}{!banks.length && <p className="warning">Create a <Link href="/banks">question bank</Link> before approving imported questions.</p>}<div className="review-actions"><button className="primary" disabled={saving || !banks.length} onClick={() => void decide("APPROVE")}>{saving ? "Saving..." : "Approve and save"}</button><button type="button" className="secondary" disabled={saving} onClick={() => void decide("REJECT")}>Reject draft</button></div></article>;
}

export default function IngestPage() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  useEffect(() => { void fetch("/api/banks").then((response) => response.ok ? response.json() : []).then((data) => { if (Array.isArray(data)) setBanks(data); }); }, []);
  async function upload() {
    if (!file) return;
    setStatus("Creating your review queue...");
    const body = new FormData(); body.set("file", file);
    const response = await fetch("/api/ingest", { method: "POST", body });
    const result = await response.json();
    if (!response.ok) return setStatus(result.error ?? "Could not create the review queue.");
    const review = await fetch(`/api/ingest/${result.id}`).then((value) => value.json());
    setJob(review); setStatus("Your material is ready for review. Nothing has been added to a bank.");
  }
  function complete(id: string, candidateStatus: string) { setJob((current) => current ? { ...current, candidates: current.candidates.map((candidate) => candidate.id === id ? { ...candidate, status: candidateStatus } : candidate) } : current); }
  return <main><AppHeader current="Import questions" /><section className="workspace narrow-workspace"><p className="eyebrow">Add existing material</p><h1>Import questions for review</h1><p className="lead">Bring in a spreadsheet or a previous assessment. You stay in control: nothing is added to a question bank until you review it.</p><section className="upload"><div><h2>Choose a file</h2><p className="helper">Spreadsheets can create review drafts. Use columns such as Question, Option A, Option B, and Correct Answer for the quickest review. PDFs and images are stored safely while extraction is being set up.</p></div><label className="file-picker"><span>Choose file</span><input type="file" accept=".csv,.xlsx,.pdf,image/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>{file && <div className="selected-file"><strong>{file.name}</strong><button className="primary" onClick={() => void upload()}>Start review</button></div>}{status && <p className="notice" role="status">{status}</p>}</section><p className="next-step">Prefer to start fresh? <Link href="/questions/new">Author a question instead</Link>.</p>{job && <section className="review-queue"><p className="eyebrow">Review before saving</p><h2>Review queue</h2>{job.candidates.length ? job.candidates.map((candidate) => <ReviewCandidate candidate={candidate} banks={banks} onComplete={complete} key={candidate.id} />) : <section className="empty"><h3>No question drafts were detected</h3><p>Try a spreadsheet with one question per row, or <Link href="/questions/new">add an item manually</Link>.</p></section>}</section>}</section></main>;
}
