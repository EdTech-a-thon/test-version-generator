"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/app-header";

type Bank = { id: string; name: string };

export default function NewTestPage() {
  const router = useRouter();
  const [forms, setForms] = useState(4);
  const [strict, setStrict] = useState(false);
  const [message, setMessage] = useState("");
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankId, setBankId] = useState("");
  const [loadingBanks, setLoadingBanks] = useState(true);

  useEffect(() => {
    const requestedBank = new URLSearchParams(window.location.search).get("bank");
    void fetch("/api/banks").then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load your question banks.");
      setBanks(data);
      setBankId(data.some((bank: Bank) => bank.id === requestedBank) ? requestedBank! : data[0]?.id ?? "");
    }).catch((error: Error) => setMessage(error.message)).finally(() => setLoadingBanks(false));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setMessage("Generating your forms...");
    const response = await fetch("/api/tests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: values.get("title"), bankId, formCount: forms, tag: values.get("tag"),
        itemCount: Number(values.get("itemCount")), targetDifficulty: Number(values.get("difficulty")),
        scrambleChoices: values.get("scramble") === "on", strictDifficulty: strict,
      }),
    });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error ?? "Could not generate forms.");
    router.push(`/tests/${data.id}`);
  }

  return <main><AppHeader current="Create a test" /><section className="workspace"><div className="section-heading"><div><p className="eyebrow">Final step</p><h1>Create test forms</h1><p className="lead">Choose a question bank, then create the versions and answer keys your class needs.</p></div><Link className="quiet-link" href={bankId ? `/banks/${bankId}` : "/banks"}>Back to question bank</Link></div>{message && <p className="notice" role="status">{message}</p>}{loadingBanks ? <p className="notice">Loading your question banks...</p> : !banks.length ? <section className="empty"><p className="eyebrow">Start with a bank</p><h2>Create a question bank first</h2><p>Tests are built from one bank, so the questions stay focused on the topic you are assessing.</p><Link className="primary" href="/banks">Create a question bank</Link></section> : <div className="editor-grid"><form className="editor" onSubmit={submit}><label>Question bank<select value={bankId} onChange={(event) => setBankId(event.target.value)} required>{banks.map((bank) => <option value={bank.id} key={bank.id}>{bank.name}</option>)}</select><span className="field-help">Only questions in this bank will be used.</span></label><label>Assessment title<input name="title" defaultValue="Unit assessment" required /></label><label>Questions per form<input name="itemCount" type="number" defaultValue="10" min="1" required /></label><label>Forms to generate<input type="number" min="1" max="26" value={forms} onChange={(event) => setForms(Number(event.target.value))} /><span className="field-help">Use one form when every student should receive the same version.</span></label><label>Optional tag filter<input name="tag" placeholder="For example: review" /><span className="field-help">Leave blank to use all questions in this bank.</span></label><label>Target difficulty<select name="difficulty" defaultValue="3">{[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}</select></label><label className="toggle"><input name="scramble" type="checkbox" defaultChecked /> Put answer choices in a different order on each form</label><label className="toggle"><input type="checkbox" checked={strict} onChange={(event) => setStrict(event.target.checked)} /> Only use questions at this exact difficulty</label><button className="primary">Generate {forms} form{forms === 1 ? "" : "s"}</button></form><aside className="preview"><p className="eyebrow">Before you generate</p><h2>What you will get</h2><ol className="checklist"><li>{forms} student form{forms === 1 ? "" : "s"}, labeled A through {String.fromCharCode(64 + forms)}.</li><li>A matching answer key for every form.</li><li>Questions from the bank you selected, with choices scrambled if selected.</li></ol></aside></div>}</section></main>;
}
