# Current project state

**2026-09-14 release-engineering checkpoint: preparation only, NO admission.**
Actual v56 remains OPEN; main/Vercel unchanged, PR80 draft. Fresh generation114
retains known horizon drift3; no new business effects. Tooling now tests the actual
native running/failed sync lifecycle, includes aliases in never-exempt safety,
collects immutable raw Calendar diagnostic evidence, and executes fixture rollback
with deadlines/readbacks. The collector still lacks a live native receipt adapter;
CLI output is deliberately DIAGNOSTIC_ONLY. Full live interlock/Web rollback/signed
timing remains unproved. See [V57_RELEASE_ENGINEERING](V57_RELEASE_ENGINEERING.md)
for actual measurements and blockers; this supersedes older preparation estimates
and readiness statements as the current operational checkpoint.

**Current task: preparation only; third release prohibited.** Metadata contract is
fixed and the branch contains the exact numbered57 target/Web expectation, without
claiming live v57 acceptance. Actual production remains exact v56, OPEN; PR #80 draft.
**READY TO EXECUTE v57 WITHOUT IN-WINDOW PREPARATION: NO**: the bounded activation,
full rollback and 15-minute slack require 72 minutes, exceeding the hourly sync gap;
the complete Web rollback path still requires proof. Current authoritative checkpoint:
[V57_RELEASE_TOOLING_PREPARED](V57_RELEASE_TOOLING_PREPARED.md). Older YES/readiness
statements below are historical. No third attempt or production mutation occurred.

**Previous execution admission: BLOCKED.** The owner-authorized 12:25–13:10 Moscow retry did not start a production switch. Its timing and metadata failures are recorded in [V57_RETRY_RELEASE_CHECKPOINT](V57_RETRY_RELEASE_CHECKPOINT.md).

## Corrected v57 procedure — 2026-09-14 12:22 Moscow

**READY TO RETRY v57 RELEASE: YES** for the corrected procedure and unchanged candidate;
no deployment was performed in this procedure task. Authoritative active sequence:
[V57_RETRY_PROCEDURE](V57_RETRY_PROCEDURE.md). CLOSED permits GET/runtime/native
checks; guarded OPEN precedes immediate signed read-only smoke. Rollback uses the
same boundary and restores both HEAD and mapping. No P1 bypass or source change.

Fresh owner readback 09:21:43Z: HEAD/mapping exact v56, numbered 57 exact candidate;
main/Vercel unchanged. New fixed-time raw Calendar preview 09:22:18Z: **3 pending
additions + 8 identical rewrites**, no cancellation/error, all 17 values equal to
normal v56 wide scan; projected reconciliation zero. Targeted tests **22/22**.
Automatic CI 27c00ff passed 351/351 + 47/47 and all checks. Natural sync at 12:21 finished (generation 112, 6.498 s ingestion, known drift 3). The 12:25–13:10 Moscow window remains conditional on
fresh preflight and sufficient rollback reserve. Prior snapshots below retain
their historical timestamps and do not override this corrected procedure.

F09 OPEN: latest natural v56 watchdog 09:10Z is 34.120 s overall / 32.367 s health;
two consecutive increases trigger performance investigation and no functional
expansion, not attribution to inactive v57. Production stays open on v56.

Last verified: 2026-09-14, 08:29 Europe/Moscow. Night v57 attempt remains rolled back to exact v56; writes open and fresh HEAD/numbered/mapping/runtime checks pass. Business values unchanged. Morning sync generation 108 retains one known v56 Calendar horizon drift; watchdog alerted and digest sent. Initial recovery 23/23 below is historical, not a current all-green claim. Night observation completed and its automation is paused.

## Night v57 release attempt — ROLLED BACK

The owner authorized release and rollback. Numbered Apps Script 57 was created,
independently source-verified and briefly mapped with the ingress closed. The
required signed smoke could not work: the unchanged v56/v57 P1 interlock blocks
all POST reads too. This disproves the previous readiness rollout order; it does
not prove a newly introduced v57 business regression. Mapping and complete HEAD
were restored to exact v56. Main/Vercel remain
`4ab73e2103e85c3e0dd199ac220db51d2ccd61d3`; PR #80 is unmerged.

