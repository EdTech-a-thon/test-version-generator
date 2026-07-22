export type VariableDefinition = {
  name: string;
  type: "integer" | "decimal";
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  values?: number[];
};

export type DatasetRow = {
  id: string;
  values: Record<string, string | number>;
};

export type DatasetVariableDefinition = {
  name: string;
  type: "dataset";
  rows: DatasetRow[];
};

export type ParametricVariable = VariableDefinition | DatasetVariableDefinition;

export type SampledDistractor = {
  mode: "sampled";
  dataset: string;
  column: string;
  count?: number;
  sameAs?: string;
  excludeRowIds?: string[];
};

export type RoundingRule = { mode: "decimals" | "sigfigs"; value: number };

export type ParametricDefinition = {
  variables: ParametricVariable[];
  constraints: string[];
  answerFormula: string;
  distractors: Array<string | SampledDistractor>;
  unit?: string;
  rounding: RoundingRule;
};

export type GeneratedVariant = {
  variables: Record<string, number | string | Record<string, string | number>>;
  correct: number | string;
  distractors: Array<number | string>;
  options: Array<number | string>;
  valid: boolean;
  error?: string;
};

export type RenderedFormItem = {
  stem: string;
  options: Array<{ id: string; text: string; pinLast?: boolean }>;
  correctAnswer: string[];
  solution?: string;
  rubric?: string;
  type: string;
  generatedVariant?: GeneratedVariant;
};

export interface MediaStore {
  put(orgId: string, bytes: Uint8Array, contentType: string, fileName: string): Promise<string>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string }>;
  remove(key: string): Promise<void>;
  url(key: string): string;
}

export type ExtractionInput = {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
};

export type ExtractedCandidate = {
  stem: string;
  type: string;
  options: string[];
  correctAnswer?: string;
  difficulty?: number;
  tags: string[];
  confidence: Record<string, number>;
  parameterSuggestion?: Partial<ParametricDefinition>;
};

export interface ExtractionProvider {
  readonly name: string;
  estimate(input: ExtractionInput): Promise<{ costCents: number; units: number }>;
  extract(input: ExtractionInput): Promise<ExtractedCandidate[]>;
}

export type ExportableForm = {
  id: string;
  formCode: string;
  items: Array<{ position: number; correctLetters: string[]; points: number }>;
};

export interface KeyExportAdapter {
  readonly name: string;
  readonly confirmed: boolean;
  format(form: ExportableForm): string;
}
