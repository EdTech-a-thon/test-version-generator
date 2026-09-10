// The browser database is shared by normalized authoring records and immutable
// Media Assets. Keep its schema names in one small module so the two adapters
// can evolve together without depending on one another's implementation.
// Independent Exams begin a fresh browser-storage generation; the preceding
// single-workspace generation is deliberately not interpreted as an Exam.
export const VERSIONED_STORAGE_NAME = 'test-parrot-exams-v1'
export const MEDIA_ASSET_STORE = 'media-assets'
export const VERSION_STORE = 'versions'
export const QUESTION_REVISION_STORE = 'question-revisions'
export const LAYOUT_PLAN_STORE = 'layout-plans'
export const VERSIONED_STORAGE_VERSION = 6
export const EXAM_STORE = 'exams'
export const EXAM_WORKSPACE_STORE = 'exam-workspace'
export const QUESTION_BANK_REGISTRY_STORE = 'question-banks'
export const CANONICAL_QUESTION_STORE = 'canonical-questions'
export const QUESTION_BANK_WORKSPACE_STORE = 'question-bank-workspace'
export const EDITOR_WORKSPACE_STORE = 'editor-workspace'
