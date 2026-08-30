# Current project state

Last verified: 2026-08-30 (UTC).

## Confirmed state

- The release source was merged into `main` at
  `3fc83fb438d3cb1e01eb6eacc17656fa7d3260f1`; current `origin/main` remains the
  repository source of truth.
- MiniApp production: release `0.2.1`; Vercel deployment
  `dpl_9Vu1JfHte7C1Kc5j3MHVHxV5GECq` is `READY`, and `/api/health` reports
  `dataMode: connected`.
- Apps Script production deployment points to numbered version `v40`.
- Numbered version `v39` is retained as a historical saved version and is not deployed.
- `apps-script/candidates/v40` is the sanitized 15-file repository source matching the
  deployed `v40` after the two documented operational URL substitutions.
- The `v40` day-confirmation safety fix passed the zero-write blocked-case test: the
  blocked logical state remains byte-identical and no writer is invoked. Targeted tests,
  the repository verifier, the full local gate, the live read-only Apps Script gate, and
  the post-deployment smoke all passed.
- Repository Apps Script source sets contain 15 files each and pass
  `node apps-script/scripts/verify-snapshots.mjs`.

## Open risk and next step

The day-confirmation zero-write risk is closed in production `v40`. Before broader
feature development, normalize the deployed `v40` repository copy as a numbered
snapshot and remove the MiniApp's hard-coded Apps Script fallback URL in separate,
reviewed changes.

## Known limitations

- The Vercel project currently reports no Git integration. A GitHub merge must not be
  assumed to deploy anything.
- `package.json` is `0.2.0`; the deployed release marker is maintained separately as
  `0.2.1` in `/api/health`.
- `lib/dms-server-config.ts` contains a hard-coded production Apps Script fallback URL.
  It should be removed in a separate code change so configuration is environment-only.
- Apps Script snapshots are sanitized repository copies, not the live runtime. Their two
  production URLs are placeholders and must be supplied outside Git.
- The production-matching `v40` source still resides under `apps-script/candidates/v40`
  rather than `apps-script/versions/v40`; the directory name alone must not be used to
  infer deployment status.
- Exact unsanitized API exports are intentionally local-only. Their SHA-256 controls are
  recorded in `apps-script/verification.json` and `apps-script/README.md`.
- No `.clasp.json` or repository-to-Apps-Script write workflow is configured.
