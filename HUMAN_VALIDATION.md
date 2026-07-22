# Human Validation Checklist

These checks require real equipment or a real provider account. They cannot be completed safely by generated code.

- [ ] Print a sample student form on at least two printer models.
- [ ] Run each printed form through the actual bubble-sheet scanner and confirm bubble registration and Form ID recognition.
- [ ] Identify the exact Scantron product in use (for example, ParScore, Scantron Score, or ScanTools).
- [ ] Obtain that product's documented answer-key import schema and replace the marked placeholder adapter.
- [ ] Import a generated key into the actual grader and compare every answer with the printed key.
- [ ] Upload a real scanned assessment and compare every reviewed draft against the source, including math notation, option order, answer markings, and page boundaries.
- [ ] Repeat the extraction check with handwriting and dense multi-column pages if those are expected inputs.
- [ ] Confirm the deployed VM has Chromium available to the service account and a writable media directory.
- [ ] Set a production `AUTH_SECRET`, SQLite database path outside the release directory, media-store configuration, and a real email provider before enabling magic-link delivery.
