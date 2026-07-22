import { NextResponse } from "next/server";
import { z } from "zod";
import { generateVariants } from "@/lib/parametric";
import { requireTenant } from "@/lib/tenant";

const schema = z.object({ definition: z.any(), count: z.number().int().min(1).max(20).default(4) });
const previews = new Map<string, number[]>();

export async function POST(request: Request) {
  try {
    const tenant = await requireTenant();
    const now = Date.now();
    const history = (previews.get(tenant.userId) ?? []).filter((time) => now - time < 60_000);
    if (history.length >= 20) return NextResponse.json({ error: "Preview limit reached. Please wait a minute." }, { status: 429 });
    previews.set(tenant.userId, [...history, now]);
    const body = schema.parse(await request.json());
    return NextResponse.json(await generateVariants(body.definition, body.count));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not generate preview." }, { status: 400 });
  }
}
