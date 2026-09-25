/** What the list needs of an Image Tag. Structural, so the `/extract` page
 *  plugin can fill the slot without loading the Source Document module. */
type ListedTag = { tag: number; page: number }

/** Where the instructions list a Source Document's Image Tags. */
export const IMAGE_TAGS_SLOT = '{{IMAGE_TAGS}}'

/** What the slot says when no Source Document was uploaded first — a photo,
 *  a Word document, pasted text, or an assistant fetching `/extract`. */
export const NO_LABELED_COPY =
  'There is no labeled copy of this source: Test Parrot has printed no image tags on it. Write every picture as a Pending Image that names only its page, `"pending": { "page": <n> }`, where `n` is the 1-based page (use 1 for a single photo or a pasted source). The teacher will add each picture in Test Parrot.'

const NO_TAGS =
  'This is a labeled copy, but Test Parrot found no pictures in it to tag. Write any picture you do see, such as a diagram drawn with lines or a picture on a scanned page, as a Pending Image that names its page, `"pending": { "page": <n> }`.'

/**
 * The instructions an assistant is given, with their image tag list filled
 * in: the document's tags by page when a Source Document was uploaded first,
 * or a sentence saying there is no labeled copy. Every copy of the
 * instructions — either copy button and the public page — fills the slot
 * here, so an assistant never meets the slot itself.
 */
export function fillImageTags(instructions: string, tags: readonly ListedTag[] | null): string {
  return instructions.replace(IMAGE_TAGS_SLOT, () => imageTagList(tags))
}

function imageTagList(tags: readonly ListedTag[] | null): string {
  if (tags === null) return NO_LABELED_COPY
  if (tags.length === 0) return NO_TAGS
  const pages = new Map<number, number[]>()
  for (const { page, tag } of tags) pages.set(page, [...(pages.get(page) ?? []), tag])
  const lines = [...pages].map(
    ([page, numbers]) => `- page ${page}: ${numbers.map((number) => `IMG ${number}`).join(', ')}`,
  )
  return [
    `This is a labeled copy. Test Parrot printed ${tags.length === 1 ? 'one tag' : `${tags.length} tags`} on it:`,
    '',
    ...lines,
  ].join('\n')
}
