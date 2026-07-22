# Test Generator

Test Generator is a multi-tenant assessment authoring prototype for teachers who print paper tests. It supports reusable banks, parametric math/science questions, review-first legacy-material ingestion, scrambled forms, and scan-oriented PDFs.

## Run locally

1. Copy `.env.example` to `.env` and set a real SQLite `DATABASE_URL` and `AUTH_SECRET`.
2. Install dependencies with `pnpm install`.
3. Create the database structure with `pnpm db:push`.
4. Start the site with `pnpm dev`.

## Important limits

- Magic-link delivery needs a real email provider. Password sign-in is implemented; email sending is not faked.
- PDF browser printing needs Chromium installed on the Linux VM and a writable filesystem.
- The generic CSV key export is usable. Scantron, ZipGrade, and GradeCam formats are intentionally unconfirmed placeholders. See `src/lib/export/scantron.ts`.
- Vision extraction must be provided through an `ExtractionProvider`; the included manual provider intentionally produces no automatic candidates.

## Linux VM release

1. Keep the SQLite file and media directory outside the release folder, such as `/var/lib/formforge/app.db` and `/var/lib/formforge/media`.
2. Run `npx playwright install --with-deps chromium` as the non-root `formforge` service user. Keep Chromium sandboxing enabled.
3. Run `npx prisma migrate deploy` during the release, before restarting the service. Do not run migrations at application boot.
4. Build with `npm run build`, then deploy the Next standalone output and install `deploy/formforge.service`. Put production values in `/etc/formforge/env`.
5. Put Caddy or nginx in front of the app. A small Caddy example is in `deploy/Caddyfile`.
6. Enable `formforge-backup.timer`. It uses SQLite's safe `.backup` operation rather than copying a live database. Back up the media directory at the same time. Consider Litestream if a daily backup window is too large.

PDF delivery is currently browser print output. Generic CSV positions are the printed bubble-section indices (starting at 1); written-response items never appear in that file. The product deliberately does not claim a real Scantron-format key export until a school confirms the exact grader product and import schema.

Read `DECISIONS.md` and `HUMAN_VALIDATION.md` before a real classroom rollout.
