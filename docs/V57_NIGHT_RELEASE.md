# v57 night release — 14 September 2026

**ROLLED BACK.** The owner explicitly authorized this release and guarded rollback. Apps Script numbered 57 was created and briefly mapped while the ingress was closed. The plan's signed-read gate proved impossible under the existing interlock. Production mapping and complete HEAD were restored to exact v56. Main and Vercel never changed. Normal v56 writes were restored at 02:00:47Z; independent inventory at 02:02:09Z confirms `mutationReady=true`, durable pending/stale/manual review 0/0/0. Natural sync then succeeded; final signed health at 02:22:12Z is **23/23, 14.326 s**. Business hashes remain unchanged at 02:22:38Z. No owner action is needed to use production.

## Identities

- Main / Vercel Production SHA: `4ab73e2103e85c3e0dd199ac220db51d2ccd61d3`, Vercel READY.
- PR #80 was not merged; preflight head `b28d8d67ca099d7feb91940f8170c0a44a6b3905`. Runtime candidate commit `af99236e18b1dd13273768171972063dc11af6eb`.
- Active Apps Script numbered version **56**, `emergency-semantic-recovery`; HEAD and runtime independently exact after rollback and after reopened smoke.
- v56 tree: `873ec728daf92883c31f67eed8857b092360a7fe1fbba3e3d30d316379470a7d`.
- Numbered **57 exists, inactive**. Its immutable source and retained Git snapshot match candidate tree `332ef8a3c8672293598704abf62ee445b496d29d5bbddd4f4f98a9b1c404220c` (26 files).
- Current production router/portal/confirmation fingerprints remain the exact v56 values in `apps-script/production.json`; both handlers loaded. No production pointer was advanced in Git.

## Verified gates and execution (UTC)

| Time / gate | Evidence |
| --- | --- |
| 01:01:25 source | Owner reader: HEAD = numbered v56 = immutable Git v56, with only the two documented URL substitutions. Candidate exact; five P1 core modules byte-identical to v56. |
| Repository | Fresh 335/335 + candidate 47/47; lint, typecheck, production build, dependency audit zero, snapshot/migration/release checks PASS. Final recovery branch with two new maintenance-contract tests: 337/337 + 47/47 PASS. |
| 01:04:18 / 01:04:29 recovery | Two fresh owner-only private copies. All 16 sheets matched; isolated restore matched backup. Manifest fingerprint `99619c6d5faac59bf5adfb5b29241547b35f8fe394858b3050f8ed2575313b14`. Earlier copies retained. |
| 01:08:14 preflight health | 23/23, 18.120 s; semantic/financial/reconciliation issues 0. Durable pending/stale/manual review 0/0/0. |
| 01:16:58 first drain | Existing interlock closed and read back; 420-second drain completed before staging. Post-drain inventory clean. |
| 01:19:56 raw Calendar | Fixed-time incremental + wide, saved cursor and showDeleted: 129 events, 19 deleted, no additional pages. Actual v56 planner: zero writes. Actual v57 planner: eight rewrites with all 17 values unchanged; added/cancelled/errors 0. No apply. |
| 01:25:24 stage | Full 26-file candidate HEAD uploaded and independently exact. Native staged preview again added 0 / updated 8 / cancelled 0 / errors 0, same write-set. |
| 01:28:25 numbered source | Numbered 57 created and independently exact. Existing mapping switched; by 01:32:29 mapping, HEAD and all runtime fingerprints independently v57. |
| Signed smoke | Closed ingress returns plain `ok` for signed MiniApp POST; Web returns 502 invalid-upstream-response. Reproduced on v56 before switch and v57 after switch. No signed business reads can pass while this interlock is closed. |
| 01:40:43 rollback drain | Second complete 420-second drain; inventory 01:48:11 clean. |
| 01:49:02 / 01:49:31 rollback | Existing mapping restored to numbered 56; full 25-file HEAD restored and independently exact. No Web rollback needed because main/Vercel never changed. |
| 01:55:29 reconciliation | Native raw Calendar/Queue/Journal reconciliation `ok=true`, issueCount 0, safeRepairCount 0. Financial semantic checks and all business hashes clean. |
| 02:00:47 restore normal operation | Existing `activateDmsP1Release` passed financial/durable/config checks under its own lock. `mutationReady=true`; independent readback 02:02:09 confirms. Scheduled freshness still honestly reports the maintenance-skipped sync. |
| 02:03:49 data | Clients 21, Blocks 19, Payments 35, Journal 137, Queue 125 unchanged; duplicate IDs 0; 19 block completed counts reconciled through actual v56 domain context. Previously repaired client relations remain consistent. |

