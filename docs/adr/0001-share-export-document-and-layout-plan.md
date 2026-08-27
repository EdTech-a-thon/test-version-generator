---
status: accepted
---

# Share the Export Document and Layout Plan across output formats

Print and DOCX were independent reconstructions of an exam, so they could disagree while their isolated tests passed. Export will instead derive one format-neutral Export Document and one Layout Plan, then translate that plan through separate print and DOCX Export Adapters. The shared representations make semantic content, page assignment, grids, headers, footers, and explicit breaks decisions made once rather than recreated per format.

The Reference PDF captured from the print Export Adapter is the layout oracle. Out-of-band acceptance renders DOCX with a pinned LibreOffice Comparison Engine and requires the same page count and dimensions, the same ordered content on each page, and the same structural topology. Automatic line wrapping, coordinate-level alignment, raster parity, typography standardization, and layout after a user edits the DOCX are outside this contract.
