"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function RegisterPage() {
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        email,
        password,
        organizationName: form.get("organizationName"),
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      setMessage(result.error ?? "We could not create your account.");
      setSaving(false);
      return;
    }
    window.location.assign(`/login?email=${encodeURIComponent(email)}&registered=1`);
  }

  return <main><header className="topbar"><Link href="/" className="brand">Test Generator</Link><span>Get started</span></header><section className="workspace auth-page"><p className="eyebrow">Your assessment workspace</p><h1>Create your account</h1><p className="lead">Your organization keeps your question banks and assessments together.</p><form className="editor" onSubmit={register}><label>Your name<input name="name" autoComplete="name" required /></label><label>Organization or school name<input name="organizationName" autoComplete="organization" required /></label><label>Email address<input name="email" type="email" autoComplete="email" required /></label><label>Password<input name="password" type="password" minLength={8} autoComplete="new-password" required /></label>{message && <p className="warning">{message}</p>}<button className="primary" disabled={saving}>{saving ? "Creating your workspace..." : "Create account"}</button></form><p>Already have an account? <Link href="/login">Sign in</Link>.</p></section></main>;
}
