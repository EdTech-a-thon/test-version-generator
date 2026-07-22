"use client";

import Link from "next/link";
import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

function LoginForm() {
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const result = await signIn("credentials", { email: String(form.get("email")), password: String(form.get("password")), redirect: false });
    if (result?.error) { setMessage("That email address or password did not match an account."); setSaving(false); return; }
    window.location.assign("/banks");
  }
  return <section className="workspace auth-page"><p className="eyebrow">Your assessment workspace</p><h1>Sign in</h1>{searchParams.get("registered") && <p className="notice">Your workspace is ready. Sign in to begin.</p>}<form className="editor" onSubmit={login}><label>Email address<input name="email" type="email" autoComplete="email" defaultValue={searchParams.get("email") ?? ""} required /></label><label>Password<input name="password" type="password" autoComplete="current-password" required /></label>{message && <p className="warning">{message}</p>}<button className="primary" disabled={saving}>{saving ? "Signing in..." : "Sign in"}</button></form><p>New to Test Generator? <Link href="/register">Create an account</Link>.</p></section>;
}

export default function LoginPage() {
  return <main><header className="topbar"><Link href="/" className="brand">Test Generator</Link><span>Welcome back</span></header><Suspense fallback={<section className="workspace auth-page">Loading sign in...</section>}><LoginForm /></Suspense></main>;
}
