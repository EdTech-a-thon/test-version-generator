# Test Parrot

Test Parrot authors reusable questions, saves Exams, and records what teachers export while preserving the intended structure and layout across output formats.

## Language

**Question**:
A canonical record owned by exactly one Question Bank and referenced live by any number of Exams. One Question identity may occur at most once in an Exam; Duplicate creates a new Question in the original Question Bank.
_Avoid_: Exam question, question copy

**Question Content**:
The rich-text material authored for one question, including its stem and, when present, its answer choices or Suggested Answer.
_Avoid_: Question text, editor content

**Question Metadata**:
Difficulty and Topics used to organize and find Questions while composing an Exam. Question Metadata appears as tags beside each entry in an exported Answer Key, but does not appear on the student test.
_Avoid_: Question identity, export identity

**Question Bank**:
An independently reusable, named collection of canonical Questions whose confirmed changes save immediately. It may carry an optional description, author, and license; a new bank is named “Untitled Question Bank” by default. An Exam may reference Questions from any number of banks, and a bank may contribute Questions to any number of Exams.
_Avoid_: Question library

**Question Bank File**:
A self-contained PDF for sharing one complete Question Bank. Its complete teacher-readable preview is derived from its embedded Question Bank Record, which is the authoritative source for importing that bank.
_Avoid_: Exam export, printable question bank, backup

**Question Bank Record**:
The versioned, format-owned machine-readable representation of one Question Bank and every Media Asset it needs. It travels embedded in a Question Bank File, as a standalone JSON file, or inside a Test Parrot Package, and is the authoritative source for import in every case. Import either creates a new independent Question Bank from it or adds its Questions to an existing bank as new Questions, never preserving local identities or inferring Question Content from PDF pages.
_Avoid_: PDF metadata, extracted questions

**Exam Record**:
The versioned, format-owned machine-readable composition of one Exam: its name and, for each position, the Question it references in a Question Bank Record travelling in the same Test Parrot Package, with that position's answer columns, answer order, and Work Space. It never references a Question outside its package, and it carries no Section order, because Sections always follow Test Parrot's own order.
_Avoid_: Exam layout, test JSON

**Test Parrot Package**:
A versioned bundle of one or more Question Bank Records and any number of Exam Records that reference Questions in them, versioned separately from both. It travels as a standalone JSON file or embedded in an exported Exam PDF whose Content Selection includes the answer key; importing it lets the teacher choose which banks and Exams to bring in.
_Avoid_: Import package, bundle, transfer file

**Account Backup**:
One file holding everything Test Parrot keeps in a browser: every Exam, Question Bank, Working Copy, Export History, Media Asset and preference. Restoring one replaces the browser's whole account rather than merging into it; it is refused when it comes from a storage generation this version cannot read.
_Avoid_: Export, Question Bank File, archive

**Difficulty**:
An optional classification of a question as easy, medium, or hard.

**Topic**:
An optional, free-form label describing subject matter assessed by a question. A question may have more than one Topic.
_Avoid_: Concept

**Authored Image Size**:
The width a teacher assigns to a block image relative to its printable container, such as the Question Content lane or an answer-choice cell. It preserves the image's intrinsic aspect ratio.
_Avoid_: Image ratio, image height

**Exam**:
A mutable composition with a stable identity and a name, made from live references to Question Bank records. A new Exam is named “Untitled Exam” by default; Save updates it, while Save As moves the current Working Copy into a separate Exam and restores the source Exam to its last saved state. An untouched, empty Untitled Exam is disposable rather than durable.
_Avoid_: Exam project, exam family, Version, Draft

**Working Copy**:
The locally backed-up editing state currently open for an Exam. It may differ from the Exam's explicitly saved state and is the state that Save, Save As, and Export act upon.
_Avoid_: Exam Draft, Draft, autosaved Exam, local save

**Export Record**:
An immutable, undeletable record attached to an Exam and created each time its Working Copy or a previous Export Record is exported. It retains only the exact Content Selection, format, question state, and Layout Plans produced by that event; repeated and historical re-exports produce separate Export Records, and export does not save the Exam.
_Avoid_: Version, saved Exam, deduplicated export

**Export Artifact**:
A PDF or DOCX produced by an export and described by its Export Record.
_Avoid_: Version, Exam

**Export History**:
The permanent chronological collection of an Exam's Export Records. Export History preserves what the teacher produced without making the Exam immutable.
_Avoid_: Version History, audit log

**Remove**:
To exclude Question Content from an Exam while leaving it in its Question Bank.

**Replace**:
To put one Question Bank record in another's fixed position in an Exam, using the incoming Question's authored answer order and the outgoing reference's answer-column layout. Neither Question is copied or deleted, and the replaced Question remains in its Question Bank.
_Avoid_: Swap, substitute

**Delete**:
To permanently remove Question Content from its Question Bank, every Exam that references it, and their Working Copies. Deletion requires showing the affected Exams and explicit confirmation; existing Export Records remain unchanged.

**Question Type**:
What a Question asks for, settled when it is created and never changed afterwards: Multiple Choice, True/False, Matching, Short Answer, or Multipart. It decides the Question Section the Question prints in, the directions printed above it, and what its Answer Key entry records.
_Avoid_: Question format, question kind

**True/False**:
A Question Type whose answer is one of exactly two fixed choices, True and False, which the teacher picks between rather than writes. The pair is never printed on the student test — the section's directions ask for a T or an F in the answer blank — and the Answer Key records T or F rather than a choice letter. It does not Vary: True before False is a convention a student reads, not an authored order.
_Avoid_: Binary question, T/F question, two-choice multiple choice

