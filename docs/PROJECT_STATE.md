# Current project state

Last verified: 2026-08-30 (UTC).

## Confirmed state

- GitHub source of truth: `main` at baseline
  `b433de7070b6fd42c781522df8f70b3854b4fc33`.
- MiniApp production: release `0.2.1`; Vercel deployment
  `dpl_9Vu1JfHte7C1Kc5j3MHVHxV5GECq` is `READY`, and `/api/health` reports
  `dataMode: connected`.
- Apps Script production deployment points to numbered version `v38`.
- Numbered version `v39` is saved but not published. Its only source change from `v38`
  is the dry-run preflight in `ZZZZZZZZZZMiniAppAdmin.gs` before day-confirmation
  mutations.
- Repository snapshots contain 15 files per version and pass
  `node apps-script/scripts/verify-snapshots.mjs`.

## Open risk and next step

Production `v38` can begin day-confirmation work before all future-training blockers
are known. Candidate `v39` adds a complete dry-run first, but it still requires a safe
validation against non-production-impacting cases. If that passes, publishing `v39`
and running the final gate/smoke are separate approved operations.

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
