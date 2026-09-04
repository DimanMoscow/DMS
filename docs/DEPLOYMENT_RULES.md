# Deployment rules

## MiniApp

1. Start from current `origin/main` and work in a scoped branch.
2. Run targeted tests while editing; run `npm run release:check` before a release candidate.
3. Review the complete PR diff and merge only with explicit approval.
4. The existing Vercel project is Git-linked to `DimanMoscow/DMS`. Pull requests create
   Preview deployments and merging `main` automatically creates a Production deployment.
   Approval to merge therefore includes that automatic deployment. Manual deployment,
   promotion, rollback, domain, and environment changes remain separate operations.
5. After an approved production change, verify deployment state, `/api/health`, Telegram
   launch, authorized reads, and only the specifically approved mutations.
6. Require `/api/health` to match the repository release and runtime fingerprint. When
   Vercel provides `VERCEL_GIT_COMMIT_SHA`, require the exact source revision too:

   ```bash
   DMS_EXPECTED_SOURCE=<main-sha> npm run release:verify -- https://production.example
   ```

   A missing source revision is reported as `unavailable`; never claim commit identity
   from the release label alone.

## Apps Script

- Git stores sanitized numbered snapshots. Apps Script HEAD and deployments remain live
  external state and must be checked before work.
- `clasp push`, Apps Script API `updateContent`, editor saves to HEAD, numbered-version
  creation, and deployment updates are write operations.
- Prepare and review changes in Git first. Verify the complete numbered file set with:

  ```bash
  npm run verify:apps-script
  ```

- Creating a numbered version does not publish it. Updating the production deployment is
  a separate explicitly approved operation.
- Never update the production deployment during diagnosis, export, or snapshot work.
- A deployment version label is not sufficient runtime evidence. For candidates that
  expose the non-sensitive runtime identity probe, query the active `/exec` URL with a
  unique `dms_runtime_identity=1` probe, verify the embedded router/module fingerprints,
  and require `clientPortalHandlerLoaded: true` before authenticated smoke. If metadata
  and the live marker disagree, stop the rollout and preserve the last known-good
  deployment.

- The Git-linked MiniApp exposes `/api/apps-script-runtime` as a fail-closed,
  allow-listed server-side verifier. It must return HTTP 200 with `no-store`, the
  expected release fingerprints, and `clientPortalHandlerLoaded: true`; it never
  exposes the configured backend URL.

  ```bash
  DMS_APPS_SCRIPT_URL=<active-web-app-url> npm run smoke:apps-script-runtime
  ```

- Before a runtime may emit a new Queue state, extend only the affected validation
  ranges and read them back. For `Требует регистрации`, matching and processing status
  columns must both accept the value.
- A Calendar sync rollout must run `previewDmsCalendarQueueSync` first. Its redacted
  write set must be understood before applying `syncCalendarToQueue`.
- The live gate must include `debt-formula-integrity`: `Клиенты!J5` is the sole canonical
  Debt `ARRAYFORMULA` anchor, its spill range contains no competing formulas, and no
  displayed spreadsheet errors are present.

## Production gate

The order is: targeted tests → `npm run release:check` → PR Preview → approved merge →
automatic Production deployment → `npm run release:verify` → optional local checkpoint.
`npm run release:check` runs MiniApp lint,
tests, TypeScript, build, and the Apps Script snapshot verifier. For day-confirmation
logic, validate the dry-run result before allowing any mutation. Production-data smoke
actions must be individually approved.

After a successful verification, a non-sensitive local rollback record can be captured:

```bash
DMS_EXPECTED_SOURCE=<main-sha> npm run release:verify -- https://production.example
DMS_VERCEL_DEPLOYMENT_ID=<deployment-id> DMS_APPS_SCRIPT_VERSION=v49 \
  npm run release:checkpoint -- https://production.example
```

Checkpoint files are written under ignored `.local-checkpoints/` by default and contain
only release identities and rollback references, never URLs, credentials, or row data.

GitHub Actions runs the same `npm run check` gate for pull requests and pushes to
`main`. It also runs `git diff --check` outside `apps-script/versions/**` and
`apps-script/candidates/**`; exact snapshots and full-source candidates are covered by
the verifier, recorded tree hashes, and expected changed-file sets instead. CI is
read-only and never deploys either runtime.

## Configuration and secrets

- Keep tokens, Script Properties, real Apps Script/MiniApp URLs, project IDs, calendar
  IDs, spreadsheet IDs, and client data outside Git unless a specific non-secret ID has
  been explicitly approved.
- MiniApp server configuration belongs in Vercel environment variables; never expose it
  through `NEXT_PUBLIC_*`.
- Apps Script runtime configuration belongs in Script Properties or another approved
  external configuration layer.
- Repository snapshots use documented placeholders. Never replace them with production
  values in a commit.

Current deviations from these rules are listed in `docs/PROJECT_STATE.md`; do not hide or
silently normalize them during unrelated work.
