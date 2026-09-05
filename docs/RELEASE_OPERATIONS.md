# Release operations

## Verified GitHub and Vercel flow

- Vercel project: `fitness-miniapp`, linked to `DimanMoscow/DMS`.
- Production branch: `main`. A merge to `main` creates a Production deployment without
  a separate promotion step.
- Pull requests create Preview deployments. The audited PR Preview reported its exact
  head SHA with `dataMode: not-configured`; `/api/apps-script-runtime` failed closed with
  `backend_not_configured`. Production backend configuration is therefore absent from
  Preview, which prevents Preview from writing production data.
- Production aliases are `fitness-miniapp-henna.vercel.app`,
  `fitness-miniapp-dimanmoscows-projects.vercel.app`, and the Git-main alias.
- The required server-only backend environment remained available through a
  documentation-only rebuild: health stayed `connected` and the Apps Script identity
  probe passed. Environment values were neither read nor changed during the audit.
- A documentation-only merge currently rebuilds Production. Keep this simple behavior:
  an ignore-build rule would save one build but would also make the deployed source SHA
  intentionally lag behind `main`, weakening the release identity check.

The safe Vercel rollback path is the previous known-good Production deployment in the
Vercel dashboard. A rollback is explicit production authorization. Prefer a corrective
PR and forward deployment when time permits; use rollback only when the serving build is
unhealthy. Never change aliases or environment variables as part of routine rollback.

## Required gates

Before merge:

1. Branch from current `origin/main` and keep one scope per PR.
2. Run targeted tests during development.
3. Run `npm run release:check` once before merge. It covers the high-severity dependency
   audit, lint, repository tests, TypeScript, production build, Apps Script snapshot
   integrity, production pointer, and migration ledger.
4. Require GitHub `release-gate` success and a READY Vercel Preview whose source matches
   the PR head. Preview health must stay `not-configured` unless a separate test backend
   is explicitly introduced.
5. Review the full diff. Production data writes are never part of PR verification.

After the approved merge:

1. Wait for GitHub `release-gate` and the automatic Vercel Production deployment.
2. Run `DMS_EXPECTED_SOURCE=<main-sha> npm run release:verify -- <production-url>`.
3. Require the MiniApp release, fingerprint, source SHA, connected backend, public routes,
   fail-closed proxy probes, and exact Apps Script runtime identity to pass.
4. For an Apps Script release, also run its authenticated read-only live gate and require
   zero reconciliation issues. Do not add production mutations to the generic verifier.
5. Record the Git SHA, Vercel deployment, Apps Script numbered version, schema version,
   and rollback references with `npm run release:checkpoint`. Keep the generated file
   local or in an approved private operations store.

The checkpoint command is strict: `DMS_VERCEL_DEPLOYMENT_ID`,
`DMS_APPS_SCRIPT_VERSION`, `DMS_APPS_SCRIPT_DEPLOYMENT_ID`, and `DMS_SCHEMA_VERSION`
must all be present. It computes the migration-ledger digest itself and refuses a
checkpoint that cannot identify both rollback references. Environment values alone do
not attest the Apps Script deployment-to-version mapping, so the local record remains
`remoteStateVerified:false` and `rollbackReady:false` until an authenticated API read
proves that mapping.

## Repository protection

The 2026-09-06 post-release audit found no open pull requests or active Dependabot
heads. Retain `main`, `backup/admin-today-pre-20260826`,
`archive/legacy-vps-bot-2026-08-24`, `recovery/apps-script-v38-v39`, and
`recovery/vercel-production-0.2.1`. All other heads are merged cleanup candidates,
including the Telegram security-release and final-checkpoint heads. The earlier count
of 36 merged heads included the two `recovery/*` pointers, which must not be deleted;
three Dependabot heads disappeared after their approved merges. Recount and recheck all
candidates through an authenticated admin path immediately before deletion, then enable
automatic head-branch deletion after merge.

The minimum policy for a solo owner plus Codex is:

- require a pull request before merging;
- require the `release-gate` check and require the branch to be current before merge;
- block force pushes and branch deletion;
- allow zero required human approvals so an explicitly authorized Codex merge is not
  blocked;
- allow repository administrators to recover from a broken rule, while treating bypass
  as an incident that must be documented.

Do not require duplicate CI workflows or CODEOWNERS approval for a one-owner repository.
Repository rules must be tested with a disposable PR before relying on them.

## Apps Script target flow

Git remains the source of truth. Numbered snapshots under `apps-script/versions/` are
immutable and candidates under `apps-script/candidates/` are review inputs. The target
release sequence is:

