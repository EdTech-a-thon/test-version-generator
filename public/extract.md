# Convert questions into a Test Parrot Package

Use these instructions to convert questions from a PDF, image, scan, screenshot, document, or plain text into a JSON file that a user can import into Test Parrot.

## Required result

Always create one complete UTF-8 JSON file using the **Test Parrot Package `0.1.0`** format. Name the downloaded file:

```text
<short-name>.parrot.json
```

A package always holds exactly one Question Bank Record `0.3.0` with every converted Question. What else goes in it depends on the source, so triage it first:

- **The source is a test** — an exam, quiz, worksheet or any paper a student sits, with its questions in a printed order: also add one Exam Record `0.1.0` that lays the Questions out as the test does (see [Tests](#tests)).
- **The source is only questions** — a question pool, a study list, a bank exported from elsewhere, anything not laid out as one paper: add no Exam. `exams` is an empty array.

When it is unclear whether the source is a test, ask the user; if you cannot ask, add no Exam and say so in the report. Never invent an Exam the source does not show. Everything below about Questions applies either way: the package's bank is an ordinary Question Bank Record.

When finished:

1. Give the user the JSON as a downloadable file. Do not provide only a JSON code block when you can create a file attachment.
2. Tell the user: **Download the JSON file, open [testparrot.com](https://testparrot.com), and drag the file into Test Parrot to import it.**
3. Report any ambiguity, unreadable source content, or unsupported material. If there are no such limitations, explicitly say that the complete source was converted.

Do not generate a PDF. Do not return a summary in place of the JSON file.

## Public format resources

Use these resources as the source of truth:

- [JSON Schema](./formats/question-bank/0.3.0/schema.json)
- [Minimal Multiple Choice example](./formats/question-bank/0.3.0/examples/minimal-multiple-choice.json)
- [True/False example](./formats/question-bank/0.3.0/examples/true-false.json)
- [Matching example](./formats/question-bank/0.3.0/examples/matching.json)
- [Short Answer example](./formats/question-bank/0.3.0/examples/short-answer.json)
- [Complete rich-text example](./formats/question-bank/0.3.0/examples/complete-rich-text.json)
- [Provenance and links example](./formats/question-bank/0.3.0/examples/provenance-and-links.json)
- [Media-rich example](./formats/question-bank/0.3.0/examples/media-rich.json)
- [Test Parrot Package JSON Schema](./formats/package/0.1.0/schema.json) and [Exam Record JSON Schema](./formats/exam/0.1.0/schema.json)
- [Package example: a test, with its bank and Exam](./formats/package/0.1.0/examples/bank-and-exam.json)
- [Package example: questions only, with a bank and no Exam](./formats/package/0.1.0/examples/bank-only.json)

The Question Bank Record inside the package has this top-level shape:

```json
{
  "format": "test-parrot/question-bank",
  "formatVersion": "0.3.0",
  "generator": {
    "name": "Name of the assistant or conversion tool",
    "version": "Version or model name"
  },
  "requiredFeatures": [],
  "bank": {
    "name": "Question Bank name",
    "questions": []
  },
  "media": []
}
```

Do not add application database IDs, local paths, timestamps, page numbers, layout coordinates, OCR confidence, or conversational notes to the record. A test's layout belongs in its Exam Record, and only in the members that format defines.

## The package

The file itself is the package, with the Question Bank Record under `questionBanks`. For questions only, `exams` is `[]`. For a test, it holds one Exam:

```json
{
  "format": "test-parrot/package",
  "formatVersion": "0.1.0",
  "generator": {
    "name": "Name of the assistant or conversion tool",
    "version": "Version or model name"
  },
  "requiredFeatures": [],
  "questionBanks": [
    { "id": "bank", "record": { "format": "test-parrot/question-bank", "formatVersion": "0.3.0", "...": "the complete Question Bank Record" } }
  ],
  "exams": [
    {
      "format": "test-parrot/exam",
      "formatVersion": "0.1.0",
      "name": "The test's title",
      "positions": [
        { "question": { "bank": "bank", "question": "q1" }, "columns": 2 },
        { "question": { "bank": "bank", "question": "q2" } }
      ]
    }
  ]
}
```

## Tests

When triage says the source is a test:

- Name the bank after the subject or unit, and name the Exam after the test's own title as printed.
- Give the Exam one position for every converted Question, in printed order, each naming `"bank": "bank"` and that Question's ID. Use each Question exactly once. An unconverted question gets no position.
- Write every Question's choices and Word Bank answers into the bank in the order the test prints them. That records the test's answer order, so leave out `answerOrder`: answers print in the order the bank records them, and the answer key's letters stay right.
- Record `columns` (`1`, `2` or `4`) on a Multiple Choice position only when the source layout makes it clear how many columns its answers are printed in — for example, four answers side by side on one line is `4`. When it is not clear, leave `columns` out. Never put `columns` on any other Question Type.
- Never add `workSpace`. Room left for writing is not something to guess from a scan; the teacher sets it in Test Parrot.
- Do not add point values, section headings, instructions, or any other member: the Exam Record has none of these.

Test Parrot always prints Sections in the order Multiple Choice, True/False, Matching, Short Answer. Keep the source's printed order anyway; Test Parrot regroups the Sections itself and keeps the order within each.

## Completeness is mandatory—but do not force uncertain content

Unless the user explicitly asks for a subset, attempt to convert **every question and every supported part of the source**. A sample, first-page conversion, or silently partial conversion is not acceptable.

> **If you cannot reliably determine the type of question, do not force it into a specific form. Just leave it and explicitly warn that you could not convert.**

Completeness means accounting for every source question, not pretending every question was converted successfully. Never classify an ambiguous question as Multiple Choice, True/False, Matching or Short Answer merely to make the output appear complete. Leave that question out of the JSON, identify it by source page and visible number or opening words, explain why its type could not be determined, and include it in the final conversion report as unconverted. Ask the user for clarification when possible; after clarification, add the question in its correct form.

### Before conversion

1. Inspect every supplied page, image, table, answer-key section, footnote, continuation, and annotation.
2. For a long source, process it in batches and maintain a page-coverage and question-count checklist. Do not silently stop because of a context or output limit.
3. Inventory all questions in authored order. Reconcile the inventory with visible numbering. A matching section counts one source number per item, but is converted as one Question per word bank (see [Matching](#matching)).
4. Record unexplained duplicate or missing numbers as source ambiguities; do not silently renumber them away.
5. Identify any content that is unreadable or cannot be represented by this format before claiming completion.

### During conversion

1. Classify a question as `multiple-choice`, `true-false`, `matching` or `short-answer` only when the source supports that classification. Version `0.3.0` supports only those four types. If its type is uncertain or it cannot be represented without material loss, leave it out and report it explicitly; never coerce it into the closest supported type.
2. Preserve the exact wording, punctuation, capitalization, symbols, units, and meaningful whitespace.
3. Preserve authored question and choice order.
4. Preserve paragraphs, headings, blockquotes, lists, code, rules, tables, equations, hard breaks, links, images, captions, and text formatting when present.
5. Do not rewrite, summarize, correct, simplify, or “improve” source content unless the user explicitly requests editing.
6. Never invent missing text, choices, answers, correctness, Difficulty, Topics, attribution, or license information.
7. Ask the user about materially ambiguous OCR, unreadable symbols, unclear question boundaries, missing choices, uncertain Question Types, and uncertain answer keys instead of guessing.
8. If an essential element cannot be represented, leave that Question unconverted and identify its exact location and limitation rather than silently dropping or coercing it.

### Before delivery

Perform a second pass against the original source and verify all of the following:

- every source page or image was inspected;
- every source question is accounted for as either converted exactly once or explicitly listed as unconverted;
- converted Questions remain in authored order, even when an unconverted question creates a gap in source numbering;
- every converted stem and choice is complete;
- every supplied answer and correctness indicator was copied accurately;
- every matching item names the word bank answer the source's key gives it, or none when the key gives none;
- correctness was never inferred from general knowledge;
- all supplied Difficulty and Topics values were preserved;
- meaningful formatting, especially subscript and superscript, was preserved semantically;
- every image, caption, table, list, equation, hard break, and safe link was preserved;
- all Question, choice, item and word bank IDs are unique and sequential;
- every image reference resolves to exactly one Media Asset;
- every Media Asset is referenced;
- for a test, the Exam has one position per converted Question, in printed order, each naming an existing Question ID in the package's bank, and no Question twice;
- for a test, every `columns` value reflects a layout the source makes clear, sits only on a Multiple Choice position, and no position has `workSpace`;
- the file is a Test Parrot Package with exactly one Question Bank Record, and it holds an Exam only if the source is a test;
- the final JSON passes the public schema and semantic rules.

If any check fails, fix the record or disclose the precise limitation. Never say the extraction is complete when it is not.

## Question types

Version `0.3.0` supports `multiple-choice`, `true-false`, `matching`, and `short-answer` Questions. Do not use any of them as a fallback for an unknown, mixed, or unsupported Question Type. In particular, do not turn an uncertain question into Short Answer merely because it has no clearly detected choices, do not turn a two-choice question into True/False unless those two choices really are true and false, and do not turn a matching section into Multiple Choice questions that each repeat the word bank. Leave it unconverted and warn the user instead.

### Multiple Choice

A Multiple Choice Question:

- has an ID such as `q1`;
- has at least two choices;
- keeps choices in authored order;
- uses choice IDs such as `q1-c1`, `q1-c2`, and so on;
- has zero or one choice whose `correct` value is `true`;
- does not have `suggestedAnswer`.

Zero correct choices is valid and means the source did not identify a correct answer. Do not guess one.

```json
{
  "id": "q1",
  "type": "multiple-choice",
  "stem": {
    "type": "document",
    "content": [
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "Which number is prime?" }]
      }
    ]
  },
  "difficulty": "easy",
  "topics": ["Numbers"],
  "choices": [
    {
      "id": "q1-c1",
      "content": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [{ "type": "text", "text": "Four" }]
          }
        ]
      },
      "correct": false
    },
    {
      "id": "q1-c2",
      "content": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [{ "type": "text", "text": "Five" }]
          }
        ]
      },
      "correct": true
    }
  ]
}
```

### True/False

A True/False Question is a statement the student judges true or false. Convert a source question to `true-false` when it is presented under a True/False heading or instruction, or when its only two answers are true and false — including `T`/`F`, `True`/`False`, and the same pair in the source's own language.

A True/False Question:

- has an ID such as `q2`;
- has exactly two choices, the affirmative first and the negative second, whatever order the source printed them in;
- writes those choices out as ordinary content — `True` then `False` — rather than copying the source's `T`/`F` shorthand;
- uses choice IDs such as `q2-c1` and `q2-c2`;
- has zero or one choice whose `correct` value is `true`;
- does not have `suggestedAnswer`.

Mark `correct` on the choice the source's answer key gives: a key of `T` or `True` marks the first choice, and `F` or `False` marks the second. Zero correct choices is valid and means the source did not identify an answer. Do not guess one.

```json
{
  "id": "q2",
  "type": "true-false",
  "stem": {
    "type": "document",
    "content": [
      {
        "type": "paragraph",
        "content": [
          {
            "type": "text",
            "text": "Water boils at 100 degrees Celsius at sea level."
          }
        ]
      }
    ]
  },
  "topics": ["States of matter"],
  "choices": [
    {
      "id": "q2-c1",
      "content": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [{ "type": "text", "text": "True" }]
          }
        ]
      },
      "correct": true
    },
    {
      "id": "q2-c2",
      "content": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [{ "type": "text", "text": "False" }]
          }
        ]
      },
      "correct": false
    }
  ]
}
```

Keep the statement itself in the stem. A leading `T  F` pair, a blank line, or a numbered answer column printed beside the statement is answer-sheet furniture, not part of the question: leave it out.

### Matching

A matching section is a list of numbered items on one side and a lettered word bank on the other, which the student matches by writing a letter in the blank beside each item. It typically looks like this in the source:

```text
Matching: Match each event to the correct time period.

____ 22. The Jewish synagogue system was set up.        A. Persian
____ 23. The Septuagint was completed.                  B. Grecian
____ 24. Herod the Great was able to rise to power.     C. Maccabean—Hasmonean
                                                        D. Roman
```

Convert **one whole set — every item that shares one word bank — as one `matching` Question**, even though each item carries its own number in the source. Do not split a set into one Question per item, and do not merge two sets that have different word banks. Test Parrot numbers the items again when it prints the test, one number per item, and prints the word bank beside them.

A Matching Question:

- has an ID such as `q3`;
- keeps the set's own directions (for example “Match each event to the correct time period.”) in the `stem`; the stem may be a blank paragraph when the source has none beyond the section heading;
- has `prompts`: the items, at least one, in authored order, with IDs such as `q3-p1`, `q3-p2`, and so on;
- has `wordBank`: the lettered answers, at least two, in authored order, with IDs such as `q3-a1`, `q3-a2`, and so on;
- gives each item an `answer` — the ID of the word bank answer the source's answer key matches it with — or no `answer` member at all when the key gives none;
- does not have `choices` or `suggestedAnswer`.

The letters are positions, not content: `A.` is `q3-a1`, `B.` is `q3-a2`, and so on, so leave the letters out of the answer content and out of the item content. Leave the source numbers and the blanks out too — they are furniture. A key of `22. C` means the item numbered 22 names the third word bank answer. Several items may name the same answer when the key says so, and a word bank may hold answers no item names; keep those distractors in authored order. Never infer a match from general knowledge, and never reorder either list.

```json
{
  "id": "q3",
  "type": "matching",
  "stem": {
    "type": "document",
    "content": [
      {
        "type": "paragraph",
        "content": [
          {
            "type": "text",
            "text": "Match each event to the correct time period."
          }
        ]
      }
    ]
  },
  "prompts": [
    {
      "id": "q3-p1",
      "content": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [
              {
                "type": "text",
                "text": "The Jewish synagogue system was set up."
              }
            ]
          }
        ]
      },
      "answer": "q3-a1"
    },
    {
      "id": "q3-p2",
      "content": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [
              { "type": "text", "text": "The Septuagint was completed." }
            ]
          }
        ]
      },
      "answer": "q3-a2"
    },
    {
      "id": "q3-p3",
      "content": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [
              {
                "type": "text",
                "text": "Herod the Great was able to rise to power."
              }
            ]
          }
        ]
      },
      "answer": "q3-a4"
    }
  ],
  "wordBank": [
    {
      "id": "q3-a1",
      "content": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [{ "type": "text", "text": "Persian" }]
          }
        ]
      }
    },
    {
      "id": "q3-a2",
      "content": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [{ "type": "text", "text": "Grecian" }]
          }
        ]
      }
    },
    {
      "id": "q3-a3",
      "content": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [{ "type": "text", "text": "Maccabean—Hasmonean" }]
          }
        ]
      }
    },
    {
      "id": "q3-a4",
      "content": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [{ "type": "text", "text": "Roman" }]
          }
        ]
      }
    }
  ]
}
```

If the source prints the word bank above or below the items rather than beside them, or letters the items and numbers the bank, it is still a matching set: the items are the side the student writes on. If you cannot tell which side is which, or which answers belong to which set, leave the section unconverted and say so.

### Short Answer

A Short Answer Question:

- has an ID such as `q4`;
- has no `choices` member;
- may have a rich-text `suggestedAnswer` only when the source or user supplies one.

```json
{
  "id": "q4",
  "type": "short-answer",
  "stem": {
    "type": "document",
    "content": [
      {
        "type": "paragraph",
        "content": [
          {
            "type": "text",
            "text": "Name the process plants use to make food."
          }
        ]
      }
    ]
  },
  "topics": ["Biology"],
  "suggestedAnswer": {
    "type": "document",
    "content": [
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "Photosynthesis." }]
      }
    ]
  }
}
```

A visibly blank stem is valid if the source actually contains a blank stem.

## Rich text

Each stem, choice, matching item, word bank answer, and Suggested Answer is a semantic document:

```json
{
  "type": "document",
  "content": []
}
```

Supported nodes are:

- `paragraph`
- `heading` with `level` from 1 through 6
- `blockquote`
- `bullet-list`
- `ordered-list` with optional positive `start`
- `list-item`
- `code-block` with optional `language` and text in `text`
- `rule`
- `table`
- `table-row` with optional `header`
- `table-cell` with optional `header`
- `text`
- `inline-math` and `display-math` with authored math in `source`
- `hard-break`
- `inline-image` and `block-image`

Supported marks on `text` nodes are:

- `strong`
- `emphasis`
- `inline-code`
- `strike`
- `subscript`
- `superscript`
- `link` with an absolute HTTP or HTTPS `href` and optional `title`

Split text into separate nodes whenever its marks change. Marks apply only to the text node that carries them.

### Subscript and superscript are required formatting

Do not flatten subscript or superscript to baseline text. OCR commonly loses this formatting, so inspect the source visually instead of trusting extracted plain text alone.

For example, visually formatted “H₂O has 10³ molecules” should be represented as:

```json
{
  "type": "paragraph",
  "content": [
    { "type": "text", "text": "H" },
    {
      "type": "text",
      "text": "2",
      "marks": [{ "type": "subscript" }]
    },
    { "type": "text", "text": "O has 10" },
    {
      "type": "text",
      "text": "3",
      "marks": [{ "type": "superscript" }]
    },
    { "type": "text", "text": " molecules" }
  ]
}
```

Use the semantic marks when ordinary characters are visually formatted as subscript or superscript. If the source literally contains Unicode characters such as `₂` or `³`, preserving those authored characters is allowed, but do not use Unicode substitution merely to avoid recording known formatting.

Marks may be combined. Bold superscript text, for example, can use:

```json
{
  "type": "text",
  "text": "2",
  "marks": [{ "type": "strong" }, { "type": "superscript" }]
}
```

Use `inline-math` or `display-math` with the authored math source for mathematical expressions. Do not misuse a superscript mark as a replacement for structured math. For example:

```json
{ "type": "inline-math", "source": "x^2 + y^2" }
```

The same formatting rules apply inside stems, choices, matching items, word bank answers, and Suggested Answers.

## Links

Only absolute HTTP and HTTPS links are allowed. Preserve both the visible label and destination:

```json
{
  "type": "text",
  "text": "reference",
  "marks": [
    {
      "type": "link",
      "href": "https://example.org/reference",
      "title": "Optional title"
    }
  ]
}
```

Reject or report `javascript:`, `data:`, `file:`, relative, and custom-scheme links. Do not silently make an unsafe link importable by changing its destination.

## Images and Media Assets

If an image is meaningful Question Content—for example, a diagram the Question asks about—preserve it. Do not replace it with an invented description.

An image node references bytes using a content-addressed ID:

```json
{
  "type": "block-image",
  "asset": "sha256:<sha256 of decoded original image bytes>",
  "alt": "Useful alternative text",
  "caption": "Caption from the source",
  "authoredSize": 0.75
}
```

Each distinct referenced image must appear exactly once in the top-level `media` array:

```json
{
  "id": "sha256:<same digest>",
  "mimeType": "image/png",
  "width": 1200,
  "height": 800,
  "bytes": "<strict base64 of the original image bytes>"
}
```

Rules:

- Supported formats are PNG, JPEG, and WebP.
- `width` and `height` are positive intrinsic pixel dimensions, each no more than 20,000.
- `bytes` is strict base64 of the original supported image bytes.
- The ID digest is SHA-256 of the decoded image bytes, not of the base64 text.
- Every image reference must resolve, and every declared asset must be referenced.
- Preserve optional `alt`, `caption`, and `authoredSize` from `0.05` through `1`.
- Normalize another raster format to PNG only when necessary and disclose that conversion.
- Do not include SVG.

If the assistant cannot access or encode an essential image, it must identify the affected question and tell the user the conversion is incomplete. It must not omit the image silently.

## Question Metadata and provenance

A Question may have:

- `difficulty`: `easy`, `medium`, or `hard`;
- `topics`: an ordered array of strings.

A bank may have:

- `description`;
- `author`;
- `license`, containing a required display `name` and optional absolute HTTP or HTTPS `url`.

Include only information explicitly present in the source or supplied by the user. Declared author and license information are not proof of identity or ownership.

## Final validation and delivery

Validate the package against the [package schema](./formats/package/0.1.0/schema.json), its Question Bank Record against the [Question Bank Record schema](./formats/question-bank/0.3.0/schema.json), and any Exam against the [Exam Record schema](./formats/exam/0.1.0/schema.json). Schema validation alone is not sufficient: also verify Question cardinality, unique IDs, that every matching `answer` names an ID in the same Question's `wordBank`, safe links, resolved media references, and decoded image properties.

Relevant import limits include:

- 75 MiB JSON record;
- 10,000 Questions;
- 2,000 Media Assets;
- 25 MiB per decoded Media Asset;
- 75 MiB total decoded media;
- 25,000 semantic nodes per Question;
- rich-text depth of 50;
- maximum image dimensions of 20,000 by 20,000 pixels.

Deliver exactly one complete `.parrot.json` file. Then tell the user:

> Download the JSON file, open [testparrot.com](https://testparrot.com), and drag the file into Test Parrot to import it.

Also include a concise conversion report containing:

- source pages/images inspected;
- whether triage treated the source as a test (the package has an Exam) or as questions only (no Exam), and for a test which Multiple Choice positions were given `columns`;
- total Questions converted;
- counts by Question Type (a matching set is one Question; also give its item count);
- whether answer correctness was supplied or left incomplete;
- number of embedded Media Assets;
- every ambiguity, omission, normalization, or unsupported element—or “None” when there were none;
- an **Unconverted Questions** section listing each source page and question identifier, opening words, and the reason it could not be converted—or “None” when every question was converted.

Do not describe the result as complete if the Unconverted Questions section is not “None.” It is acceptable and safer to deliver a valid partial JSON file with an explicit warning than to corrupt meaning by forcing an uncertain question into the wrong type.
