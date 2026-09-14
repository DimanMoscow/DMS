# v57: corrected activation procedure — 14 September 2026

This is a procedure correction, not a second deployment. The night rollback was
correct; it did not establish a v57 regression. The owner selected activation
before signed smoke and prohibited another switch during this task. No P1 code,
security contract, business rule or maintenance bypass is changed.

**READY TO RETRY v57 RELEASE: YES — procedure and unchanged candidate.**
This permits preparation of a retry under the sequence below; it is not evidence
that its future fresh recovery, drain, activation or production smoke has occurred.
The current task ends without a production switch. The execution-time predicates
below must all pass before a retry can close the interlock.

## Fresh identity and scope proof

Owner API readback at **2026-09-14 09:07:09Z**:

- Main and Vercel production: `4ab73e2103e85c3e0dd199ac220db51d2ccd61d3`, READY.
- PR #80: `e513a5411c585f831a9bbd373b096153083fbaad`, draft, unmerged at check.
- Production mapping and complete HEAD: exact **v56**, 25 files.
- Existing immutable numbered **57**: exact candidate, 26 files, inactive.
- Candidate tree: `332ef8a3c8672293598704abf62ee445b496d29d5bbddd4f4f98a9b1c404220c`.
- Last runtime-code commit: `af99236e18b1dd13273768171972063dc11af6eb`.
  Subsequent changes are documentation, tests, and the independently verified
  immutable v57 snapshot/verification metadata; they do not change runtime source.
- HEAD/numbered 56 compare with immutable Git 56 using only the two documented URL
  substitutions. Numbered 57 compares with the full candidate using those same
  substitutions. OperationSafety, UndoSafety, FinancialSafety, ReleaseSafety and
  DomainOperations are byte-equivalent to v56.
- Live Web health and runtime GET identify v56 with both handlers loaded and all
  expected fingerprints. A transient owner API HTTP 503 passed on a read-only retry.

No new runtime candidate means no new full runtime gate was manufactured here.
Prior full gate **337/337 + candidate 47/47**, lint/build/typecheck, audit zero,
snapshots and migrations remain attributed to their recorded run. This change
adds targeted actual-bundle ingress coverage: **22/22** tests (16 maintenance
matrix tests plus 6 existing release safety tests). Required PR checks remain
mandatory. A later runtime change invalidates reuse and requires a new full gate.

## Interlock contract, proved on both complete bundles

| Path | CLOSED | OPEN |
|---|---|---|
| Apps Script ordinary GET | Liveness text only | Same |
| Apps Script GET `dms_runtime_identity=1` | Runtime JSON | Same |
| GET with read/mutation action parameters | No action dispatch | No action dispatch |
| Well-formed MiniApp POST, including signed reads | Guard throws before router/auth; catch returns plain `ok`; no handler/Sheet access | Version, HMAC, age, identity and authorization checks, then handler |
| Telegram webhook read or callback | Guard runs before webhook/admin checks; no dispatch or Telegram response | Webhook/admin/replay checks, then dispatch |
| Domain mutation acquiring a new lock | Denied by release guard | Existing ScriptLock/domain checks apply |
| Already acquired mutation lease | Not revoked by closing the marker | In-flight owner can finish; drain is required |
| Owner source/deployment reads, native inspection | Available; not `doPost` | Available |
| Scheduled sync/watchdog/digest | Guarded; may record maintenance failure | Normal trigger and P1 checks apply |

Source locations: final `doPost` in `TelegramFinal.gs` (guard precedes
`handleDmsMiniAppRequest_`), final `doGet` in `TelegramBot.gs`,
`assertDmsP1ReleaseReady_`/activation in `ReleaseSafety.gs`, and the re-entrant
lease in `OperationSafety.gs`. The tests invoke actual ingress and domain handlers;
only Google/Telegram service boundaries and synthetic auth are fixtures. A real
invite mutation executes only in memory after reopening, proving that OPEN is
not a special read-only mode. Invalid/expired signatures remain rejected.

Malformed/missing/oversize bodies can be rejected before the guard; this is not
a maintenance read exception. A plain `ok` from CLOSED is **not successful signed
smoke**. The Web `/api/dms` proxy cannot parse it and returns its upstream error.
Web invalid POST (400), unsupported methods (405), shell `/` and `/client`,
`/api/health` and strict runtime GET can be checked while CLOSED. HTML loading
does not prove bootstrap. During the deliberate old-Web/new-backend interval,
strict runtime mismatch is expected; it must disappear after matching Web READY.

## Corrected release sequence

