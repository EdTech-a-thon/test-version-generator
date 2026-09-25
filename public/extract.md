# Convert questions into a Test Parrot Package

Use these instructions to convert questions from a PDF, image, scan, screenshot, document, or plain text into a JSON file that a user can import into Test Parrot.

## Required result

Always create one complete UTF-8 JSON file using the **Test Parrot Package `0.1.0`** format. Name the downloaded file:

```text
<short-name>.parrot.json
```

A package always holds exactly one Question Bank Record `0.6.0` with every converted Question. What else goes in it depends on the source, so triage it first:

- **The source is a test** — an exam, quiz, worksheet or any paper a student sits, with its questions in a printed order: also add one Exam Record `0.1.0` that lays the Questions out as the test does (see [Tests](#tests)).
- **The source is only questions** — a question pool, a study list, a bank exported from elsewhere, anything not laid out as one paper: add no Exam. `exams` is an empty array.

When it is unclear whether the source is a test, ask the user; if you cannot ask, add no Exam and say so in the report. Never invent an Exam the source does not show. Everything below about Questions applies either way: the package's bank is an ordinary Question Bank Record.

When finished:

1. Give the user the JSON as a downloadable file. Do not provide only a JSON code block when you can create a file attachment.
2. Tell the user: **Download the JSON file, open [testparrot.com](https://testparrot.com), and drag the file into Test Parrot to import it.**
3. **If you are Gemini,** do not try to create, attach, or present a file. Show the complete JSON in a single `json` code block instead, and follow the Gemini delivery instructions under **Final validation and delivery**.
4. Report any ambiguity, unreadable source content, or unsupported material. If there are no such limitations, explicitly say that the complete source was converted.

Do not generate a PDF. Do not return a summary in place of the JSON file.

## Public format resources

Use these resources as the source of truth:

- [JSON Schema](./formats/question-bank/0.6.0/schema.json)
- [Minimal Multiple Choice example](./formats/question-bank/0.6.0/examples/minimal-multiple-choice.json)
- [True/False example](./formats/question-bank/0.6.0/examples/true-false.json)
- [Matching example](./formats/question-bank/0.6.0/examples/matching.json)
- [Multipart example](./formats/question-bank/0.6.0/examples/multipart.json)
- [Short Answer example](./formats/question-bank/0.6.0/examples/short-answer.json)
- [Complete rich-text example](./formats/question-bank/0.6.0/examples/complete-rich-text.json)
- [Provenance and links example](./formats/question-bank/0.6.0/examples/provenance-and-links.json)
- [Pending Images example](./formats/question-bank/0.6.0/examples/pending-images.json)
- [Side-by-side example](./formats/question-bank/0.6.0/examples/side-by-side.json)
- [Test Parrot Package JSON Schema](./formats/package/0.1.0/schema.json) and [Exam Record JSON Schema](./formats/exam/0.1.0/schema.json)
- [Package example: a test, with its bank and Exam](./formats/package/0.1.0/examples/bank-and-exam.json)
- [Package example: questions only, with a bank and no Exam](./formats/package/0.1.0/examples/bank-only.json)

The Question Bank Record inside the package has this top-level shape:

```json
{
  "format": "test-parrot/question-bank",
  "formatVersion": "0.6.0",
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

Do not add application database IDs, local paths, timestamps, page numbers, layout coordinates, OCR confidence, or conversational notes to the record. The only exception is the `pending` member of a Pending Image (see [Images and Pending Images](#images-and-pending-images)). A test's layout belongs in its Exam Record, and only in the members that format defines.

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
    { "id": "bank", "record": { "format": "test-parrot/question-bank", "formatVersion": "0.6.0", "...": "the complete Question Bank Record" } }
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
- Give the Exam one position for every converted Question, in printed order, each naming `"bank": "bank"` and that Question's ID. Use each Question exactly once. An unconverted question gets no position. A Multipart question is one Question, so it takes one position, however many source numbers its Parts carried.
- Write every Question's choices and Word Bank answers into the bank in the order the test prints them. That records the test's answer order, so leave out `answerOrder`: answers print in the order the bank records them, and the answer key's letters stay right.
- Record `columns` (`1`, `2` or `4`) on a Multiple Choice position only when the source layout makes it clear how many columns its answers are printed in — for example, four answers side by side on one line is `4`. When it is not clear, leave `columns` out. Never put `columns` on any other Question Type.
- Never add `workSpace`. Room left for writing is not something to guess from a scan; the teacher sets it in Test Parrot.
- Do not add point values, section headings, instructions, or any other member: the Exam Record has none of these.

Test Parrot always prints Sections in the order Multiple Choice, True/False, Matching, Short Answer, Multipart. Keep the source's printed order anyway; Test Parrot regroups the Sections itself and keeps the order within each.

## Completeness is mandatory—but do not force uncertain content

Unless the user explicitly asks for a subset, attempt to convert **every question and every supported part of the source**. A sample, first-page conversion, or silently partial conversion is not acceptable.

> **If you cannot reliably determine the type of question, do not force it into a specific form. Just leave it and explicitly warn that you could not convert.**

Completeness means accounting for every source question, not pretending every question was converted successfully. Never classify an ambiguous question as Multiple Choice, True/False, Matching, Short Answer or Multipart merely to make the output appear complete. Leave that question out of the JSON, identify it by source page and visible number or opening words, explain why its type could not be determined, and include it in the final conversion report as unconverted. Ask the user for clarification when possible; after clarification, add the question in its correct form.

### Before conversion

1. Inspect every supplied page, image, table, answer-key section, footnote, continuation, and annotation.
2. For a long source, process it in batches and maintain a page-coverage and question-count checklist. Do not silently stop because of a context or output limit.
3. Inventory all questions in authored order. Reconcile the inventory with visible numbering. A matching section counts one source number per item, but is converted as one Question per word bank (see [Matching](#matching)). Likewise, questions that share one passage, quote, image or table count one source number each, but are converted as one Multipart Question (see [Multipart](#multipart)).
4. Record unexplained duplicate or missing numbers as source ambiguities; do not silently renumber them away.
5. Identify any content that is unreadable or cannot be represented by this format before claiming completion.

### During conversion

1. Classify a question as `multiple-choice`, `true-false`, `matching`, `short-answer` or `multipart` only when the source supports that classification. Version `0.6.0` supports only those five types. If its type is uncertain or it cannot be represented without material loss, leave it out and report it explicitly; never coerce it into the closest supported type.
2. Preserve the exact wording, punctuation, capitalization, symbols, units, and meaningful whitespace.
3. Preserve authored question and choice order.
4. Preserve paragraphs, headings, blockquotes, lists, code, rules, tables, equations, hard breaks, links, images, captions, content printed side by side, and text formatting when present (see [Page layout: boxes and side-by-side content](#page-layout-boxes-and-side-by-side-content)).
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
- every block of questions that shares one passage, quote, image or table is one Multipart Question with its Parts in printed order, or is listed as unconverted;
- correctness was never inferred from general knowledge;
- all supplied Difficulty and Topics values were preserved;
- meaningful formatting, especially subscript and superscript, was preserved semantically;
- every image, caption, table, list, equation, hard break, and safe link was preserved;
- all Question, choice, item, word bank, Part and Part choice IDs are unique and sequential;
- every meaningful image, including an image used as an answer choice, matching item or word bank answer, is a Pending Image;
- every picture has its own Pending Image, with pictures printed side by side split rather than merged — one per `panel` of a `side-by-side`;
- shared material — a passage, picture, table or anything else that directions such as “Use the information above for problems 3 – 5” refer to — appears once, in the stem of the one Multipart Question whose Parts are those problems, and is never repeated in a Part's stem or in another Question;
- every boxed passage or quote is a `blockquote`, with its “Source: …” line as the ordinary paragraph right after it, and was transcribed as text even when the source stores it as a picture;
- content printed side by side is one `side-by-side` of two or three `panel`s, left to right, directly in a Question's or Part's stem — never in a choice, matching item, word bank answer or Suggested Answer, never inside a blockquote, list, table or another `side-by-side`, and never for answer choices laid out in a grid;
- borders and shaded boxes that only frame or group the questions themselves were ignored;
- every Pending Image names the tag printed on its picture, or its page when the picture has no tag;
- every tag in the [image tag list](#image-tags-in-this-document) is accounted for in the conversion report;
- the Question Bank Record's `media` is an empty array;
- for a test, the Exam has one position per converted Question, in printed order, each naming an existing Question ID in the package's bank, and no Question twice;
- for a test, every `columns` value reflects a layout the source makes clear, sits only on a Multiple Choice position (never on a Multipart question), and no position has `workSpace`;
- the file is a Test Parrot Package with exactly one Question Bank Record, and it holds an Exam only if the source is a test;
- the final JSON passes the public schema and semantic rules.

If any check fails, fix the record or disclose the precise limitation. Never say the extraction is complete when it is not.

## Question types

Version `0.6.0` supports `multiple-choice`, `true-false`, `matching`, `short-answer`, and `multipart` Questions. Do not use any of them as a fallback for an unknown, mixed, or unsupported Question Type. In particular, do not turn an uncertain question into Short Answer merely because it has no clearly detected choices, do not turn a two-choice question into True/False unless those two choices really are true and false, do not turn a matching section into Multiple Choice questions that each repeat the word bank, and do not turn a passage and its questions into separate questions that each repeat the passage — or that leave it out. Leave it unconverted and warn the user instead.

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

### Multipart

A Multipart question is a stem of shared material — a passage, a quote, a speech, a diagram, a map, a chart, a table, or anything else — followed by the questions, its Parts, that a student answers from it. It typically looks like this in the source:

```text
Base your answers to questions 12 and 13 on the passage below and on your
knowledge of social studies.

    The power of the [Ottoman] Empire was waning by 1683 …

        Source: “Ottoman Empire (1301–1922),” BBC online, 2009 (adapted)

12 Which region was controlled by the Ottoman Empire in 1683?
   (1) Central America        (3) East Asia
   (2) South Asia             (4) Middle East

13 Based on the passage, identify an issue faced by the Ottoman Empire in the 1600s.
   (1) The empire became too large to govern.
   (2) Global trade routes shifted.
   (3) Rulers were responsive to the needs of the people.
   (4) Trade increased in the empire.
```

Convert **the material and every question asked about it as one `multipart` Question**, even though the source numbers each question separately. Each of those questions becomes one **Part** of the Multipart question, in printed order. Do not split the block into one Question per source number, do not repeat the material in several Questions, and never convert a Part as a standalone Question without its material: a student cannot answer it. Test Parrot prints the Multipart question under one number and letters its Parts beneath it (`a.`, `b.`, …).

Recognise a Multipart question by an instruction such as “Base your answers to questions 12 and 13 on …”, “Use the map below to answer questions 4 through 6”, or “Read the passage and answer the questions that follow”, or by any shared material that the following questions refer to. A single question introduced this way (“Base your answer to question 5 on the graph below”) is a Multipart question with one Part.

A Multipart Question:

- has an ID such as `q5`;
- keeps the shared material in the `stem`: the passage, quote, image, table or diagram, with any source or attribution line (for example “Source: …”, “— Patrick Henry, 1775”, a caption under a map) written as ordinary content in the stem, where the source prints it;
- leaves out the “Base your answers to questions 12 and 13 …” instruction itself, since it names source numbers that Test Parrot replaces, and it prints its own directions for the Multipart section;
- has `parts`: the questions asked about the material, in printed order, with IDs such as `q5-s1`, `q5-s2`, and so on;
- gives `difficulty` and `topics` to the Multipart Question, never to a Part;
- does not have `choices`, `prompts`, `wordBank` or `suggestedAnswer` of its own — each Part carries its own answers.

Each Part has an `id`, a `type`, and its own `stem`, and its type is one of exactly two:

- A `multiple-choice` Part has at least two `choices` in authored order, with IDs such as `q5-s1-c1`, `q5-s1-c2`, and so on, zero or one of them `correct`, and no `suggestedAnswer`.
- A `short-answer` Part has no `choices`, and may have a rich-text `suggestedAnswer` only when the source or user supplies one.

Leave the source's question numbers (`12`, `13`) out of each Part's stem, and its choice numbers or letters (`(1)`, `(2)`, `A.`) out of each choice — they are positions, not content. A key of `12: 4` marks the fourth choice of the Part numbered 12. Never infer correctness from general knowledge, and never reorder the Parts: they are lettered in place and often build on one another.

**If any question in the block is not Multiple Choice or Short Answer** — a True/False statement, a matching set, a nested passage, or a question whose type you cannot determine — do not force it into a Part and do not convert the rest of the block without it. Leave the whole block, material and every question, unconverted and list it under **Unconverted Questions** with the reason. Likewise, when you cannot tell which questions a piece of material belongs to, leave that block unconverted and say so.

```json
{
  "id": "q5",
  "type": "multipart",
  "stem": {
    "type": "document",
    "content": [
      {
        "type": "blockquote",
        "content": [
          {
            "type": "paragraph",
            "content": [
              {
                "type": "text",
                "text": "The power of the [Ottoman] Empire was waning by 1683 …"
              }
            ]
          }
        ]
      },
      {
        "type": "paragraph",
        "content": [
          {
            "type": "text",
            "text": "Source: “Ottoman Empire (1301–1922),” BBC online, 2009 (adapted)"
          }
        ]
      }
    ]
  },
  "topics": ["Ottoman Empire"],
  "parts": [
    {
      "id": "q5-s1",
      "type": "multiple-choice",
      "stem": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [
              {
                "type": "text",
                "text": "Which region was controlled by the Ottoman Empire in 1683?"
              }
            ]
          }
        ]
      },
      "choices": [
        { "id": "q5-s1-c1", "content": { "type": "document", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Central America" }] }] }, "correct": false },
        { "id": "q5-s1-c2", "content": { "type": "document", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "South Asia" }] }] }, "correct": false },
        { "id": "q5-s1-c3", "content": { "type": "document", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "East Asia" }] }] }, "correct": false },
        { "id": "q5-s1-c4", "content": { "type": "document", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Middle East" }] }] }, "correct": true }
      ]
    },
    {
      "id": "q5-s2",
      "type": "multiple-choice",
      "stem": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [
              {
                "type": "text",
                "text": "Based on the passage, identify an issue faced by the Ottoman Empire in the 1600s."
              }
            ]
          }
        ]
      },
      "choices": [
        { "id": "q5-s2-c1", "content": { "type": "document", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "The empire became too large to govern." }] }] }, "correct": false },
        { "id": "q5-s2-c2", "content": { "type": "document", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Global trade routes shifted." }] }] }, "correct": true },
        { "id": "q5-s2-c3", "content": { "type": "document", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Rulers were responsive to the needs of the people." }] }] }, "correct": false },
        { "id": "q5-s2-c4", "content": { "type": "document", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Trade increased in the empire." }] }] }, "correct": false }
      ]
    }
  ]
}
```

A Short Answer Part is written the same way, without `choices`:

```json
{
  "id": "q5-s3",
  "type": "short-answer",
  "stem": {
    "type": "document",
    "content": [
      {
        "type": "paragraph",
        "content": [
          {
            "type": "text",
            "text": "Explain one reason the Ottoman Empire's power was waning by 1683."
          }
        ]
      }
    ]
  }
}
```

When the shared material is an image, a map or a chart, put it in the stem as a Pending Image `block-image` (see [Images and Pending Images](#images-and-pending-images)); a table is a `table`. A passage or quote printed inside a border is a `blockquote`, with its “Source: …” line as the ordinary paragraph right after it, as in the example above; material printed side by side, such as two graphs or a picture beside text, is a `side-by-side` (see [Page layout: boxes and side-by-side content](#page-layout-boxes-and-side-by-side-content)). The material belongs to the Multipart question alone: write it once, in its stem, and never copy it into a Part's stem or into any other Question.

## Rich text

Each stem, choice, matching item, word bank answer, Part stem, and Suggested Answer is a semantic document:

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
- `side-by-side`, holding two or three `panel` nodes — only directly in a Question's or a Part's stem (see [Page layout: boxes and side-by-side content](#page-layout-boxes-and-side-by-side-content))

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

The same formatting rules apply inside stems, choices, matching items, word bank answers, Multipart Parts, and Suggested Answers.

## Page layout: boxes and side-by-side content

Most of a page's layout is not content: Test Parrot lays the test out itself. Two things a page does with its content are, and each has one node.

**A boxed source is a `blockquote`.** A passage, quote, speech excerpt or document printed inside a border is a `blockquote` holding its paragraphs. Its attribution — “Source: …”, “— Patrick Henry, 1775” — is the ordinary paragraph right after the blockquote, outside it, even when the source prints it inside the box. Transcribe a boxed passage as text even when the source document stores it as a picture; keep a picture only for genuine artwork, such as a map, chart, cartoon, photograph or graph.

**Content printed side by side is a `side-by-side`.** Two graphs next to each other, two tables, a table beside a graph, or a picture beside its text are one `side-by-side` with one `panel` per item, left to right:

```json
{
  "type": "side-by-side",
  "content": [
    {
      "type": "panel",
      "content": [
        { "type": "block-image", "pending": { "image": 3 }, "alt": "Graph of f", "caption": "Graph of f" }
      ]
    },
    {
      "type": "panel",
      "content": [
        { "type": "block-image", "pending": { "image": 4 }, "alt": "Graph of g", "caption": "Graph of g" }
      ]
    }
  ]
}
```

Rules:

- A `side-by-side` holds two or three `panel`s and nothing else, and has no other members. When the source prints four or more items across one line, write them as ordinary blocks one after another, or as two `side-by-side`s, one under the other, and say so in the report.
- A `panel` holds one or more blocks — paragraphs, headings, blockquotes, lists, tables, equations, pictures — in the order they read inside it. A `panel` never holds another `side-by-side`.
- A `side-by-side` is written only directly in a Question's `stem` or a Multipart Part's `stem`, as one of its top-level blocks: never in a choice, a matching item, a word bank answer or a Suggested Answer, and never inside a blockquote, list, table or panel.
- Text above or below the items, such as the question or a caption spanning both, stays outside the `side-by-side`, before or after it in the stem.
- **Answer choices laid out in a grid are not a `side-by-side`.** Write the choices as ordinary `choices`; for a test, the grid is the position's `columns` (see [Tests](#tests)).

**Boxes around the questions themselves are layout.** A border or shaded box that only frames or groups questions — a box around each question, around a section, or around an answer area — is not content. Ignore it: do not write it as a `blockquote`, a `side-by-side`, a table or a rule.

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

## Images and Pending Images

If an image is meaningful Question Content—for example, a graph or diagram the Question asks about, or a picture used as an answer choice—preserve it. Do not replace it with an invented description.

**Do not create Media Assets, and never write base64.** Instead, write a **Pending Image**: an image node that names the picture by its tag. Test Parrot takes the picture from the original file when the teacher imports the JSON.

**The file you were given may be a labeled copy**, and the [image tag list](#image-tags-in-this-document) below says whether it is. In a labeled PDF, Test Parrot has printed a small red tag, such as **IMG 3**, in the top-left corner of every image embedded in the document. In a labeled Word document, the red tag sits in the text just before its picture: it names the picture that follows it. The tags are not part of the source: never copy a tag into Question Content, `alt`, or `caption`, and describe each picture as if its tag were not there.

```json
{
  "type": "block-image",
  "pending": { "image": 3 },
  "alt": "Map of European trading stations in Africa and Asia around 1750",
  "caption": "Major European Trading Stations and Possessions in Africa and Asia c. 1750"
}
```

Rules:

- A Pending Image has a `pending` member and **no `asset` member**.
- `pending` holds `image`: the number on the tag printed on that picture. Read the number from the tag; do not count images yourself.
- A picture with no tag, such as a diagram drawn with lines or a picture on a scanned page, gets `"pending": { "page": <n> }` instead, where `n` is the 1-based page of the file as a PDF viewer counts it (in a Word document, always `1`). Do not add coordinates or any other location.
- **Not every tag is a picture.** Test Parrot tags every embedded image, and some documents store a reading passage, a table, an equation, or a caption as an image. Transcribe those as ordinary content—text, a table, or math—exactly as you would if they were typed, and do not write a Pending Image for their tag. A tagged image that holds only words, such as a boxed reading passage with its source line, is text: transcribe it as a `blockquote` with its source line as the paragraph right after it (see [Page layout: boxes and side-by-side content](#page-layout-boxes-and-side-by-side-content)). A passage that several questions share is written once, in the stem of the Multipart Question those questions become (see [Multipart](#multipart)). Keep a picture only for genuine artwork, such as a map, chart, cartoon, photograph or graph. Write a Pending Image for a tag of words only if you cannot read its words reliably, and say so in the conversion report.
- Put the Pending Image exactly where the picture belongs: in the `stem` when the picture belongs to the question, or in the choice's `content` when the picture is that answer choice.
- **Write one Pending Image per picture.** Two graphs side by side, such as “Graph of f” and “Graph of g”, are two pictures and need two Pending Images, in reading order, each in its own `panel` of one `side-by-side`. When you cannot tell whether something is one picture or several, write several: an extra Pending Image is easy for the teacher to fill, and a missing one is not.
- **Shared pictures belong to a Multipart Question.** When one picture serves several questions, those questions are the Parts of one Multipart Question, and the picture is written once, in its stem. Directions such as “Use the information above for problems 3 – 5” mean that problems 3, 4, and 5 are the Parts of one Multipart Question whose stem holds the pictures those directions refer to; never copy the pictures into each Part's stem or into separate Questions (see [Multipart](#multipart)). The same tag appears in more than one place only when the source itself uses the same picture as content of two unrelated Questions, and then every occurrence names that tag.
- Put caption text printed beside or below the picture in `caption`, even if the source shows the caption as an image.
- Give every Pending Image useful `alt` text describing what the picture shows. `authoredSize` from `0.05` through `1` is optional.
- Use `block-image` for a picture that stands on its own line, including a picture that is an answer choice's whole content. Use `inline-image` only for a small picture inside a line of text.
- Leave the Question Bank Record's `media` array empty: `"media": []`.

**Equations are not images.** Many documents store equations as small pictures. Write every equation as `inline-math` or `display-math` with its source, never as a Pending Image. Likewise, write text that the source shows as a picture, such as a caption or a heading, as text.

If you cannot tell where an essential picture is, identify the affected question and tell the user the conversion is incomplete. Do not omit the image silently.

### Image tags in this document

{{IMAGE_TAGS}}

In the conversion report, account for every tag listed here: which Questions and answers use it as a picture, or that it was transcribed as text, a table, or math, or that it is not Question Content (for example, a logo).

## Question Metadata and provenance

A Question may have:

- `difficulty`: `easy`, `medium`, or `hard`;
- `topics`: an ordered array of strings.

A Multipart Part never has either: they belong to its Multipart Question.

A bank may have:

- `description`;
- `author`;
- `license`, containing a required display `name` and optional absolute HTTP or HTTPS `url`.

Include only information explicitly present in the source or supplied by the user. Declared author and license information are not proof of identity or ownership.

## Final validation and delivery

Validate the package against the [package schema](./formats/package/0.1.0/schema.json), its Question Bank Record against the [Question Bank Record schema](./formats/question-bank/0.6.0/schema.json), and any Exam against the [Exam Record schema](./formats/exam/0.1.0/schema.json). Schema validation alone is not sufficient: also verify Question cardinality, unique IDs, that every matching `answer` names an ID in the same Question's `wordBank`, that every Multipart Part is Multiple Choice with at least two choices or Short Answer with none, that every `side-by-side` has two or three panels and stands directly in a stem, safe links, and that every Pending Image follows the rules above.

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

**If you are Gemini,** show the complete JSON in one `json` code block rather than trying to present a file, and never shorten or elide any part of it. Then tell the user:

> Copy the JSON from the code block (use its copy button), paste it into a plain-text editor, and save it as `<short-bank-name>.question-bank.json`. Then open [testparrot.com](https://testparrot.com) and drag the saved file into Test Parrot to import it.

Also include a concise conversion report containing:

- source pages/images inspected;
- whether triage treated the source as a test (the package has an Exam) or as questions only (no Exam), and for a test which Multiple Choice positions were given `columns`;
- total Questions converted;
- counts by Question Type (a matching set is one Question; also give its item count; a Multipart question is one Question; also give its Part count);
- whether answer correctness was supplied or left incomplete;
- every image tag, and which Questions and answers use it as a picture, or how it was transcribed instead;
- every ambiguity, omission, normalization, or unsupported element—or “None” when there were none;
- an **Unconverted Questions** section listing each source page and question identifier, opening words, and the reason it could not be converted—or “None” when every question was converted.

Do not describe the result as complete if the Unconverted Questions section is not “None.” It is acceptable and safer to deliver a valid partial JSON file with an explicit warning than to corrupt meaning by forcing an uncertain question into the wrong type.
