# DMS Fitness handoff

Last audited: 2026-09-09 (Europe/Moscow).

Use `origin/main`, `AGENTS.md`, current `docs/*`, and live service state. Old
conversations and non-main branches are not authoritative.

## Checkpoint

- Resolve the exact `origin/main` SHA at session start.
- Apps Script Production is numbered `v52`; official API read-back verified the
  21-file source, deployment mapping, and runtime identity. Do not infer production
  state from a version label alone.
- Vercel currently fails its Apps Script proxy probe closed with
  `runtime_identity_mismatch` because the deployed MiniApp still expects v51. Merge
  the reviewed v52 pointer update and verify the automatic Production deployment
  before staging Apps Script v53.
- Exactly five owner-visible clock triggers exist with zero reported error rate:
  backup at 03:00, morning Telegram at 08:00, evening Telegram at 22:00, Calendar
  hourly, and watchdog every two hours. Project and spreadsheet timezone is
  `Europe/Moscow`; morning/evening settings are enabled. Do not reinstall this
  healthy set without new evidence.
- Natural 2026-09-09 backup, morning, Calendar, and watchdog executions completed;
  the latest evening execution completed. The natural backup in the 03:00 window
  passed integrity checks.
- Candidate `v53` fixes v52's age-only freshness regression. At 04:10 the 08:00
  morning job is `not_due_yet`, and backup remains healthy until its expected window
  closes. Health also distinguishes missing/misconfigured trigger, execution window,
  delay, safe error class, success, and stale state, with last start/success/error,
  duration, and next window.
- The natural 19:21 Calendar sync resolved the transient gap. The owner-context gate
  passed 19/19 at `2026-09-09T16:25:44.841Z` and reconciliation reported zero issues.
  No production mutation, Telegram digest, or backup was used to force it green.
- The v53 code suite passes 190/190 tests. Run the full `release:check` after updating
  the verified v52 production pointer and before the implementation merge.
- Stage v53 only from a clean merged Git checkpoint and verified offline plan. Require
  exact reader/writer credential-profile formats, a fresh private owner-only recovery,
  exact HEAD read-back, a seven-minute execution drain, fresh original-context
  inventory, numbered v53 read-back, deployment mapping, activation, runtime identity,
  live read-only gate, and reconciliation.
- Preserve the v51/v52 evidence, migration ledger, confirmation ledger, and private
  recovery manifests. No payment, Calendar, measurement, or binding smoke mutation is
  authorized for this stabilization.

## Constraints

- Do not create the pending Hybrid product before a separately confirmed Calendar start.
- Create measurements only through an explicit authenticated administrator action.
- Do not change prices, business rules, or access boundaries.
- Stop if Google presents a new interactive authorization prompt. Otherwise finish the
  v53 stabilization and record the exact final `main` SHA, then start no new milestone.

Release procedure is in `docs/RELEASE_OPERATIONS.md`; recovery is in
`docs/DISASTER_RECOVERY.md`.
