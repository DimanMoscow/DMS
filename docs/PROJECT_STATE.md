# Current project state

Last verified: 2026-08-30 (UTC).

## Confirmed state

- GitHub source of truth before this change: `main` at
  `a266f3ee51415de7990d7b02dd470b4f0717d3ca`.
- MiniApp production: release `0.2.1`; Vercel deployment
  `dpl_9Vu1JfHte7C1Kc5j3MHVHxV5GECq` is `READY`, and `/api/health` reports
  `dataMode: connected`.
- Apps Script production deployment points to numbered version `v38`.
- Numbered version `v39` is saved but not published. It failed the safety gate because
  `confirmDmsMiniAppDay_()` calls the write-capable `syncCalendarToQueue()` before its
  dry-run.
- `apps-script/candidates/v40` is a Git-only 15-file candidate derived from `v39`.
  It plans Calendar→Queue changes read-only, preflights the projected Queue, and applies
  the frozen plan only when the day is ready. It is not yet Apps Script HEAD or a
  numbered version.
- Repository snapshots contain 15 files per version and pass
  `node apps-script/scripts/verify-snapshots.mjs`.

## Open risk and next step

Production `v38` and saved `v39` do not provide a zero-write blocked path. After the
`v40` candidate is reviewed and merged, updating Apps Script HEAD, creating numbered
`v40`, verifying the exported content, updating the production deployment, and running
the production smoke are separate approved operations.

## Known limitations

- The Vercel project currently reports no Git integration. A GitHub merge must not be
  assumed to deploy anything.
- `package.json` is `0.2.0`; the deployed release marker is maintained separately as
  `0.2.1` in `/api/health`.
- `lib/dms-server-config.ts` contains a hard-coded production Apps Script fallback URL.
  It should be removed in a separate code change so configuration is environment-only.
- Apps Script snapshots are sanitized repository copies, not the live runtime. Their two
  production URLs are placeholders and must be supplied outside Git.
- Exact unsanitized API exports are intentionally local-only. Their SHA-256 controls are
  recorded in `apps-script/verification.json` and `apps-script/README.md`.
- No `.clasp.json` or repository-to-Apps-Script write workflow is configured.
