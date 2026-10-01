# Exam Record 0.4.0 fixtures

- [`schema.json`](schema.json) is a version-pinned copy of the public schema whose
  stable identifier is `https://testparrot.com/formats/exam/0.4.0/schema.json`.
- [`examples/`](examples/) contains conforming Exam Records. An Exam Record is
  importable only inside a Test Parrot Package. `question-style.json` prints its
  questions in the ExamView Question Style, and its Short Answer position sets
  its Work Space to none on purpose, so it prints no answer lines though the
  style would rule them there.
- Invalid counterexamples are with the package, in
  [`../../package/0.1.0/invalid/`](../../package/0.1.0/invalid/).

The prose contract is in
[`docs/exam-record-0.4.0.md`](../../../../docs/exam-record-0.4.0.md).
