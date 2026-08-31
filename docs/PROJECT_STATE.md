# Current project state

Last verified: 2026-08-31 (UTC).

## Confirmed state

- MiniApp production was built from `main` commit
  `da00ae4ac305a4ba32d97ec64884f261bf655225`; current `origin/main` remains the
  repository source of truth.
- MiniApp production: release `0.2.1`; Vercel deployment
  `dpl_8NubMiAyXj56VYbuZ8KTophfFhTX` is `READY`, and `/api/health` reports HTTP
  200 with `dataMode: connected`.
- Vercel Production has the required server-only `DMS_APPS_SCRIPT_URL`; its value is
  kept outside Git and was not changed during the release smoke.
- Apps Script production deployment points to numbered version `v40`.
- Numbered version `v39` is retained as a historical saved version and is not deployed.
- `apps-script/versions/v40` is the sanitized 15-file snapshot matching deployed `v40`
  after the two documented operational URL substitutions. The reviewed
  `apps-script/candidates/v40` source is retained byte-identically.
- The `v40` day-confirmation safety fix passed the zero-write blocked-case test: the
  blocked logical state remains byte-identical and no writer is invoked. Targeted tests,
  the repository verifier, the full local gate, the live read-only Apps Script gate, and
  the post-deployment smoke all passed.
- Repository Apps Script source sets contain 15 files each and pass
  `npm run verify:apps-script`.
- The repository release gate is `npm run check`; GitHub Actions runs it for pull
  requests and pushes to `main` without deploying either runtime.
- The post-deployment Telegram read-only smoke passed: bootstrap, client detail, report,
  and system health loaded; the Apps Script health gate passed 15 of 15 checks. No
  mutation action was called and no unexpected production-data change was observed.
- `apps-script/candidates/v41` is an undeployed repository candidate for the read-only
  client portal. It does not change Apps Script HEAD, numbered versions, deployment, or
  production Sheets.

## Open risk and next step

The day-confirmation zero-write risk is closed in production `v40`, and the explicit
server-only MiniApp backend configuration is deployed. The client portal implementation
is repository-only; its next gate is the separately approved production schema/bootstrap,
Apps Script release, MiniApp deployment, and read-only isolation smoke.

## Known limitations

- The Vercel project currently reports no Git integration. A GitHub merge must not be
  assumed to deploy anything.
- `package.json` is `0.2.0`; the deployed release marker is maintained separately as
  `0.2.1` in `/api/health`.
- Git changes do not affect MiniApp production until an explicit Vercel deployment is
  approved and completed.
- Apps Script snapshots are sanitized repository copies, not the live runtime. Their two
  production URLs are placeholders and must be supplied outside Git.
- Exact unsanitized API exports are intentionally local-only. Their SHA-256 controls are
  recorded in `apps-script/verification.json` and `apps-script/README.md`.
- No `.clasp.json` or repository-to-Apps-Script write workflow is configured.
- Production does not yet contain the client-access and measurement sheets required by
  candidate `v41`; no real Telegram-to-client bindings are stored in Git.
