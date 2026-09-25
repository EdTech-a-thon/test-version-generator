# Test Parrot Package 0.1.0

A **Test Parrot Package** carries one or more Question Bank Records and any number of [Exam Records](exam-record-0.1.0.md) that reference Questions in them. It travels as a standalone JSON file, conventionally named `*.parrot.json`, or embedded in an exported Exam PDF whose Content Selection includes the answer key. Importing it lets the teacher choose which banks and Exams to bring in. See ADR-0022.

## Published contract

- Format: `test-parrot/package`
- Version: `0.1.0`, versioned separately from the records it carries
- Stable schema identifier: `https://testparrot.com/formats/package/0.1.0/schema.json`
- Checked-in schema: [`/formats/package/0.1.0/schema.json`](../public/formats/package/0.1.0/schema.json)
- [Canonical examples](../public/formats/package/0.1.0/examples/)
- [Invalid counterexamples](../public/formats/package/0.1.0/invalid/), with the application error code each is rejected with in `manifest.json`

## Envelope

| Member             | Meaning |
| ------------------ | ------- |
| `format`           | Exactly `test-parrot/package`. |
| `formatVersion`    | Exactly `0.1.0`. |
| `generator`        | `{ name, version }` of the software that wrote the package. Informational. |
| `requiredFeatures` | Features a reader must understand. Test Parrot 0.1.0 defines none, so a non-empty list is rejected. |
| `questionBanks`    | At least one `{ "id", "record" }`. `id` is a package-local bank id, unique within the package. `record` is a complete [Question Bank Record](question-bank-record-0.5.0.md) of any version Test Parrot reads, validated by that version's own schema and rules. |
| `exams`            | Zero or more complete Exam Records, each validated by its own version's schema and rules. |

A bare Question Bank Record file remains importable and reads as a package with one bank and no Exams. An Exam Record on its own is not importable.

## Validation

The whole file is accepted or rejected; nothing is imported from a file that fails any rule. A package is rejected when:

- any format or version, of the package or of anything in it, is unsupported;
- bank ids are duplicated;
- any bank breaks a Question Bank Record rule or limit;
- an Exam references a bank or Question that is not in the package;
- an Exam uses one Question twice;
- a position option does not fit its Question's type;
- an answer order is not an exact permutation of the Question's answers.

A bank may hold Questions no Exam uses. An Exam may draw on several banks in its package but never on a bank outside it.

Every Question Bank Record limit applies to each bank. The Question count and total decoded media limits also apply across the whole package, and a package holds at most 100 banks and 100 Exams.

## Importing

The teacher allows or denies each bank and Exam. Denying a bank denies every Exam that uses it; allowing an Exam allows every bank it uses. Each allowed bank goes into a new Question Bank, named from its record unless the teacher renames it, or is added to an existing Question Bank. Adding always appends fresh Questions, never deduplicates, and keeps the existing bank's name, description, author and license. Every Question and answer gets a fresh local identity, and Media Assets are stored by content hash.

## Exam PDF carrier

An Exam PDF exported with its answer key carries a package under the same attachment identity a Question Bank File uses (`pdfcx.json`, `application/json`, description `pdf-canonical-extraction`, relationship `Source`). It holds one Exam Record for exactly what that PDF printed and, for each bank the Exam draws on, a Question Bank Record containing only the Questions that Exam uses. Student-only PDFs and DOCX exports carry nothing.
