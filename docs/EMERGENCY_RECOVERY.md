# Emergency recovery candidate

Status: production v56 verified with exact HEAD/Git/runtime comparison, approved
recovery committed/read back, natural scheduled health green and owner gate 23/23
at 2026-09-11T09:24:14Z. Telegram/MiniApp read flows are checked; mutation evidence
remains isolated. See PROJECT_STATE.md for remaining risks and the stop point.

## Proven regressions and fixes

| Failure | Proven cause | Released behavior |
| --- | --- | --- |
| MiniApp confirm-day rejects its own day | Bootstrap emits 43-character Base64URL; confirmation expected 64-character hexadecimal | Validate the actual wire format; immutable per-row semantic preconditions govern execution |
| Unrelated background change invalidates all selected rows | Whole workbook/day mutable snapshot mixed entity state with labels, technical timestamps and unrelated rows | Bind Queue identity, ownership, decision/status, time and entitlement inputs; changed rows remain pending while unchanged accepted rows complete |
| New Queue row invalidates earlier selections | Whole-day set equality | New rows remain an explicit pending delta and are never silently included |
| Telegram adds another confirmation screen | Legacy callback upgrade creates a visible cf2 prompt | Random render-bound button capability accepts the first click into the same immutable cf2 lifecycle; no editable row/action in callback |
| Morning appears stale | September 10 08:10:57 execution failed during maintenance before start/error telemetry could persist | Narrow owner-bound telemetry can record maintenance failure under the shared ScriptLock; business writes remain paused; no manual trigger replay |
| Missing Block 5 unit price | Block creation wrote total but omitted unit price | Validate and write total and unit together; preserve individually agreed historical hybrid/bonus terms |
| Conducted singles lack payment rows | Queue journal accounting never invoked the single settlement owner | New conducted singles settle once, honoring existing full credit; partial credit and incomplete prior outcomes require review |
| Long contention and ambiguous UI failures | Day/row rendering and network delivery ran inside the mutation transaction | Persist result/commit first, release the lock, then refresh Telegram/MiniApp views |

## Security and operation ownership

- Telegram `qv` resolves an immutable cached view and random button capability,
  validates admin/chat/message/expiry and creates cf2 acceptance. cf2 retains
  payload hash, nonce/TTL, immutable ledger events, ScriptLock, idempotency,
  semantic state checks and durable results. Legacy raw day/row buttons fail
  closed and ask to reopen the current day.
- Telegram and MiniApp call `setTelegramQueueDecision_` and
  `executeDmsDayConfirmation_`. Neither transport owns independent accounting.
  Day execution selects only accepted unchanged rows before preflight and mutation.
- Calendar time, cancellation and ownership changes exclude only their affected
  rows. Conditional Calendar writes retain `If-Match`; an uncertain external
  outcome is not silently replayed.
- Domain mutation, durable result and presentation are separate phases. A failed
  Telegram delivery cannot turn committed accounting into a second mutation.
- Dedicated final preview buttons for gift, pause/resume/close, undo,
  archive/restore and payment void already represent final explicit intent.
  Their existing preview is retained; setting-toggle and backup confirmation
  are not indiscriminately removed. Moving still requests a new time.

## Financial recovery

The approved private plan adds only confirmed missing payments, fills an empty
unit price and assigns an existing advance to a planned next block. It preserves
existing payment amounts/dates and prior recovery effects. The unknown exact
date of one historical aggregate supplement is explicitly documented privately.
There is no invented payment date or duplicate recording of the advance.

`previewDmsEmergencyRecovery` is owner/document-only and pins the exact private
plan hash without business writes. `applyDmsEmergencyRecovery` requires that hash,
the shared ScriptLock, paused writers, a completed drain, fresh verified restore
evidence, identity/entitlement guards and an unchanged Calendar start. It cannot
overwrite formula ownership. Durable bounded recovery intent allows continuation
only for ranges proven exactly untouched or exactly equal to the accepted result.
Unknown partial states fail closed. One audit record and the private plan retain
the explanation. Neither function is exposed through a client or Telegram route.

## Evidence and remaining acceptance

- Isolated service-boundary tests cover ten selected rows, technical metadata,
  Q11 delta, Q5 conflict, row/day replay, expiration, forgery, concurrent attempts,
  process death and Telegram delivery failure after commit.
- Business tests cover missing price, single auto-payment, existing credit,
  payment write interruption, exhaustion, payment attribution and semantic
  reconciliation. Existing P1, measurement and binding regression suites remain.
- Production-volume and 10x fixtures complete the selected ten with 27 storage
  read calls in either case. Semantic precondition read volume is 2,425 vs 5,404
  cells at 1x, and 24,250 vs 52,060 at 10x. These are fixture storage counts, not
  claims about production wall-clock latency.
- Private captured-data recovery rehearsal resolves four semantic findings to
  zero; repeat application makes zero additional business writes.
- Fresh private backup/restore (16 sheets), owner preflight/correction/read-back,
  exact numbered v56 and runtime match are complete. Ten patches committed once;
  five added payments, prior payments retained, semantic findings zero.
- Automatic Vercel pointer deployment passed, all four routes returned 200, and
  Telegram Today/Yesterday plus signed MiniApp Today/client reads were checked.
  Independent read-back after UI smoke proved unchanged business data.
- Natural Calendar sync at 12:21 Moscow completed with post-sync findings zero;
  full owner gate is 23/23. No scheduled job was invoked manually for freshness.
  One slow watchdog health phase remains an explicitly unproved latency risk.
