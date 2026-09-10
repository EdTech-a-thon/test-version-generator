---
status: accepted
---

# Use launch parameters to enter one restorable editor

The home screen launches the same `/editor` workspace with a one-time `exam`, `bank`, or `new` query parameter rather than using different routes for the same interface. The editor consumes that intent, stores the active Exam and Question Bank tab workspace in IndexedDB, and replaces the URL with bare `/editor`; refresh restores the last active workspace from IndexedDB, while browser Back navigates between product screens rather than replaying editor selections. Launching an Exam from outside the editor restores that Exam's saved tab workspace, and launching a Question Bank enters bank-only mode; there is no separate in-editor action to abandon an Exam for bank-only mode. Opening an Exam from within the editor changes only the active Exam, carries the currently visible bank tabs into that Exam's workspace, and does not merge its previously remembered tabs. Filters are remembered independently per bank tab, and dragging Questions between banks is not supported. Workspace state remains separate from Exam content, so tab changes do not affect Save, unsaved status, or Export. Concurrent editor tabs are unsupported for now.
