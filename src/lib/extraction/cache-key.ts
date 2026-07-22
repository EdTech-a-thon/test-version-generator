import { createHash } from "node:crypto";

import type { ExtractionInput } from "../contracts";

export function extractionCacheKey(input: ExtractionInput, providerName: string): string {
  const hash = createHash("sha256");
  hash.update(providerName);
  hash.update("\0");
  hash.update(input.mimeType);
  hash.update("\0");
  hash.update(input.fileName);
  hash.update("\0");
  hash.update(input.bytes);
  return hash.digest("hex");
}

export const sha256CacheKey = extractionCacheKey;
