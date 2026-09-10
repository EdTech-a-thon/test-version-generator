# Question Bank Record 0.1.0 fixtures

- [`schema.json`](schema.json) is a version-pinned copy of the public schema whose
  stable identifier is `https://testparrot.com/formats/question-bank/0.1.0/schema.json`.
- [`examples/`](examples/) contains the five canonical conforming records.
- [`invalid/`](invalid/) contains one-purpose counterexamples and an expected
  application error-code manifest.
- [`conformance/`](conformance/) contains the fixed external RFC 8785 vector and
  its provenance.

The prose contract is in
[`docs/question-bank-record-0.1.0.md`](../../../../docs/question-bank-record-0.1.0.md).
All conforming records include a valid integrity digest and can be inspected
through Test Parrot's public record-import boundary.