Normal writes restored at 02:00:47Z, independently read back at 02:02:09Z.
Durable pending/stale/manual review 0/0/0; raw reconciliation 0 issues;
post-smoke business hashes unchanged. Web/API and signed MiniApp/Telegram reads
work again. Numbered 57 exists but is inactive; its immutable snapshot is retained.
Full branch gate with the new maintenance-contract tests: 337 + 47 PASS.
F09 remains open; no v57 phase evidence is claimed after rollback.

Natural sync at 02:21:17Z restored scheduled freshness (6.576 s, generation 104,
completed post-sync issue/drift/pending/immediate counts 0). Signed health at
02:22:12Z is 23/23; business hashes at 02:22:38Z remain unchanged.

Later natural runs reproduced the known v56 ingestion/reconciliation horizon gap:
one unchanged future Calendar event enters the 24h reconciliation window before
the next wide ingestion. Raw API + actual v56 code independently prove
`calendarTrainingMissingQueue=1`, with all accounting/link issue classes zero.
Morning sync generation 108 retains that drift; the 05:10Z watchdog alerted
(overall 12.208 s / health 10.604 s), and the 05:11Z digest was sent naturally.
Final owner source/runtime and business-data checks pass at 05:28:49Z. The only
moving values are 72 verified NOW() cells and automation status. F09 stays open.
No production changes were made by the observer. The heartbeat is paused.

The v57 planner now previews one new pending row plus eight identical rewrites;
the old eight-only preview cannot authorize a subsequent release. Fresh write-set
and corrected smoke/activation order must be reviewed before a new attempt.

Current authoritative result: [V57_NIGHT_RELEASE](V57_NIGHT_RELEASE.md).
Readiness for the old smoke order is **NO**. Earlier YES below is historical.

## Post-burn-in audit checkpoint — 2026-09-14

Runtime/main rechecked at `4ab73e2103e85c3e0dd199ac220db51d2ccd61d3`, Apps Script v56;
live signed read-only health 23/23 in 13.201 s. No production changes. Fresh owner
HEAD/numbered v56 exact-source readback, 16-sheet owner-only recovery/restore and
335 + 47 tests now pass. Isolated signed Web/backend v57 reads pass with an explicit
local runtime-pointer overlay. Full raw Calendar
preflight now passes (129 events including 19 deleted; v57 plans 8 unchanged
row refreshes, no new attendance/payment effects). Technical readiness YES for
reviewed release approval; candidate v57 remains undeployed.
Current evidence and rollout order: [V57_READINESS](V57_READINESS.md).
Findings, coverage limits, navigation/backlog and release gates:
[POST_BURN_IN_AUDIT](POST_BURN_IN_AUDIT.md),
[POST_BURN_IN_RELEASE_PLAN](POST_BURN_IN_RELEASE_PLAN.md).
The following sections retain the dated September 11 release evidence.

## Production identity

- Apps Script **v56**, release `emergency-semantic-recovery`, 25 files. Official Google reader proved production deployment mapping, numbered source, HEAD and the merged candidate exact. Tree: `873ec728daf92883c31f67eed8857b092360a7fe1fbba3e3d30d316379470a7d`. Full router/portal/confirmation identities are in `apps-script/production.json`; both handlers are loaded.
- Published at 08:28:24Z and activated at 08:31:06Z after the 420-second old-execution drain, private recovery and independent read-back. The temporary OAuth helper is absent from final HEAD, numbered source and snapshots.
- Runtime pointer PR #78 merged as `9741d66e528941a4d24581e7860d3f0a2db705cb`; CI and automatic Vercel Production passed at that exact SHA. Release **0.2.7**, fingerprint `miniapp-r8-apps-script-runtime-probe`, connected. `/`, `/client`, `/api/health`, `/api/apps-script-runtime` all 200; invalid POST 400 and unsupported method 405 with `no-store`. A later documentation-only merge advances the source SHA; obtain current exact SHA from `origin/main` and `/api/health`, not this historical code checkpoint.

## Final gate and natural schedules

