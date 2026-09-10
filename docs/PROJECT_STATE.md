# Current project state

Last verified: 2026-09-11 (Europe/Moscow). Emergency recovery is in progress.

## Observed production

- Apps Script Production is immutable numbered **v55**, release `system-stabilization`. Official Google reader API comparison verified HEAD, deployment mapping, numbered source and the exact 23-file snapshot. Snapshot tree: `16a4d270960a649f1cae9f3170efb87ae73da6d1000a91e3ec37e23c4467040e`.
- The previous v54 production pointer was obsolete. This checkpoint records v55 and updates the MiniApp expected identity. It does not publish an Apps Script candidate or claim completion of emergency recovery.
- Owner-context read-only live gate: **22/23** at `2026-09-10T21:58:43.751Z`, reconciliation **0**. Morning freshness is the only failing gate. Five owner-bound triggers remain configured in Europe/Moscow.
- The September 10 morning execution failed at 08:10:57 because release maintenance paused mutations. Its initial health write used the guarded business lock, so the error was not recorded in scheduled health. This is a real missed run, not proof of an incorrectly classified successful digest.
- Do not invoke triggers manually to manufacture recovery evidence. The next natural morning window is September 11, 08:00–09:15 Moscow.
- Latest inspected durable operations: no pending, stale or manual-review operations; historical failed validations retained. Script Properties usage was 5,606 bytes; Document Properties and legacy confirmation counts were zero.

## Recovery work pending

- Confirm-day rejects the Base64URL revision produced by its own bootstrap; the old whole-day precondition also conflates unrelated changes with selected training intent. Per-training semantic acceptance is under isolated testing.
- Explicit Telegram row and day callbacks require transport integration with the existing immutable operation lifecycle, without redundant confirmation UI.
- Confirmed ledger inconsistencies and a next-block advance are being corrected through an approved private recovery plan. Personal and financial details stay outside Git. None of those corrections is claimed applied by this checkpoint.
- A fresh owner-only backup and independent restore comparison covered all 16 sheets. Private evidence, credentials, operational URLs and identifiers remain outside Git. Refresh this evidence before staging or data recovery writes.

## Release discipline

- `main` requires a current PR and green `release-gate`. Merging triggers the normal Vercel deployment; do not manually redeploy the same commit.
- Numbered snapshots are immutable. A changed candidate needs a distinct readiness marker, exact read-back and a completed old-execution drain. Recording an observed degraded gate does not establish successful release acceptance, which still requires the complete live gate.
- Preserve P1 authentication, immutable payload, actor binding, nonce/TTL, ScriptLock, durable results, replay protection, financial formulas and fail-closed recovery. Preserve prior September 10 business recovery effects.
- No new product features, invented business facts, synthetic production smoke mutations, measurements without explicit admin action, or unconfirmed hybrid start. Prices and access rules remain unchanged.
