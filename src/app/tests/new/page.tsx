"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/app-header";

export default function NewTestPage() {
  const router = useRouter();
  const [forms, setForms] = useState(4);
  const [strict, setStrict] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setMessage("Generating your forms...");
    const response = await fetch("/api/tests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: values.get("title"), formCount: forms, tag: values.get("tag"),
        itemCount: Number(values.get("itemCount")), targetDifficulty: Number(values.get("difficulty")),
        scrambleChoices: values.get("scramble") === "on", strictDifficulty: strict,
      }),
    });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error ?? "Could not generate forms.");
    router.push(`/tests/${data.id}`);
  }

  return <main><AppHeader current="Create a test" /><section className="workspace"><div className="section-heading"><div><p className="eyebrow">Step 3 of 3: Prepare for class</p><h1>Create test forms</h1><p className="lead">Choose which questions to use, how many versions students need, and print matching answer keys.</p></div><Link className="quiet-link" href="/questions/new">Author another question</Link></div>{message && <p className="notice" role="status">{message}</p>}<div className="editor-grid"><form className="editor" onSubmit={submit}><label>Assessment title<input name="title" defaultValue="Unit 3: Forces" required /></label><label>Forms to generate<input type="number" min="1" max="26" value={forms} onChange={(event) => setForms(Number(event.target.value))} /><span className="field-help">Use one form when every student should receive the same version.</span></label><label>Use questions with this tag<input name="tag" defaultValue="mechanics" placeholder="For example: mechanics" /><span className="field-help">This matches the tags you added while authoring questions.</span></label><label>Questions per form<input name="itemCount" type="number" defaultValue="10" min="1" required /></label><label>Target difficulty<select name="difficulty" defaultValue="3">{[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}</select></label><label className="toggle"><input name="scramble" type="checkbox" defaultChecked /> Put answer choices in a different order on each form</label><label className="toggle"><input type="checkbox" checked={strict} onChange={(event) => setStrict(event.target.checked)} /> Only use questions at this exact difficulty</label><button className="primary">Generate {forms} form{forms === 1 ? "" : "s"}</button></form><aside className="preview"><p className="eyebrow">Before you generate</p><h2>What you will get</h2><ol className="checklist"><li>{forms} student form{forms === 1 ? "" : "s"}, labeled A through {String.fromCharCode(64 + forms)}.</li><li>A matching answer key for every form.</li><li>Forms that stay unchanged after generation, even if you edit a question later.</li></ol><p className="helper">If exact difficulty is off, FormForge can use nearby levels to make a complete assessment.</p></aside></div></section></main>;
}
