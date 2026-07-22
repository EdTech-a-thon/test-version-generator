import type { MediaStore } from "../contracts";

export type S3MediaStoreConfig = {
  bucket: string;
  region: string;
  publicBaseUrl?: string;
};

/** Explicit placeholder until S3 credentials and an SDK are configured. */
export class S3MediaStore implements MediaStore {
  readonly config: S3MediaStoreConfig;

  constructor(config: S3MediaStoreConfig) {
    this.config = config;
  }

  put(): Promise<string> {
    throw new Error("S3MediaStore is not configured");
  }

  get(): Promise<{ bytes: Uint8Array; contentType: string }> {
    throw new Error("S3MediaStore is not configured");
  }

  remove(): Promise<void> {
    throw new Error("S3MediaStore is not configured");
  }

  url(): string {
    throw new Error("S3MediaStore is not configured");
  }
}