## Cause and correction boundary

`TelegramFinal.gs:doPost` invokes `assertDmsP1ReleaseReady_()` before either MiniApp or Telegram routing. This is the same P1 ingress contract in v56 and v57. The previous readiness plan incorrectly required signed reads while this gate was closed. It was a rollout-plan defect, not evidence of a newly introduced v57 business regression. Two actual-bundle fixture tests now prove the contract and zero business writes in maintenance.

No P1 module or approved runtime candidate was altered to make the release pass. Do not rerun the old order. A subsequent release needs an explicitly reviewed choice: either accept a guarded activation before signed production reads, or implement and test a distinct maintenance-read contract that continues to fail closed for every mutation. Neither change was performed tonight. Number 57 must not be assumed available for reuse.

## Restored production smoke and effects

Web/API v56: `/`, `/client`, `/api/health`, `/api/apps-script-runtime` 200; invalid POST 400; unsupported method 405; no-store and exact baseline SHA PASS. Signed MiniApp bootstrap, Today, Clients, one-off card, active-block card, Report and diagnostics read successfully after activation. Mobile viewport 390 px shows no horizontal overflow; override reset. Telegram `/start`, `/debt`, `/clients`, one-off card, `/balances` and `/report` period selector returned normally. v56 `/today` and `/attention` were not used to force their inline sync during recovery. This is v56 recovery smoke, not a claim that the complete v57 feature smoke passed production.

No real attendance/payment/client/block/alias operation was executed. Business counts and value hashes are unchanged before/after rollback smoke; only backup-proved volatile NOW() formula cells are excluded from that hash comparison. Release changed code/mapping and maintenance properties, then restored v56. It created two private recovery copies and the immutable inactive numbered 57. No full-sheet restore, deployment deletion, main merge, manual Vercel deployment or new permission scope occurred.

The first restoration click was rejected by automatic approval review because scheduled health still showed the maintenance failure. It did not execute. Independent native zero-issue reconciliation and exact v56 Web/source evidence were gathered; the same штатная activation action was then accepted and completed. No alternate property-edit or indirect bypass was used.

## Natural runs and remaining risks

- Backup 00:02:26.360–00:02:31.478Z: succeeded naturally, 5.118 s, before release maintenance.
- v56 watchdog 01:10:15.888Z: metric overall 14.434 s / health 13.401 s. This one fast baseline sample does not close F09.
- Sync 01:21:15.639–01:21:18.182Z: skipped with `release_maintenance`, 2.543 s. Retained as a real operational interruption; never cleared or replaced with synthetic success.
- Natural sync 02:21:11.037–02:21:17.613Z: completed, scheduled duration **6.576 s**. Generation **104**, ingestion duration 5.873 s; completed post-sync issue/drift/pending/immediate counts all **0**, overflow false. Historical maintenance failure remains recorded; current freshness is healthy.
- Signed health 02:22:12Z: **23/23**, 14.326 s. Business counts/hashes unchanged at 02:22:38Z, duplicate IDs 0. Interlock readback still has the exact v56 ready marker.
- Morning watchdog/digest observation continues in this task through a bounded heartbeat. No synthetic sync/watchdog/digest was run to obtain green.
- **F09 OPEN**; v57 phase instrumentation is inactive after rollback, so new v57 phase timings are unavailable. The 8 unchanged Queue rewrites, history index threshold and legacy call-graph cleanup remain P3, unimplemented.

Credentials, raw account/client evidence and recovery IDs are retained privately outside Git. Temporary local night release helpers were removed; none was uploaded into Apps Script. No new features or business-rule changes were started after rollback.

**MANUAL ACTION: NONE** for restored production. A future v57 attempt requires a revised, explicitly reviewed smoke/activation order.

**v56 RESTORED — PRODUCTION SAFE**
