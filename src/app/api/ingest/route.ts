import { NextResponse } from "next/server";
import { extractionCacheKey, ManualExtractionProvider, parseSpreadsheet } from "@/lib/extraction";
import { db } from "@/lib/db";
import { mediaStore } from "@/lib/media/store";
import { requireTenantRole } from "@/lib/tenant";

export async function POST(request: Request) {
  try {
    const tenant = await requireTenantRole(["OWNER", "ADMIN", "EDITOR"]);
    const data = await request.formData(); const file = data.get("file");
    if (!(file instanceof File)) throw new Error("Choose a file first.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const input = { bytes, fileName: file.name, mimeType: file.type || "application/octet-stream" };
    const hash = extractionCacheKey(input, "manual");
    const existing = await db.ingestJob.findFirst({ where: { orgId: tenant.orgId, sourcePreview: { equals: { hash } } }, select: { id: true } });
    if (existing) return NextResponse.json({ id: existing.id, cached: true, reviewRequired: true });
    const storageKey = await mediaStore.put(tenant.orgId, bytes, input.mimeType, input.fileName);
    const media = await db.media.create({ data: { orgId: tenant.orgId, storageKey, fileName: input.fileName, contentType: input.mimeType, sizeBytes: bytes.byteLength } });
    const job = await db.ingestJob.create({ data: { orgId: tenant.orgId, mediaId: media.id, createdById: tenant.userId, provider: "manual", status: "COMPLETE", sourcePreview: { hash, fileName: input.fileName } } });
    if (file.name.match(/\.(csv|xlsx)$/i)) {
      const rows = parseSpreadsheet(bytes);
      const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
      const matchingColumn = (terms: string[]) => columns.find((header) => terms.some((term) => header.toLowerCase().includes(term)));
      const stemColumn = matchingColumn(["stem", "question", "prompt"]) ?? columns[0];
      const answerColumn = matchingColumn(["correct", "answer", "key"]);
      const optionColumns = ["a", "b", "c", "d", "e"].map((letter) => matchingColumn([`option ${letter}`, `choice ${letter}`, `answer ${letter}`, `${letter})`, `${letter}.`])).filter((column): column is string => Boolean(column));
      const candidates = rows.map((row, index) => {
        const stem = String(row[stemColumn] ?? "").trim();
        const correct = String(answerColumn ? row[answerColumn] ?? "" : "").trim();
        const options = optionColumns.map((column, optionIndex) => ({ id: String.fromCharCode(65 + optionIndex), text: String(row[column] ?? "").trim() })).filter((option) => option.text);
        const matchingOption = options.find((option) => option.id.toLowerCase() === correct.toLowerCase() || option.text.toLowerCase() === correct.toLowerCase());
        return stem ? { orgId: tenant.orgId, ingestJobId: job.id, type: "MULTIPLE_CHOICE", stem, content: { options }, proposedData: { options, correctAnswer: matchingOption ? [matchingOption.id] : [], tags: [], difficulty: 3 }, confidence: { stem: stemColumn ? 0.9 : 0.45, options: options.length >= 2 ? 0.8 : 0.2, correctAnswer: answerColumn ? 0.8 : 0.2 }, sourcePreview: { row: index + 2, values: row }, sourcePage: null } : null;
      }).filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
      if (candidates.length) await db.ingestCandidate.createMany({ data: candidates });
    } else {
      const provider = new ManualExtractionProvider();
      const extracted = await provider.extract();
      if (extracted.length) await db.ingestCandidate.createMany({ data: extracted.map((candidate) => ({ orgId: tenant.orgId, ingestJobId: job.id, type: candidate.type, stem: candidate.stem, content: { options: candidate.options }, proposedData: candidate, confidence: candidate.confidence })) });
    }
    return NextResponse.json({ id: job.id, hash, reviewRequired: true }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create review job." }, { status: 400 }); }
}
