import { NextResponse } from "next/server";
import { databaseReady, db } from "@/lib/db";

export async function GET() {
  try {
    await databaseReady;
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, database: "ready", chromium: process.env.PLAYWRIGHT_BROWSERS_PATH ? "configured" : "install required" });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
