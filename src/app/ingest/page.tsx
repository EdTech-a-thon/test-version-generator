"use client";

import Link from "next/link";
import { useState } from "react";
import { AppHeader } from "@/components/app-header";

type Candidate = { id: string; stem: string; status: string; confidence: Record<string, number>; sourcePreview?: { row?: number } };
type Job = { id: string; status: string; candidates: Candidate[] };

export default function IngestPage() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [job, setJob] = useState<Job | null>(null);
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
  return <main><AppHeader current="Import questions" /><section className="workspace narrow-workspace"><p className="eyebrow">Add existing material</p><h1>Import questions for review</h1><p className="lead">Bring in a spreadsheet or a previous assessment. You stay in control: nothing is added to a question bank until you review it.</p><section className="upload"><div><h2>Choose a file</h2><p className="helper">Spreadsheets can create review drafts. PDFs and images are stored safely while extraction is being set up.</p></div><label className="file-picker"><span>Choose file</span><input type="file" accept=".csv,.xlsx,.pdf,image/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>{file && <div className="selected-file"><strong>{file.name}</strong><button className="primary" onClick={() => void upload()}>Start review</button></div>}{status && <p className="notice" role="status">{status}</p>}</section><p className="next-step">Prefer to start fresh? <Link href="/questions/new">Author a question instead</Link>.</p>{job && <section className="review-queue"><p className="eyebrow">Review before saving</p><h2>Review queue</h2>{job.candidates.length ? job.candidates.map((candidate) => <article className="card" key={candidate.id}><h3>{candidate.stem}</h3><p>Source row: {candidate.sourcePreview?.row ?? "not available"}. Confidence: {Object.entries(candidate.confidence).map(([field, value]) => `${field} ${Math.round(value * 100)}%`).join(", ")}.</p><p className="warning">Review and edit this draft before approval. PDF/image extraction requires a configured provider.</p></article>) : <section className="empty"><h3>No question drafts were detected</h3><p>Try a spreadsheet with one question per row, or <Link href="/questions/new">add an item manually</Link>.</p></section>}</section>}</section></main>;
}