1. Before the reserved window, refresh main/PR/Vercel/HEAD/numbered 56 and 57,
   candidate tree, immutable source substitutions, existing deployment ID and
   rollback references. Reuse runtime gates only while runtime source is unchanged.
   Prepare the exact release commit with numbered **57**, production pointer,
   runtime expectation and evidence; run its required checks without merging yet.
2. Create a **fresh owner-only recovery copy**, verify all 16 sheets, permissions,
   manifest/fingerprint, isolated restore and equality. Retain previous copies.
   Night backup/restore PASS is historical evidence, not the future fresh backup.
3. Capture fresh production business data, financial/durable/duplicate gates and
   raw Calendar incremental + wide + tombstones with one fixed time and live
   cursor. Review every new pending row and all 17 columns of existing-row writes.
   Known horizon omissions must be explicitly enumerated, not hidden as green.
   No attendance, payment, alias, client or block repair; preview never applies.
4. Admit the window only after the preceding natural sync and watchdog completed,
   no active conflicting executions remain, and release **plus rollback reserve**
   fit before the next scheduled process. Recheck the live trigger inventory,
   owner/timezone/cadence. Do not pause or reschedule triggers to manufacture a gap.
5. Close the existing interlock by removing its ready marker and independently
   read it back. Then start the existing drain and record its fresh timestamp.
   `startDmsP1ExecutionDrain` rejects the current OPEN marker, so it is not itself
   the initial close operation. Do not reuse the night drain timestamp.
6. Wait **420 seconds**; inspect executions and durable pending/stale/manual review.
   A marker change does not kill an acquired lease. Unresolved operations stop
   progression; do not force-release them.
7. Stage **all 26 candidate files into HEAD**, then independently read back exact
   candidate source. This is necessary because installable triggers use HEAD;
   switching only the web deployment would leave scheduled ingestion on v56.
   Read-only staged Calendar preview must match the freshly approved write-set.
8. Re-read the existing immutable numbered **57**, verify equality with staged
   HEAD/candidate, and update the **existing** production deployment mapping to 57.
   Do not create another version or deployment. Read back mapping and direct
   runtime fingerprints/loaded flags while CLOSED.
9. Merge the prepared release commit using protected-main checks and the project
   merge strategy; allow its single automatic Vercel production deployment.
   Wait for READY and verify exact deployed main SHA and strict runtime identity.
   No additional manual deployment; never disable the mismatch check.
10. While CLOSED, finish available source/mapping/runtime/GET/400/405/no-store
    checks and native financial/durable/data checks. **Signed smoke is not a
    predicate for opening.** Failures here cause recovery while still CLOSED.
11. Invoke the existing guarded activation (`activateDmsP1Release`) and read back
    OPEN. Do not directly set the ready marker to bypass its financial, durable,
    capacity, schema, trigger or drain checks.
12. Immediately perform read-only **authenticated Telegram and signed MiniApp**
    smoke: bootstrap, Today, Clients, active/no-block/one-off card and history,
    unknown current/older registration previews, Report and diagnostics;
    Telegram `/start`, `/today`, `/yesterday`, `/attention`, `/clients`, `/balances`,
    `/debt`, `/report`, card/history and onboarding next action. Compare accepted
    selection using a captured read-only state, never submit confirm-day.
    No mutation callback, registration resolve, invite creation, test client,
    payment, attendance, block or Calendar write. Inspect actual results rather
    than HTTP 200 alone. Record start/end and compare business data/durable effects.
13. At the **first proven regression**, close immediately and follow rollback
    below. If smoke cannot finish within its time budget, do not leave an
    unverified release active: close and restore the baseline as a procedural
    abort, without calling the timeout proof of a candidate regression.
14. After initial PASS, leave writes open and observe the next natural sync and
    post-sync reconciliation. The enumerated missing pending rows are expected
    to be ingested then. Do not force sync/watchdog/digest merely to obtain green.
    Do not claim post-sync success before the actual natural run.

OPEN restores normal production access for everyone; it cannot guarantee the
absence of an administrator's simultaneous action. Keep smoke itself read-only,
compare timestamps/durable receipts, and stop for unexplained business effects.
No new bypass or modified P1 semantics are proposed.

## Rollback without repeating the same contradiction

Close → independent marker readback → **new 420-second drain** → restore exact
v56 **HEAD and existing deployment mapping** → independent source/runtime readback.
Restore exact previous Web via the supported project rollback path if Web has
changed/is incompatible; verify READY and its SHA. Preserve the corresponding
protected-main revert/evidence, without force-push or unreviewed changes.

