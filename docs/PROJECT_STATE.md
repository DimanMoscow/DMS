# Current project state

Last verified: 2026-09-11, 11:34 Europe/Moscow. Recovery data and runtime are deployed; final scheduled acceptance is pending.

## Observed production

- Apps Script Production **v56**, release `emergency-semantic-recovery`, 25 files. Google assigned version 56. Official reader proves deployment mapping, numbered source, HEAD and the merged stabilization candidate are exact. Tree: `873ec728daf92883c31f67eed8857b092360a7fe1fbba3e3d30d316379470a7d`.
- Published at 08:28:24Z; activated at 08:31:06Z after the completed 420-second drain, exact recovery read-back and financial/configuration checks. Runtime router/portal/confirmation fingerprints match `apps-script/production.json`; both handlers are loaded.
- Owner read-only live gate **21/23** at 08:32:31Z. Raw reconciliation **0**, semantic financial findings **0**, queue errors **0**, duplicate accounting **0**, debt formula integrity passes. Pending/stale/manual-review durable operations **0/0/0**; nine historical validation failures are retained.
- Two gate failures have one proven cause: the natural Calendar sync at 11:21 Moscow occurred during recovery maintenance and recorded `release_maintenance`. Post-sync evidence is therefore not accepted yet. Do not run sync/watchdog manually. Await the next natural sync around 12:21 Moscow and then repeat the live gate.
- All five owner-bound triggers have correct configuration/timezone/settings. Today's natural backup and morning digest succeeded; evening is not due; watchdog's last success is 10:10 Moscow. Final scheduled freshness is not yet claimed.
- Current Vercel production was verified at source `4878c2e81b1194f77f200bdf7fd6cdf968de6256`, release 0.2.7, connected, before v56 publication. This PR aligns its expected runtime pointer with observed v56. Verify automatic production deployment and read-only Telegram/MiniApp flows after merge; do not manually deploy a duplicate.

## Recovery evidence

- Reviewed implementation PR #76 merged as `77a176763756519e978d71b65b883f50c0ac119a`, with 312 tests and full gate green. PR #77 recorded the prior OAuth checkpoint; neither PR was repeated.
- Owner completed official Google consent. The temporary authorization helper proved read access, was removed, and is absent from HEAD, numbered v56 and snapshots. Separate local reader/writer profiles remain outside Git; Work and OAuth Playground are unnecessary.
- Fresh owner-only backup and isolated restore matched all 16 sheets at 08:07:07Z. Private minimized recovery plan was updated/read back with owner-only permissions; no public or third-party access.
- Exact accepted plan committed 10 guarded patches at 08:22:31Z. Independent reader verified every patch, five added payments, all 27 prior payments retained, one audit record and zero semantic findings. Existing training/Queue business data is unchanged; 57 differing technical timestamps were independently proved to retain their original `NOW()` formulas from backup.
- Current counts: Clients **19**, Blocks **19**, Payments **32**, Journal **131**, Queue **117**. Private plan contains approved facts and explanations; no personal or financial row payload is committed.
- Calendar preview before publication: zero writes, zero errors. No scheduled function was run manually and no synthetic business mutation was used for smoke.

## Constraints and next checkpoint

Complete natural scheduled evidence, the full live gate, Git-linked Vercel pointer verification and real read-only Telegram/MiniApp smoke. Record final acceptance separately; 21/23 is not complete recovery.

Preserve P1 authentication, immutable acceptance, actor/message binding, nonce/TTL, ScriptLock, replay protection, durable results, formula ownership and fail-closed recovery. Retain previous recovery effects, no unconfirmed hybrid start, no measurements without explicit admin action, and unchanged prices/access rules. No new functional stage.
