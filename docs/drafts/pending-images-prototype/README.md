# Pending Image prototype

Throwaway scripts from designing ADR-0027. They are evidence and a starting point, not production code. Run them with `bun` from the repository root.

| Script | What it does |
| --- | --- |
| `label.mjs <source.pdf> <out>` | Rips every embedded image with pdfjs-dist, numbers the picture-sized ones in reading order, and writes `<out>.pdf` (the labeled copy, an `IMG n` tag inside each picture's top-left corner) and `<out>-tags.json` (tag → page, image id, box). |
| `score-tags.mjs <package.json> <tags.json> <truth.json>` | Resolves each `{"pending": {"image": n}}` through the tag list and scores every slot against a hand-made truth file, including picture order, missed slots, and tag text leaking into content. |
| `match.mjs <source.pdf> <package.json> <truth.json>` | The rejected text-layer matcher: anchors each Question on its stem text and answer labels, then assigns nearby ripped images. Kept as a possible fallback. |

`truth.json` and `truth-packet.json` record, for the two sample tests used in ADR-0027, which ripped image (`p<page>#<n>`, in paint order) belongs in each Question's stem or answer choice. A `"passage": true` slot is a passage stored as an image, which an assistant may transcribe or keep as a picture.

The sample PDFs and the Gemini outputs are a teacher's material and are not committed.
