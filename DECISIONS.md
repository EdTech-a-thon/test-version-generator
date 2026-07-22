# Product Decisions

1. **Content author is the target.** Test Generator helps teachers write, reuse, and generate assessments. It intentionally includes no pre-authored question library.
2. **Difficulty balancing is a soft target by default.** Assembly warns when a pool cannot meet the target. A strict switch can stop generation instead. A slightly imperfect form is more useful than a failure on the night before a test.
3. **Four choices are the default.** Authors may use up to five choices for scan-form layouts.
4. **Login is required.** This makes department sharing possible through organizations, but means core work is not available offline.
5. **Legacy materials come through reviewable extraction.** Spreadsheets, PDFs, and images enter a review queue; no extracted item enters a bank automatically.
6. **Generic CSV is the only working key export.** The Scantron family has several incompatible products and unpublished schemas. The Scantron, ZipGrade, and GradeCam adapters are clearly marked placeholders until a human provides the actual target format.
7. **Print output uses browser PDF printing.** Text and math remain vector output; answer bubbles use fixed CSS geometry rather than a rasterized canvas.