Owner read-only gate at **2026-09-11T09:24:14.440Z: 23/23**; duration 17.178 s. Raw and semantic reconciliation **0**, numeric/formula issues **0**, duplicate accounting **0**, Queue errors **0**, measurement corruption **0**. Durable pending/stale/manual-review **0/0/0**; nine historical validation failures remain auditable.

| Managed job | Latest successful natural evidence (Moscow) | Final health |
| --- | --- | --- |
| Automatic backup | September 11, 03:02:31; 4.842 s | fresh, correct owner/configuration |
| Morning digest | September 11, 08:11:13; 17.560 s | fresh, correct owner/configuration |
| Evening queue | September 10, 22:53:47; 74.555 s | September 11 run not due yet; fresh |
| Calendar sync | September 11, 12:21:20; 9.142 s | fresh; generation 33, completed post-sync findings 0 |
| Watchdog | September 11, 12:15:05; 283.714 s | successful scheduled completion; reported the then-pending Calendar recovery |

All five handlers are present exactly once, correctly owner-bound, with verified cadence, settings and Europe/Moscow time zones. The 11:21 sync failure during maintenance is retained as history; the subsequent **natural** 12:21 success establishes freshness and accepted post-sync evidence. No manual scheduled execution was used to obtain green.

## Recovery and user-flow evidence

- Official owner consent completed. Reader/writer local OAuth profiles remain separate and outside Git. Work and OAuth Playground are unnecessary.
- Fresh owner-only private backup and isolated restore matched all **16 sheets** at 08:07:07Z. The existing minimized recovery plan on Drive was read back exactly and permissions remained owner-only, with no public or third-party access.
- Exact immutable plan committed **10 guarded patches once** at 08:22:31Z. Independent reader after UI smoke at 09:27:45Z proves every patch, five added payments, all 27 prior payments retained, one audit record, zero semantic findings, and unchanged Journal/Queue business data. The 57 differing technical timestamps retain their original backup-proved `NOW()` formulas.
- Counts: Clients **19**, Blocks **19**, Payments **32**, Journal **131**, Queue **117**. Approved missing payments, one empty unit price and one existing advance assigned to a planned next block are corrected. The advance amount/date is preserved; planned activation still waits for the confirmed Calendar start. One historical aggregate supplement has an explicitly unknown exact payment date; no date was invented.
- Telegram Web **Yesterday** returned no waiting events; **Today** rendered the current three rows and row/day buttons. Normal `/today` navigation retains its existing inline Calendar read/sync path and was exercised only **after** the independent natural green gate. Subsequent independent read-back proved no new business effects. Row/day mutation, replay and concurrency checks remain isolated fixtures, not real training/payment smoke.
- Signed Admin MiniApp opened from Telegram, showed connected data, the three Today rows and registration boundaries, 19 clients, and the corrected zero debt in the affected client card. No payment, Calendar event, decision, enrollment or measurement was created for smoke.
- Full repository gate: **312/312 tests**, lint, TypeScript, build, snapshot integrity and applied migrations pass; dependency audit **0 vulnerabilities**. Operations inventory now checks actual v56 global entry points. Detailed causes/security/evidence: `docs/EMERGENCY_RECOVERY.md`, `docs/OPERATIONS_MAP.md`, `docs/ACCEPTANCE_MATRIX.md`.

## Remaining risks and stop point

- One natural watchdog spent 279.238 s inside health checks, with no mutation lock held; the next owner gate took 17.178 s. The outlier's cause is unproved. Do not claim a production latency percentile or complete elimination of Google service latency. Isolated semantic read volume improved from 5,404 to 2,425 cells at 1x and 52,060 to 24,250 at 10x.
- Some Telegram read commands/digests still run inline ingestion, and older manual spreadsheet/repair and management/onboarding paths remain separate audited control-plane boundaries. These residual limitations are explicit in the operations map; this recovery did not rewrite every business path.
- Pending decisions and unregistered Calendar events require real admin decisions. Do not infer attendance/payment or perform them as smoke.

Stop at this checkpoint. Preserve P1 authentication, immutable acceptance, actor/chat/message/action binding, nonce/TTL, ScriptLock, replay protection, durable results and fail-closed recovery. No unconfirmed hybrid start, measurements without explicit admin action, price/rule/access changes or new functional stage.
