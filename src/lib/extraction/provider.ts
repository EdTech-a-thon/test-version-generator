import type {
  ExtractedCandidate,
  ExtractionInput,
  ExtractionProvider,
} from "../contracts";

export class ExtractionProviderError extends Error {
  readonly provider: string;
  readonly cause?: unknown;

  constructor(provider: string, message: string, cause?: unknown) {
    super(`${provider}: ${message}`);
    this.name = "ExtractionProviderError";
    this.provider = provider;
    this.cause = cause;
  }
}

export class ManualExtractionProvider implements ExtractionProvider {
  readonly name = "Manual entry";

  async estimate(): Promise<{ costCents: number; units: number }> {
    return { costCents: 0, units: 0 };
  }

  async extract(): Promise<ExtractedCandidate[]> {
    // An empty result deliberately routes the document to human entry/review.
    return [];
  }
}

export async function extractWithProvider(
  provider: ExtractionProvider,
  input: ExtractionInput,
): Promise<ExtractedCandidate[]> {
  try {
    return await provider.extract(input);
  } catch (error) {
    if (error instanceof ExtractionProviderError) throw error;
    const message = error instanceof Error ? error.message : "Unknown extraction error";
    throw new ExtractionProviderError(provider.name, message, error);
  }
}
