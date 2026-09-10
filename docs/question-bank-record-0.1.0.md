# Question Bank Record 0.1.0

The public schema is [`/question-bank-record-0.1.0.schema.json`](../public/question-bank-record-0.1.0.schema.json), with stable identifier `https://testparrot.com/formats/question-bank/0.1.0/schema.json`.

A record identifies itself with `format: "test-parrot/question-bank"` and exact `formatVersion: "0.1.0"`. It describes one complete Question Bank in canonical authored Question order. Package-local `qN` and `qN-cN` identifiers express relationships inside the record only; importers must not treat them as durable identities.

`bank.questions` contains Multiple Choice and Short Answer Questions. Both carry a semantic `stem`, optional `difficulty`, and ordered `topics`. Multiple Choice has at least two authored `choices`, with zero or one marked `correct`. Short Answer may have a semantic `suggestedAnswer`.

Documents use format-owned nodes: paragraph, heading, blockquote, bullet/ordered list, list item, code block, rule, table/row/cell, inline/display math, authored hard break, and text. Text marks are strong, emphasis, inline code, strike, subscript, superscript, and link. Links are absolute HTTP or HTTPS URLs. Version 0.1.0 is media-free, so `media` is empty and image nodes are not accepted.

Local storage IDs, editor node names, Exam references and arrangements, answer-column layout, Working Copies, Export Records, Layout Plans, and timestamps are not part of the format.

`integrity.algorithm` is `sha-256`. Its lowercase hexadecimal digest is calculated over RFC 8785 canonical JSON for the complete record with the `digest` member omitted. This detects corruption; it does not authenticate an author or PDF pages.

A Question Bank File is an ordinary PDF with exactly one canonical attachment named `pdfcx.json`. The attachment is UTF-8 JSON, MIME type `application/json`, description `pdf-canonical-extraction`, and associated-file relationship `Source`. The visible teacher preview is generated from the exact record bytes attached to the PDF.
