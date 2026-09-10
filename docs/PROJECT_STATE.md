# Current project state

Last verified: 2026-09-11 (Europe/Moscow). Emergency recovery is in progress.

## Observed production

- Apps Script Production is immutable numbered **v55**, release `system-stabilization`. Official Google reader API comparison verified HEAD, deployment mapping, numbered source and the exact 23-file snapshot. Snapshot tree: `16a4d270960a649f1cae9f3170efb87ae73da6d1000a91e3ec37e23c4467040e`.
- The previous v54 production pointer was obsolete. This checkpoint records v55 and updates the MiniApp expected identity. It does not publish an Apps Script candidate or claim completion of emergency recovery.
- Owner-context read-only live gate: **22/23** at `2026-09-10T21:58:43.751Z`, reconciliation **0**. Morning freshness is the only failing gate. Five owner-bound triggers remain configured in Europe/Moscow.
- The September 10 morning execution failed at 08:10:57 because release maintenance paused mutations. Its initial health write used the guarded business lock, so the error was not recorded in scheduled health. This is a real missed run, not proof of an incorrectly classified successful digest.
- Do not invoke triggers manually to manufacture recovery evidence. The next natural morning window is September 11, 08:00–09:15 Moscow.
- Latest inspected durable operations: no pending, stale or manual-review operations; historical failed validations retained. Script Properties usage was 5,606 bytes; Document Properties and legacy confirmation counts were zero.

## Recovery release checkpoint

- Recovery PR #76 was squash-merged as `77a176763756519e978d71b65b883f50c0ac119a`; its 312-test full repository gate and the new main release-gate passed. Candidate `stabilization` contains the reviewed semantic/one-click fixes and owner recovery tooling. These fixes are not yet deployed.
- The minimized private approved plan was uploaded and read back exactly in the owner's Google Drive; permissions were verified owner-only, with no public or third-party access. Fresh private backup and isolated restore verified all 16 sheets at `2026-09-10T23:33:47.991Z`. No plan payload or private identifiers are stored in Git.
- Candidate HEAD was staged/read back, but Google required owner OAuth approval before the drain function could execute. The waiting execution was cancelled. HEAD was restored exactly to numbered v55 at `2026-09-10T23:43:28.193Z`; deployment remained v55. No recovery patches, new version or deployment update occurred.
- Owner inspection at `2026-09-10T23:45:17.812Z` proved `mutationReady: true`, original document context, available locks and all five correctly configured owner triggers. The drain timestamp remained the earlier September 10 value. Natural Calendar sync and watchdog successes were fresh; morning remained stale. Do not leave candidate HEAD staged while waiting for OAuth approval.
- Read-only Vercel smoke passed on production source `2882f526622e348be7e785572423f807c8c44bd7`, release 0.2.7, connected mode and v55 runtime. This observed production source differs from the recovery merge SHA; do not claim the new main has been deployed. Resolve the Git integration status during resumed release verification without a duplicate manual deployment.
- Resume after owner OAuth approval: refresh backup/restore and the private plan's evidence; update only that verified owner-only Drive file, re-run fixture proof, stage exact merged source, drain, owner preview/apply/read-back, publish numbered version, record exact snapshot/runtime pointer, activate, and verify the next natural scheduled executions. Never reuse the expired plan or stale staged/inventory reports.

## Recovery acceptance pending

- Confirm-day rejects the Base64URL revision produced by its own bootstrap; the old whole-day precondition also conflates unrelated changes with selected training intent. Per-training semantic acceptance is implemented and passed isolated tests in PR #76; production acceptance remains pending.
- Explicit Telegram row and day callback integration with the existing immutable lifecycle passed isolated tests in PR #76; production rollout remains pending.
- Confirmed ledger inconsistencies and a next-block advance are being corrected through an approved private recovery plan. Personal and financial details stay outside Git. None of those corrections is claimed applied by this checkpoint.
- A fresh owner-only backup and independent restore comparison covered all 16 sheets. Private evidence, credentials, operational URLs and identifiers remain outside Git. Refresh this evidence before staging or data recovery writes.

## Release discipline

- `main` requires a current PR and green `release-gate`. Merging triggers the normal Vercel deployment; do not manually redeploy the same commit.
- Numbered snapshots are immutable. A changed candidate needs a distinct readiness marker, exact read-back and a completed old-execution drain. Recording an observed degraded gate does not establish successful release acceptance, which still requires the complete live gate.
- Preserve P1 authentication, immutable payload, actor binding, nonce/TTL, ScriptLock, durable results, replay protection, financial formulas and fail-closed recovery. Preserve prior September 10 business recovery effects.
- No new product features, invented business facts, synthetic production smoke mutations, measurements without explicit admin action, or unconfirmed hybrid start. Prices and access rules remain unchanged.
