# Current project state

Last verified: 2026-09-09 (Europe/Moscow).

## Current release checkpoint

- Apps Script Production is immutable numbered v54. Official Google API read-back
  matched all 21 candidate files, the deployment mapping, and runtime identity
  `calendar-ingestion-stabilization`.
- The final owner-context read-only gate passed 19/19 at `2026-09-09T21:12:57.203Z` after
  the natural post-activation Calendar sync at `2026-09-09T20:21:19.759Z`; reconciliation
  was zero. No manual Calendar repair or business mutation was used.
- A live mismatch observed before that sync was classified as `awaiting_sync` with
  one pending issue and zero drift. The watchdog performed no repair and emitted no
  reconciliation alarm.
- The MiniApp production pointer in this checkpoint expects v54. Merging this
  checkpoint uses the normal Git integration to deploy Vercel; no manual Vercel
  deployment is part of the release.

## Calendar ingestion and watchdog model

- v53's watchdog treated a mismatch observed after an earlier successful sync as
  actionable even when the affected Calendar revision appeared only after that sync.
  Trigger timing therefore created a false drift report during normal pending ingestion.
- v54 makes Calendar sync the ingestion owner. Under the shared ScriptLock it records
  a bounded generation with start/completion, safe result metadata, and at most 64
  hashed issue revisions, then publishes post-sync reconciliation evidence.
- Watchdog reconciliation is read-only. A mismatch without evidence that the same
  revision survived a completed sync is `awaiting_sync`; it becomes
  `drift_after_successful_sync` only after matching pre/post generation evidence.
  A missed or failed sync is reported as `sync_delayed` or `sync_failed`.
- Correctness depends on causal generation evidence rather than the relative minute
  chosen by independent time triggers, so Apps Script trigger jitter cannot promote
  pending ingestion to drift.

## Scheduled automation health

- Exactly five owner-bound installable clock triggers remain configured in
  `Europe/Moscow`: backup, morning Telegram, evening Telegram, Calendar sync, and
  watchdog. No healthy trigger was reinstalled.
- Morning completed naturally at 08:10:54 (12.854 s). Evening completed naturally at
  22:52:23 (`22.109 s`). Backup completed naturally inside the
  03:00 window and its integrity check is green. Calendar completed naturally at
  `2026-09-09T20:21:19.759Z` (`7.852 s`).
- The release drain intentionally blocked watchdog at 22:10 and Calendar sync at
  22:21. Both failures were the maintenance interlock working as designed; activation
  completed at 22:22. The subsequent natural jobs provide recovery evidence.
- Daily freshness is schedule-aware: morning cannot be stale before its 08:00 window,
  and backup cannot be stale before its execution window and grace close. Health keeps
  expected schedule, last start, last success, safe last error class, duration, and
  next expected window. Unchanged warnings are deduplicated without hiding a new error
  class.

## Verification and recovery

- The repository release suite passes 212/212 tests, including 12 fake-clock causal
  reconciliation tests and 10 scheduled freshness tests. Dependency audit reports
  zero vulnerabilities; lint, typecheck, production build, snapshots, and migration
  gates pass.
- Numbered v54 and candidate v54 have identical 21-file repository snapshots. Runtime
  router, client portal, and Telegram confirmation fingerprints match production.
- A fresh owner-only Drive recovery copy and separate restore verification covered all
  16 required sheets before staging. Its manifest, credentials, identifiers,
  operational URLs, and raw business data remain outside Git.
- The v54 publication diff was scanned before push for secrets, credentials, Telegram
  IDs, PII, and private operational identifiers; no prohibited value was found.

## P1 security and data integrity

- The v51 confirmation ledger, shared mutation lock, compensation-based undo, financial
  anchors, migration evidence, and fail-closed release interlock remain active.
- Telegram, MiniApp, and scheduled entry points retain the shared domain-operation
  boundary. v54 adds no product feature and performs no payment, measurement, client
  binding, or artificial Calendar mutation for smoke verification.

## Release and access controls

- GitHub `main` requires a current pull request and green `release-gate`; merges trigger
  the only Vercel Production deployment for that commit.
- Google release operations use separate reader and writer authorization profiles with
  exact scopes. Production recovery evidence is owner-only and retained under the
  existing recovery policy.

## Constraints and remaining risks

- The current operational risk is an Apps Script scheduled execution overlapping a
  future release drain. Such a run fails closed and is visible as maintenance; release
  timing should continue to leave room for a later natural recovery execution.
- Durable Calendar evidence is deliberately bounded to 64 hashed revisions. Overflow
  fails closed as actionable rather than silently discarding drift.
- Preserve immutable snapshots and ledgers. Do not change prices, business rules,
  access boundaries, or begin P2 without a separate milestone.