While CLOSED: available GET/runtime and native financial/durable/reconciliation
checks. Then guarded activation/readback OPEN → immediate safe signed reads and
data comparison. Do not require successful signed reads before reopening v56.
For v56 Telegram use `/start`, `/clients`, `/balances`, `/debt`, `/report`,
`/yesterday` and existing card reads. **Do not use `/today` or `/attention`: the
actual v56 handlers invoke inline sync.** New v57 history/onboarding functionality
is not a rollback acceptance requirement. MiniApp bootstrap/client reads remain
available without an ingestion apply. If restored signed reads fail, close again
and investigate; never report production safe without the readback/smoke evidence.
Do not overwrite the whole Sheet or revert legitimate intervening operations.

## Fresh expected Calendar write-set

Fixed time **2026-09-14 09:12:32.435Z**, Sheet capture **09:07:09.792Z**,
live cursor `lastSuccessfulAt=08:21:12.241Z`, last wide **13 September 16:21:33.611Z**.
Raw API incremental `updatedMin=13 September 08:21:12.241Z`, `showDeleted=true`:
**0 events**. Wide interval **10 August 21:00Z – 15 September 09:12:32.435Z**:
**132 events, 19 cancelled**, one page; no unconsumed page tokens.

| Actual planner | Add | Rewrite | Cancel | Errors | Projected reconciliation |
|---|---:|---:|---:|---:|---|
| v56 with live cursor | 0 | 0 | 0 | 0 | 3 missing Queue rows remain |
| v57 with live cursor | 3 | 8 | 0 | 0 | All 11 issue classes zero |
| v56 with only local wide-due clock state | 3 | 8 | 0 | 0 | Same write-set, all 17 values equal to v57 |

Three missing events now lie inside the moving horizon: **15 September 07:00,
09:00 and 12:00 Moscow**. They were last updated 24 August, 8 September and
10 September, respectively; none appears in the incremental query. The morning
one-row estimate became two by the 08:21Z sync and three by this fixed-time check.
All three use existing recognized clients/blocks; no new client/alias binding or
change to an existing relation is introduced. Exact private row/event IDs and
values are retained outside Git.

All three new rows are **Ожидает**, with empty processing timestamp. The existing
schema pre-fills the *proposed* decision `Проведена`; that is not a confirmed
attendance and is also what v56 wide scan produces. No day confirmation or
automatic decision application is authorized. Existing rewrites preserve all
17 values: seven pending, one requiring registration; **new registrations 0**.
Journal, Payments, Clients and Blocks receive no planner writes. This task made
**zero production writes**; projected rows exist only in local memory.

The initial read-only gate must tolerate only these specifically proved baseline
horizon omissions until natural ingestion, while keeping their alert visible.
Any other link/financial/duplicate/cancellation issue is NO-GO. Refresh the cursor,
Sheet and raw API again immediately before execution; further horizon entries
require the same per-row proof, never a blanket allowlist.

## Nearest proposed window and observation risk

Live UI lists exactly five owner clock triggers. Recorded cadence is sync hourly,
watchdog every two hours, backup 03:00 Moscow hour, morning 08:00 hour, evening
22:00 hour. Natural sync finished **11:21:19.760 Moscow**, watchdog finished
**12:10:50.717 Moscow**. Next expected sync is around **12:21**, then **13:21**;
next watchdog around **14:10**. These are observed trigger phases, not a Google
guarantee of exact seconds.

Proposed reservation: **14 September 12:25–13:10 Moscow (09:25–10:10 UTC)**,
only after actual completion of the natural 12:21 sync and renewed checks.
Finish activation + immediate smoke by **12:45**; otherwise start rollback with
25 minutes reserved to restore/verify by **13:10**, leaving roughly 11 minutes
before the next expected sync. If preflight, CI, Google/Vercel latency, pending
execution or fresh schedule makes this budget unrealistic, skip the window before
closing. This is a release/rollback time budget, not permission to shorten drain.
No synthetic scheduled run and no trigger change is part of this plan.

F09 stays OPEN. Natural v56 watchdog overall timings increased **12.208 → 18.978
→ 34.120 s** at 05:10/07:10/09:10Z (latest health **32.367 s**). This meets the
previously defined two-successive-deteriorations observation threshold: flag a
performance problem and do not start functional expansion. It is not evidence
against inactive v57, and F09 alone remains non-blocking for this corrective
release. v56 provides no reliable internal health phase breakdown; zero metric
placeholders must not be reported as measured zero-cost phases. Alerts remain.

No OAuth consent, new scope, API enablement or permission change was granted in
this task. Existing owner reader and Calendar read-only authorizations worked.