1. Candidate in Git → snapshot verifier → reviewed PR.
2. Authenticated local preflight reads Apps Script HEAD and compares the complete file
   set with the candidate after applying only documented private substitutions.
3. `projects.updateContent` updates HEAD; immediate `projects.getContent` read-back must
   match byte-for-byte.
4. `projects.versions.create` creates one numbered version; export it and compare again.
5. `projects.deployments.update` moves only the approved deployment.
6. Verify the runtime fingerprint, run the authenticated read-only live gate, require
   zero reconciliation issues, then store the sanitized numbered snapshot and checkpoint.

The local machine currently has Node and npm, but no `clasp`, `.clasp.json`, clasp user
credential file, gcloud CLI, or gcloud credential directory. Therefore no unattended
Apps Script write flow is enabled yet. The recommended next setup is official `clasp`
plus two local user OAuth profiles: a read-only audit profile and a separately selected
writer profile. Use a personal Google Cloud Desktop OAuth client and an OS-protected
credential store where available. Do not use OAuth Playground, and do not leave a
personal-use consent screen in Testing if a durable refresh token is required. `clasp`
token files are sensitive local plaintext and must remain ignored. Do not commit
`.clasp.json`, token files, OAuth client files, script IDs, deployment IDs, or URLs.
Service-account use is deferred until the project ownership model proves it is supported
for this script; it is not assumed.

`apps-script/production.json` is the non-sensitive machine-readable pointer to the
confirmed candidate, numbered snapshot, runtime identity, live gate, and reconciliation
result. Before authentication, create a deterministic plan with
`npm run release:apps-script:plan -- --candidate v49 --baseline v49`; verify the emitted
ignored artifact with the same command and `--verify <plan-path>`. It records only file
digests and always remains `OFFLINE_READY`, `authenticated:false`,
`remoteStateVerified:false`, and `deployable:false`.

The credential-profile format check is
`npm run release:apps-script:credential-check -- --mode reader|writer`. It accepts only an
absolute credential-profile path outside the repository through
`DMS_APPS_SCRIPT_AUTH_FILE`, never prints credential fields, and requires the exact scope
set for the selected profile. It always reports `authenticated:false`; a token refresh
and read-only Apps Script API call are still required to prove authentication. The reader
scopes are `script.projects.readonly`, `script.deployments.readonly`,
`drive.metadata.readonly`, and `spreadsheets.readonly`. The writer scopes are
`script.projects`, `script.deployments`, `drive`, and `spreadsheets`. The Drive writer
scope is required because the release tool copies an existing production workbook by
ID; `drive.file` cannot discover or access that pre-existing file without a separate
Picker grant. A Google login and consent remain a user operation.

Official references:

- [clasp guide](https://developers.google.com/apps-script/guides/clasp)
- [Apps Script API concepts](https://developers.google.com/apps-script/api/concepts)
- [`projects.updateContent`](https://developers.google.com/apps-script/api/reference/rest/v1/projects/updateContent)
- [`projects.versions.create`](https://developers.google.com/apps-script/api/reference/rest/v1/projects.versions/create)
- [`projects.deployments.update`](https://developers.google.com/apps-script/api/reference/rest/v1/projects.deployments/update)
- [OAuth for desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app)

## Dependency security

The framework and matching ESLint configuration are pinned together. The current floor
is Next.js `16.3.4`, which includes the vendor fixes released in `16.3.3` and resolves
the audited Next.js, PostCSS, and Sharp findings. `npm audit --audit-level=high` runs in
the release gate, and Dependabot plus the scheduled weekly gate detect advisories that
arrive between code changes. Security upgrades stay scoped to the smallest compatible
patch or minor release; a major upgrade requires an architectural review.
`security/dependency-policy.json` also enforces the vendor security floors because a
registry audit can lag a newly published framework advisory.

## Lightweight test and staging strategy

Local tests and synthetic fixtures should prove most behavior without Telegram or
production data. They cover route allow-lists, selector rejection, role separation,
enrollment replay and expiry, document-lock behavior, measurement validation and
correction rules, Calendar onboarding plans, queue idempotency, schema preflights,
release identity, and snapshot integrity. Vercel Preview covers the built UI and public
read-only endpoints using preview configuration.

This is sufficient for roughly 80–90% of smoke and security evidence. Real Telegram is
still required for signature/launch behavior and per-chat menu integration. Real Google
services are required only for final read-only runtime identity, trigger, formula, and
reconciliation checks. If isolated write testing becomes frequent, create a separate
test Sheet, Apps Script deployment, and bot as one explicit external-resource project;
do not emulate safety by writing synthetic rows into production.

## Backup, rollback, and migrations

Before an approved release, record only non-sensitive metadata: Git SHA, Vercel
deployment, Apps Script version and deployment reference, active schema version, sheet
names/header hashes/row counts, and the last known-good rollback references. Production
Sheet contents and personal data stay in Google-managed backup/export storage, not Git.

The existing `createDmsAutomaticBackup` output is an operational in-workbook data
snapshot, not disaster recovery. It covers Clients, Blocks, Payments, Journal, and Queue,
but does not capture Calendar, portal access/invitations/measurements, audit/settings,
formulas, validations, formatting, or an independently tested restore path. Do not claim
recovery readiness from its freshness check alone. A future backup stage should add an
independent private destination, retention, checksums, schema/formula metadata, and a
tested read-back/restore runbook without placing personal data in Git. The implemented
contract is `apps-script/backup/contract.json`; validate a private Drive-copy manifest
with `npm run release:backup:verify -- <private-manifest.json>`. The recovery procedure
and retention rules are in `docs/DISASTER_RECOVERY.md`.

Every migration package must contain `schema.json`, `preflight.mjs`, `migration.json`,
and documentation. `migration.json` declares its affected sheets, schema version,
non-destructive status, separate approval for writes, preflight, post-check, and rollback.
`apps-script/migrations/ledger.json` records versioned artifact digests, dependency
order, evidence for the two confirmed applied migrations, and current per-sheet schema
versions. `npm run verify:migrations` checks manifests against schemas, detects artifact
drift and dependency errors, and verifies applied evidence. A production migration must be
idempotent, stop on schema mismatch, capture a private pre-release recovery export, read
back the exact result, and audit the execution. Destructive migrations require a
separate design and approval.

Before a future migration, run its package-specific read-only preflight and then
`npm run release:migration:readiness -- <migration-id> <private-manifest.json>`. The
readiness command verifies dependency order and binds the private backup to the current
ledger and production Apps Script version; it does not execute the package preflight.

## Admin diagnostics and checkpoints

The authenticated admin “Состояние системы” screen is read-only. It shows MiniApp
release/fingerprint/source, Apps Script release, the live self-test score, Queue waiting,
error and registration counts, exhausted-block and trigger counts, and the last check
time. It must never expose PII, Telegram IDs, tokens, medical values, or financial rows.
Bindings, invitation states, measurement count, schema version, and a direct
reconciliation summary should be added only when the Apps Script response can supply
aggregated values through the same authenticated allow-list.

After a major milestone is merged and verified, update current repository docs and start
the next major stage in a fresh Codex task when the active task has become large. Recover
state from current Git, `AGENTS.md`, relevant docs, and live services rather than chat
history.

## Known process risks

- Main branch protection and automatic stale-branch deletion still require repository
  administration access; audited merged heads remain pending authenticated cleanup and
  the minimum rule is documented above.
- Apps Script planning, source integrity, production identity, and credential-profile
  format checks are automated offline. Exact live export/read-back and writes remain blocked
  on separate local OAuth profiles. Production remains on confirmed numbered `v49`.
- A private owner-only Google Drive workbook copy and an isolated restore-test copy were
  verified on 2026-09-06 across the complete 15-sheet production workbook. The private
  manifest stays outside Git; retention still needs two additional fresh copies over the
  normal 30-day window before the minimum three-copy policy is satisfied.
- Historical production `v45` has no numbered source snapshot in Git. Do not invent one;
  restore it only from an exact Apps Script export if the numbered version remains
  available.
- Telegram confirmation callbacks need a dedicated security-hardening stage to bind
  confirmations to a nonce/message and make payment/calendar retries durably idempotent.
- Candidate `v50` implements that mechanism, but production remains on `v49` until
  authenticated backup, migration, exact source deployment, live gate, and reconciliation
  can run through the official Google flow.

## Telegram confirmation v50 rollout

1. Create and verify a private Drive copy of production `v49`, including the current
   complete 15-sheet backup contract, and complete an isolated restore test.
2. Run migration readiness and the private read-only preflight for
   `telegram-confirmations-v1`.
3. Create the empty `Журнал операций Telegram` sheet with the exact 13-column schema;
   read it back before any callback can write an event.
4. Update the backup contract after migration so future copies include the ledger.
5. Compare Apps Script HEAD with candidate `v50`, create one numbered version, and move
   only the approved production deployment.
6. Verify runtime identity, the read-only live gate, zero reconciliation issues, and an
   empty or structurally valid operation ledger. Do not exercise a payment, Calendar,
   Queue, client, block, or undo mutation as production smoke.
