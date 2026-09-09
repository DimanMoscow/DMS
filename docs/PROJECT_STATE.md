# Current project state

Last verified: 2026-09-09 (Europe/Moscow).

## Current release checkpoint

- Apps Script Production is numbered `v52`. Official Google API read-back matched
  all 21 snapshot files, the production deployment mapping, and runtime identity
  `p1-scheduled-automation-health`.
- The current Vercel build still pins its proxy verifier to v51, so its public
  Apps Script runtime probe fails closed with `runtime_identity_mismatch`. The v53
  implementation PR first records the verified v52 pointer so the automatic `main`
  deployment restores a connected, exact runtime check before Apps Script v53 is staged.
- The owner-visible installable trigger inventory contains exactly five clock
  triggers: backup daily at 03:00, morning Telegram daily at 08:00, evening
  Telegram daily at 22:00, Calendar sync hourly, and watchdog every two hours.
  The project, spreadsheet, manifest, and daily trigger schedules use
  `Europe/Moscow`. Both morning and evening notification settings are enabled.
- Natural executions on 2026-09-09 completed for backup, morning Telegram,
  Calendar sync, and watchdog; the most recent evening execution also completed.
  No trigger is missing or reporting an execution error. The verified natural
  backup was created in its 03:00 window.
- After the natural 19:21 Calendar sync, the owner-context read-only gate passed
  19/19 at `2026-09-09T16:25:44.841Z`; reconciliation reported zero issues.
  Scheduled configuration, settings, freshness, backup integrity, queue, financial,
  and security checks are green. No production mutation was used to force the gate.
- Candidate `v53` is a scoped stabilization release. It fixes the false pre-window
  stale model, records safe execution timing/outcomes, exposes compact operational
  health, and preserves the existing owner-bound triggers. It adds no product
  behavior and does not reinstall a healthy trigger set.

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

- The v53 repository suite passes 190/190 tests, including ten schedule-aware
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
