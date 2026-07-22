import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { LocalDiskMediaStore } from "@/lib/media";
import { requireTenant } from "@/lib/tenant";

const media = new LocalDiskMediaStore(process.env.MEDIA_ROOT ?? "./data/media");
export async function GET(_: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const tenant = await requireTenant();
    const key = decodeURIComponent((await params).key);
    const record = await db.media.findFirst({ where: { orgId: tenant.orgId, storageKey: key } });
    if (!record) return new NextResponse("Not found", { status: 404 });
    const file = await media.get(key);
    return new NextResponse(file.bytes.buffer as ArrayBuffer, { headers: { "content-type": file.contentType, "cache-control": "private, max-age=3600" } });
  } catch { return new NextResponse("Not found", { status: 404 }); }
}
