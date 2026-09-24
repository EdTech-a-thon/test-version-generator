---
status: accepted
---

# Sync whole accounts through the teacher's own Drive

Everything a teacher makes lives in one browser, and a teacher who works at school and at home, or whose browser clears its storage, has no way to keep it. Two things were asked for: a file that saves the entire account and can be restored later, and a way to keep that account in step across devices without Test Parrot storing anyone's work.

The **Account Backup** is a zip read straight out of IndexedDB. It takes every object store of the registry database and of every Exam's own database — records, keys, key paths and indexes — plus the app's `test-parrot` preferences. Binary values (Media Asset bytes) become their own zip entries and everything else is JSON with small `$tp` markers for values JSON cannot hold. It is deliberately generic: reading through the workspace services would mean every new store or field had to be taught to the backup, and forgetting one would silently lose work. The cost is that a backup is only as portable as the storage generation it came from, so a backup whose `STORAGE_VERSION` differs from the running app is refused rather than interpreted — the same stance ADRs 0004, 0009 and 0015 take on starting storage fresh.

A restore replaces the account; it never merges. Replacing needs every database closed, which a running page cannot guarantee, so the restore is staged in a database of its own and applied first thing on the next load, before anything opens the account. A restore staged from Drive also records the fingerprint of the account it expects to replace, and is skipped if work was written after it was staged.

**Account Sync** keeps one Account Backup in a Test Parrot folder in the teacher's own Google Drive. Sign-in and the `drive.file` grant go through the teacher.dev auth broker, exactly as the reading app does: the broker keeps the refresh token behind its own cookie, and the browser talks to Drive directly with short-lived tokens held in memory. With `drive.file` Test Parrot can see only what it created, so the folder and the file are found by their `appProperties`, never by name.

Sync compares whole accounts rather than records. Records carry no modification times and deletions leave no tombstones, so a record-level merge would bring deleted Questions back and pick winners by guesswork. Instead each browser remembers the fingerprint of the account it last agreed with Drive on — a digest that ignores which Exam or bank the browser last had open — and the Drive file carries its own fingerprint in `appProperties`. Only this browser changed: upload. Only Drive changed: load Drive's copy, before the app starts where possible and otherwise when the teacher chooses, because replacing an account under an open editor would be worse than a moment's staleness. Both changed: the teacher picks a side, and the side not kept is saved as a dated copy in the same folder, so settling a conflict never loses work. A browser with nothing of its own joins Drive's account without being asked.

There is no change event across the stores, so a sync pass runs every minute while the page is visible, when it is hidden or closed, when it becomes visible again, and when the network returns. A Web Lock keeps tabs of one browser from syncing at once.
