import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { LocalDiskMediaStore } from "@/lib/media";
import { requireTenant } from "@/lib/tenant";

const media = new LocalDiskMediaStore(process.env.MEDIA_ROOT ?? "./data/media");

export async function POST(request: Request) {
  try {
    const tenant = await requireTenant();
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) throw new Error("Choose a file to upload.");
    if (file.size > 5 * 1024 * 1024) throw new Error("Images must be under 5 MB.");
    const contentType = file.type;
    if (!contentType.startsWith("image/")) throw new Error("Only image files can be uploaded.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const storageKey = await media.put(tenant.orgId, bytes, contentType, file.name);
    const record = await db.media.create({ data: { orgId: tenant.orgId, storageKey, fileName: file.name, contentType, sizeBytes: bytes.length } });
    return NextResponse.json({ key: record.storageKey, url: media.url(storageKey) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not upload image." }, { status: 400 });
  }
}