**Matching**:
A Question Type that is one whole set: its stem is the set's directions, its Items are what a student matches, and its Word Bank is what they are matched against. One Matching Question takes one test number per Item — the numbers print on the Items, and the stem prints unnumbered — because the Items share one Word Bank. A Question Bank keeps a set whole: an Item is never a Question of its own.
_Avoid_: Matching question (for one Item), match list, pair

**Item**:
One numbered thing to match in a Matching set, in authored order. It is matched by naming one Word Bank answer, by identity rather than by letter, so a shuffled Word Bank moves its letter and not its match; an Item that names nothing is unmatched, which is incomplete rather than invalid. Its Answer Key entry records the letter of the answer it names.
_Avoid_: Prompt (in teacher-facing text), stem (for an Item), left side

**Word Bank**:
The lettered answers a Matching set's Items are matched against, in authored order. A letter is a position — Vary may shuffle a Word Bank, as it shuffles Multiple Choice answers — and no answer is correct on its own: several Items may name the same answer, and an answer no Item names is a distractor. A Word Bank of up to five answers prints beside its Items; a longer one prints above them in columns.
_Avoid_: Choices (for a Matching set), answer list, right side

**Short Answer**:
A Question Type whose response is intentionally brief and does not present answer choices.
_Avoid_: Open, Open ended, Open Response, Short Response

**Suggested Answer**:
Optional rich-text material authored for a Short Answer question to represent its answer in the Answer Key.
_Avoid_: Correct answer, sample response, rubric

**Multipart**:
A Question Type whose Question is a stem followed by its Parts. The stem is ordinary rich text, usually the shared material the Parts are asked about — a passage, quote, image, table or anything else. One Multipart question takes one test number, and its Parts are lettered beneath it. A Question Bank keeps it whole: a Part is never a Question of its own, and an Exam adds, Removes and Replaces a Multipart question as one Question.
_Avoid_: Stimulus, passage, document-based question, question group, source

**Part**:
One lettered question within a Multipart question, in authored order: a Multiple Choice Part with its own stem and answers, or a Short Answer Part with its own stem and optional Suggested Answer. Unlike a Question's type, a Part's type may be switched while it is edited; only the answers of the type it ends as are saved. Parts are never shuffled, since they are lettered in place and often build on one another, but a Multiple Choice Part's answers Vary as a Multiple Choice question's do. A Multipart question with no Parts is incomplete rather than invalid. Question Metadata belongs to the Multipart question, not its Parts; its Answer Key entry records one line per Part.
_Avoid_: Sub-question, item (Item is Matching's), sub-part

**Work Space**:
Room an Exam leaves below a Short Answer question or Short Answer Part for a student's working: blank or ruled, as tall as the teacher drags it, or filling the rest of its page. It is Exam presentation set on the exam sheet like answer columns, never Question Content, so the same Question may take different room on another Exam; Replace keeps a position's Work Space and Duplicate copies it.
_Avoid_: White space, answer box, response area

**Page Header**:
The line an Exam prints at the top of each test page, beside the paper's ID. By default it is Name, Class and Date blanks on the first page and a Name blank on later ones; an Exam may reword the first page's line and the later pages' line, as plain text in which underscores are the blanks, or clear either. The ID is the one value the header fills in for each paper and is never part of the line. The Exam's title prints on its own line under the first page's header, and Answer Key pages carry the ID alone.
_Avoid_: Letterhead, banner, identity line

**Question Section**:
A group of questions of the same Question Type whose boundary remains fixed within an Exam and its exported output, such as Multiple Choice, True/False, Matching, Short Answer, or Multipart. A Section prints its own heading and its own directions, and is omitted entirely when it holds no Questions. Each Section has default wording, which an Exam may reword, or clear so it prints nothing, for that Exam alone; every heading on an Exam prints at one of three sizes. The Answer Key's section titles follow the test's.
_Avoid_: Question category

**Vary**:
A family of Exam actions that shuffle question order or answer order — a Multiple Choice question's or Part's answers, or a Matching set's Word Bank — before saving or exporting.
_Avoid_: Randomization, version generation

**Export Preview**:
A read-only, output-faithful rendering of the Working Copy with selection, correctness, and other editor annotations hidden. It is not a separate draft or editing workspace.
_Avoid_: Export workspace, draft version

**Media Asset**:
Immutable image bytes identified by their content rather than by a mutable location. Export Records retain Media Asset references so recorded output does not depend on an external or disposable image URL.
_Avoid_: Image URL, cached image

**Export Document**:
The format-neutral semantic content and presentation intent for one Exam export and Content Selection.
_Avoid_: Central representation, export model

**Layout Plan**:
The format-neutral resolution of an Export Document into pages, grids, headers, footers, and explicit break decisions.
_Avoid_: Rendered document

**Content Selection**:
Which documents an export covers — the student test, the answer key, or both.
_Avoid_: Print content, mode

**Export Adapter**:
A translator from a Layout Plan into a particular output format, such as print HTML/PDF or DOCX.
_Avoid_: Renderer

**Reference PDF**:
The PDF captured from the print Export Adapter and treated as the layout oracle for export acceptance.
_Avoid_: Golden PDF

**Comparison Engine**:
External software used during testing to render a DOCX into a PDF whose structure and geometry can be compared with the Reference PDF.
_Avoid_: DOCX renderer

**Export Fingerprint**:
The normalized semantic content, page assignment, and structural topology used to compare an Export Document, its Layout Plan, and each Export Adapter's output. It excludes output format, package bytes, generated identifiers, coordinates, fonts, raster appearance, and renderer-chosen line wrapping.
_Avoid_: Version identity, snapshot, golden
