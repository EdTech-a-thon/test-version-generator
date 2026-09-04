// The browser database is shared by normalized authoring records and immutable
// Media Assets. Keep its schema names in one small module so the two adapters
// can evolve together without depending on one another's implementation.
export const VERSIONED_STORAGE_NAME = 'test-parrot-version-history-v1'
export const MEDIA_ASSET_STORE = 'media-assets'
export const VERSIONED_STORAGE_VERSION = 2
