import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { MediaStore } from "../contracts";

type MediaMetadata = { contentType: string };

const SAFE_ORG_ID = /^[A-Za-z0-9_-]+$/;
const SAFE_KEY = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

function assertSafeOrgId(orgId: string): void {
  if (!SAFE_ORG_ID.test(orgId)) {
    throw new Error("Organization ID may only contain letters, numbers, underscores, and hyphens");
  }
}

function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key)) {
    throw new Error("Invalid media key");
  }
}

function safeFileName(fileName: string): string {
  const name = path.basename(fileName).replace(/[^A-Za-z0-9._-]+/g, "-");
  const trimmed = name.replace(/^\.+/, "").slice(0, 120);
  return trimmed || "file";
}

export class LocalDiskMediaStore implements MediaStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  async put(
    orgId: string,
    bytes: Uint8Array,
    contentType: string,
    fileName: string,
  ): Promise<string> {
    assertSafeOrgId(orgId);
    const key = `${orgId}/${randomUUID()}-${safeFileName(fileName)}`;
    const filePath = this.pathFor(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, bytes);
    await writeFile(`${filePath}.meta.json`, JSON.stringify({ contentType } satisfies MediaMetadata));
    return key;
  }

  async get(key: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const filePath = this.pathFor(key);
    const [bytes, metadata] = await Promise.all([
      readFile(filePath),
      readFile(`${filePath}.meta.json`, "utf8"),
    ]);
    const parsed = JSON.parse(metadata) as MediaMetadata;
    if (typeof parsed.contentType !== "string") {
      throw new Error("Invalid media metadata");
    }
    return { bytes, contentType: parsed.contentType };
  }

  async remove(key: string): Promise<void> {
    const filePath = this.pathFor(key);
    await Promise.all([
      rm(filePath, { force: true }),
      rm(`${filePath}.meta.json`, { force: true }),
    ]);
  }

  url(key: string): string {
    assertSafeKey(key);
    return `/api/media/${encodeURIComponent(key)}`;
  }

  private pathFor(key: string): string {
    assertSafeKey(key);
    const filePath = path.resolve(this.root, key);
    if (!filePath.startsWith(`${this.root}${path.sep}`)) {
      throw new Error("Media key escapes storage directory");
    }
    return filePath;
  }
}
