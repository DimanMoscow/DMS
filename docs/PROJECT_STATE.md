# Current project state

Last verified: 2026-09-09 (Europe/Moscow).

## Current release checkpoint

- Apps Script Production is immutable numbered v53. Independent official Google API
  read-back verified all 21 source files, production mapping and runtime identity
  scheduled-automation-stabilization at 2026-09-09T17:04:09Z.
- The live read-only gate passed 19/19 at 2026-09-09T17:48:37.888Z after natural
  Calendar ingestion; reconciliation was zero. All five original owner-bound
  triggers remain present and fresh in Europe/Moscow. No trigger was reinstalled.
- v53 is an intermediate stabilization release. Its independent watchdog can
  report a new Calendar event as drift before ingestion had a chance to process it.
  This is a release blocker for final stabilization, even though the current
  snapshot reconciles. Source correction is candidate v54; v53 cannot be reissued.
- Candidate v54 binds drift to matching revision evidence before and after a
  successful Calendar sync under the existing ScriptLock. One bounded durable
  generation records start/completion, result and at most 64 hashed issue keys.
  Independent watchdog observations are read-only and awaiting_sync until proven;
  sync failure/delay is reported as such. Working trigger schedules are unchanged.
- The MiniApp runtime pointer is advanced to the verified v53 baseline in this PR.
  The merge automatically deploys Vercel; after v54 rollout a separate verified
  production checkpoint will advance that pointer again. No manual Vercel deploy.
- v54 is not production-ready until full gates, fresh private recovery, source
  read-back, deployment identity and natural post-sync reconciliation are verified.

## Scheduled automation findings

- The 2026-09-07 missed backup, morning, evening, and Calendar runs were caused by
  the v51 release maintenance interlock remaining closed through their execution
  windows. Execution history disproved the original missing-trigger hypothesis.
- v52 restored the managed five-trigger inventory and natural execution evidence.
  Its health monitor still evaluated daily freshness by elapsed age alone, so a
  04:10 watchdog run could report the 08:00 morning job as stale and could report
  backup stale before the backup window closed.
- v53 evaluates each job against its own schedule. It reports
  `trigger_missing`, `trigger_misconfigured`, `not_due_yet`,
  `within_expected_window`, `delayed`, `last_run_failed`,
  `last_run_succeeded`, or `stale`. Daily jobs have a 75-minute expected window
  and are not stale until a further bounded delay threshold expires. Hourly jobs
  retain their recorded cadence and grace.
- Health records contain expected schedule, last start, last success, last safe
  error class, duration, current expected window, and next expected window. Raw
  error messages, trigger identifiers, PII, and business rows are excluded from
  administrator health output.
- The watchdog deduplicates an unchanged failed state for 12 hours. State or error
  class changes produce a new signature, and a later success clears the warning
  state. Backup age is deferred only while the scheduled backup is not due or
  inside its expected window; structural backup failures remain blocking.

## P1 security and data integrity

- P1.1 rejects malformed or oversized ingress before authentication and before any
  Sheets audit write; platform logs are fixed and redacted.
- P1.2/P1.4/P1.5 use immutable cf2 tickets and payloads in the append-only ledger,
  one project-wide ScriptLock, durable ticket to pending to started to result to
  committed transitions, positive-effect recovery, fail-closed manual review, and
  bounded legacy-property cleanup with read-back before deletion.
- P1.3 uses versioned domain compensations that preserve IDs and history and reject
  dependency or state drift before writing.
- P1.6 uses shared financial anchors for occupied IDs and complete Payments/Journal
  history. The independent numeric guard verifies displayed balances.
- `telegram-confirmations-v2` and `financial-formulas-v1` are applied. Production
  has 18 Clients, 16 Blocks, and 21 Payments at the migration checkpoint. The
  17-column append-only Telegram operation ledger remains active.
- The v51 rollout and migrations performed no payment, Calendar, measurement, or
  client-binding smoke mutation. The observed MiniApp flow continued to process
  its queue operation exactly once.

## Verification and recovery

- The v53 repository suite passed 190/190 tests, including ten schedule-aware
  regression and release-inventory tests. The full release gate remains required
  immediately before each merge or deployment.
- A final owner-only v51 recovery copy and separate restore copy matched all 16
  required sheets at `2026-09-07T20:50:01Z`. Private manifests, credentials,
  identifiers, operational URLs, and raw rows remain outside Git.
- The v53 release requires a new verified private recovery copy less than one hour
  old before Apps Script HEAD is staged. The reader and writer OAuth profile formats
  are validated separately; that format check is not authentication.

## Release and access controls

- GitHub `main` requires a current pull request and the `release-gate`, blocks force
  push and deletion, and permits zero required approvals for an explicitly
  authorized Codex merge. Merged head branches are deleted automatically.
- Vercel Preview has no production data. Merging `main` automatically creates the
  Production deployment; no duplicate manual deployment is part of this release.
- Google operations use separate reader and writer Desktop OAuth profiles with exact
  scopes. If Google requires a new interactive authorization, the release stops at
  that step.
- Production recovery uses private owner-only Drive copies. At least three copies are
  retained for at least 30 days; deletion requires separate approval.

## Constraints

- Preserve immutable numbered snapshots, migration evidence, private recovery
  evidence, and append-only operation history.
- Do not create measurements without an explicit authenticated administrator action.
- Do not create the pending Hybrid product without a separately confirmed Calendar
  start and explicit terms.
- Do not change prices, business rules, or client/admin access. P2 and broader
  Telegram/MiniApp/domain unification remain outside v53.
