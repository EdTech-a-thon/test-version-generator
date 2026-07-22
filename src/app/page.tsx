import Link from "next/link";
import { AppHeader } from "@/components/app-header";

const cards = [
  ["Question banks", "Build reusable, tagged questions with difficulty and complete history.", "/banks"],
  ["New question", "Write a static or parametric item and verify its generated variants.", "/questions/new"],
  ["Import review", "Review extracted material before it ever reaches a bank.", "/ingest"],
  ["Assemble forms", "Balance, scramble, and print scan-ready student forms and answer keys.", "/tests/new"],
];
export default function Home() { return <main><AppHeader current="Assessment workspace" /><section className="hero"><p className="eyebrow">Assessment studio</p><h1>Make a fair test. Print it with confidence.</h1><p>Build a question bank, make the versions you need, and print student forms with matching answer keys.</p><div className="hero-actions"><Link className="primary" href="/register">Create your workspace</Link><Link className="quiet-link" href="/login">Sign in</Link></div></section><section className="workflow" aria-labelledby="workflow-title"><div><p className="eyebrow">A simple path</p><h2 id="workflow-title">From question to classroom</h2></div><ol><li><strong>1. Build a bank</strong><span>Keep questions ready for the next assessment.</span></li><li><strong>2. Assemble forms</strong><span>Choose the number of questions and versions.</span></li><li><strong>3. Print with keys</strong><span>Use the matching student form and answer key.</span></li></ol></section><section className="card-grid">{cards.map(([title, description, href]) => <Link className="card" href={href} key={title}><h2>{title}</h2><p>{description}</p><span>Open workspace &rarr;</span></Link>)}</section></main>; }
