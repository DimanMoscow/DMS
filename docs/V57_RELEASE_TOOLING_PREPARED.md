# v57 release tooling preparation — no third attempt

**METADATA CONTRACT FIXED: YES.**
**READY TO EXECUTE v57 WITHOUT IN-WINDOW PREPARATION: NO.**

This checkpoint supersedes earlier execution-readiness YES statements. The owner
explicitly prohibited a third release during this task. Production HEAD, existing
deployment mapping, main and Vercel remain v56; ingress is OPEN; PR #80 stays draft.
No new numbered version, production code/config write or business mutation occurred.

## Prepared release target versus observed production

`apps-script/production.json` format 2 records the **prepared target** numbered 57,
its exact runtime identity, the retained v56 rollback/preflight baseline and the
versioned acceptance policy. It intentionally has no target `lastVerified` field:
neither a fictional zero nor the historical v56 live gate is v57 acceptance.
`lib/apps-script-runtime-identity.ts` already pins the corresponding v57 runtime.
Preflight and recovery validation explicitly use the retained baseline until the
external readback proves activation. Format 1 keeps its strict zero contract.

The snapshot/runtime verifier derives the expected release label from the verified
immutable source, independently of the observed HTTP response. It checks all three
fingerprints and both loaded flags. No runtime Apps Script/P1 module was edited.
The candidate remains 26 files / 9 changed files against v56, tree
`332ef8a3c8672293598704abf62ee445b496d29d5bbddd4f4f98a9b1c404220c`.
Numbered 57 already exists and is source-identical after the two documented URL
substitutions. It remains inactive. Main/Vercel production is
`4ab73e2103e85c3e0dd199ac220db51d2ccd61d3`.

The exact release commit is the commit containing this checkpoint. Resolve its
full SHA from Git/PR, pin it in the private acceptance package, and require that
same head when merging. No self-referential commit hash is embedded in its own tree.
Future live receipts are external to Git; producing them requires no release-code
edit, metadata rewrite or new commit inside the activation window.

## Fail-closed two-phase contract

Implementation: `release-reconciliation.mjs`, `calendar-acceptance-evidence.mjs`,
`release-acceptance-cli.mjs`; schema wiring: `production-target.mjs`.

1. Capture raw Calendar incremental and wide pages with deleted events, the actual
   v56/v57 plans, the normal v56 wide plan, all 11 reconciliation issue arrays,
   exact 17-cell writes, business revision, financial/numeric/business findings,
   duplicate and durable-operation evidence. Missing arrays are errors, not zero.
2. The compiler computes each Calendar identity from calendar/event identity and
   a separate semantic hash from the issue/revision and raw event. It computes the
   exact sorted issue-set hash, write-set hash, revision and whole-package hash.
   Additions must be pending with empty processed timestamp; existing rows must
   retain every value; candidate writes must equal normal v56 wide ingestion.
   Each missing issue must map one-to-one to an addition, have no Queue/Journal
   match and have a pre-cursor update inside the reconciliation horizon.
3. The owner-reader capture is the trust boundary. Hashes detect change, not
   authenticity or approval. Pin the reviewed package hash separately; never
   derive the approval argument from the package currently under test.
4. Fresh admission: oldest source/Sheets/Calendar/cursor/safety observation expires
   after **300 seconds**. Mixed-age evidence beyond that bound fails. Sealed
   activation has a separate **1,800-second** maximum, allowing the 420-second
   drain. Each current gate observation must be at most 60 seconds old. Recheck
   identities, exact issue set, business/Calendar revision and write set.
5. Before any candidate generation starts: only the exact approved known missing
   Queue set yields `PROVISIONAL_PASS`. There is no count-only exception. All
   other reconciliation types and finance/payment/client/block/link/duplicate,
   queue-error or unresolved-operation findings always fail.
6. A generation advance consumes the exception **even on failed/partial sync**.
   The append-only local activation journal persists this state before returning
   a verdict, including failure; missing/corrupt/truncated journals, concurrent
   writers and attempted reinitialization fail closed. No reset operation exists.
7. Post-sync: require **zero raw issues**, clean safety findings, actual successful
   generation from exact v57 source, matching completed post-sync evidence and
   zero issue/drift/pending/immediate counts, no overflow. Missing completion,
   residual one issue, old generation or a v56 sync cannot pass. Do not force sync.

Private CLI workflow (paths are placeholders, not operational IDs):

```text
node apps-script/scripts/release-acceptance-cli.mjs prepare --capture-envelope PRIVATE_CAPTURE --package PRIVATE_PACKAGE
node apps-script/scripts/release-acceptance-cli.mjs admit --package PRIVATE_PACKAGE --approved-fingerprint REVIEWED_HASH --journal PRIVATE_ACTIVATION_JOURNAL
node apps-script/scripts/release-acceptance-cli.mjs check --package PRIVATE_PACKAGE --approved-fingerprint REVIEWED_HASH --journal PRIVATE_ACTIVATION_JOURNAL --observation PRIVATE_FRESH_OBSERVATION
```

`prepare` reports AWAITING_SEPARATE_APPROVAL and does not admit activation. The
receipt compiler is not a live collector; the owner API/native/browser read
receipts must be assembled and time-stamped first. Do not fill uncollected checks
with empty arrays. Exclude a volatile value from business revision only where its
exact cell/formula was independently proved; keep the formula itself in evidence.

## Fresh read-only evidence in this preparation

- Owner API 10:07:08Z: HEAD/numbered56/mapping/runtime exact v56; numbered57 exact;
  reader and existing writer both authenticated, no new scope/consent. API/source/
  data/runtime probe completed in 13.765 seconds.
- Native `inspectDmsP1ReleaseState`, 10:09:37Z: original document context true,
  mutationReady true, durable pending/stale/manualReview 0/0/0, no legacy tickets,
  property capacity healthy, all five scheduled specifications and freshness pass.
- Raw Calendar preview 10:11:49Z: incremental 0, wide 132 (19 cancelled entries),
  pagination complete, v56 bounded plan 0 writes, candidate **3 additions + 8
  identical rewrites**; actual normal v56 wide plan exactly equal; no cancellation
  or planner error. Raw issue set only three `calendarTrainingMissingQueue`;
  projected raw reconciliation **0**. Financial issues/numeric mismatches/business
  semantic findings **0/0/0**. Preview was not applied.
- Existing recovery/restore re-read at 10:17:42Z: both owner-only, all 16 sheets,
  backup and restore exact, current source still equals backup. Fingerprint:
  `abf85fe4e37c077be3cd5b401df539995ad1b39a48c18158dda60229ae722af8`.
  No copies created in this task; a newly created recovery is still required
  immediately before any separately authorized future release.
- Counts: Clients 21; Blocks 19; Payments 35; Journal 137; Queue 125. No automatic
  attendance/payment/client/block/alias operation or Calendar apply was performed.
- Telegram owner session and DMS bot are available; its menu opens the signed
  production MiniApp and bootstrap renders 21 clients / 1 awaiting today / 0 debt.
  This is pre-warming on v56, not a claim of v57 production smoke.

Exact expected issue identities from that **historical, now expiring** preview:

| Identity SHA-256 | Semantic SHA-256 |
|---|---|
| `ab2bfcc21e7e45e9a95f9cef2e2e89caf186b11046e850048d8cd66d960a51a4` | `d50704a679f412ca336baa67f38b70803b93a04f8dc92a61561c347595e47dd4` |
| `bd557a823426848b9dca4b889fde502a119a9b52a96842deb153451f163383d5` | `f36f38b2396c7cfbd76c0b7d85fe30456802fe47ef5d7eecec46e76dcac609c0` |
| `4c734acef55c3b43a99233aca2ea176ac6c9282de39804b260bee6f5a68b5f52` | `c945b484179eb202d9954d6508495c8f736a16f73c71d849d201ac2fe7074156` |

Exact sorted issue-set fingerprint:
`63b951672815df4a48fb500805d4342c2234d7651241d655e2793bde988b3242`.
Seventeen-cell write-set fingerprint:
`0a4baf6882b422fd02c00b7392cf5c24f8c5ee9fdb3155ac1a28b9ff66be5223`.
Raw event IDs, row values, private backup references and OAuth material are not
stored in Git. A future preview must regenerate and review the whole package;
these hashes are evidence of this rehearsal, not a permanent whitelist.

## Rehearsal and time budget

`release-choreography.mjs` has no mutation transport. Fixture traces cover normal
ordering and regression → close → second drain → exact restore. The following are
explicit **abort ceilings**, not measured guarantees that external services finish.
Uncertain writes require readback; never retry a source/mapping mutation blindly.

| Step | Prepared tool / expected result | Per-call timeout; total ceiling | Fallback |
|---|---|---|---|
| Fresh preflight, recovery, Calendar, sessions | owner APIs + actual bundles + native inspection; exact independent receipts | Outside window; package admission ≤5 min | Recollect; do not close |
| CLOSED + readback | existing Google property UI removes marker; native ready=false | UI call 20 s; 60 s | Independent property readback; stop before switch |
| Drain | native `startDmsP1ExecutionDrain`; fresh timestamp, wait real 420 s | 420 s; poll/wait slices ≤60 s | Do not shorten or reuse historical drain |
| Drained inventory | native inspection + execution inventory; unresolved=0 | 30 s; 60 s | Abort or restore before activation |
| Full HEAD stage/readback | Apps Script PUT content with complete saved 26-file numbered57 payload; independent owner GET exact | API 30 s; 90 s | Read before retry; exact56 payload prepared |
| Staged Calendar preview | native preview/read-only actual staged source; same 17-cell set | 30 s; 90 s | Stop on changed semantics, no apply |
| Existing mapping→57/readback | Apps Script PUT existing deployment; preserve config, set version57; GET exact | API 30 s; 60 s | Prepared existing mapping→56 |
| Protected merge | GitHub ready transition, then merge API with expected head SHA; project squash convention | API 30 s; 90 s | Stop if head/main/checks changed; no bypass |
| Vercel READY | connector/API polling single Git deployment; exact merged SHA and production alias | API 30 s; 300 s | Rollback, no second manual deployment |
| CLOSED checks | native GET, `/`, `/client`, health/runtime, HTTP contract; exact pins | API 30 s; 60 s | Rollback |
| Guarded OPEN/readback | native `activateDmsP1Release`, independent property/runtime readback | UI/API 30 s; 60 s | Close and rollback on proven failure |
| Signed read-only smoke | prepared Telegram/MiniApp sessions; all approved read routes | Individual read 30 s; 300 s | Close immediately on proven regression |
| Business/reconciliation gate | owner reads, exact safety checks + phase-aware receipt | API 30 s; 120 s | Close/rollback if new business effect |

Activation ceiling **1,710 s / 28.5 min**. Rollback reserve **1,710 s / 28.5 min**:
close/readback60 + fresh drain420 + inventory60 + HEAD56/readback90 + mapping56/readback60
+ protected Web restore300 + Vercel READY300 + closed GET60 + OPEN/readback60
+ safe signed v56 smoke180 + reconciliation120.
Required extra slack **900 s / 15 min**. Total **4,320 s / 72 min**.

The protected Web rollback route still needs a concrete, pre-reviewed executable
artifact/permission path before execution admission; its 300 s is a budget
allocation, not a claim that such a rollback was tested live. Never invent a future
merge SHA or bypass required checks to satisfy this budget. The old known-good
Vercel deployment is READY and its exact source is recorded privately.

Natural sync is hourly, last inspected completion 09:21:17Z; next expected
10:21–11:06Z. Watchdog is every two hours, next 11:10–11:55Z. The native windows
include scheduler jitter. Even an ideal hourly gap is shorter than 72 minutes.
**Nearest safe window: none demonstrated under the current schedule and ceilings.**
Do not propose another 45-minute slot, close ingress or change triggers to make one.

## Dependencies and remaining admission work

- Google reader/writer/Calendar read-only refresh and source/mapping GET work.
  Full stage57/map57/restore56 request payloads are prepared privately, without
  executing PUT. No temporary helper has been added to Apps Script.
- Google project settings and native read-only execution work in new tabs. Old
  claimed-tab navigation and some Playwright mouse dispatches timed out; the
  accessibility path recovered. Native interlock/document-context operations
  remain browser dependencies; a supported equivalent API path is not proved.
  Do not add a smoke bypass, helper deployment or broaden P1 scopes as a shortcut.
- GitHub authenticated repository access and PR mergeability pass. Active main
  ruleset requires PR + strict `release-gate`, forbids deletion/non-fast-forward,
  has no bypass actors. Legacy branch-protection endpoint is 403 to the connector;
  ruleset details were obtained through the supported read-only endpoint instead.
  The PR remains draft. Ready/merge calls were not executed as a rehearsal.
- Vercel production GET is READY at the unchanged main SHA. No manual deployment.
- Signed Telegram/MiniApp launch is warm, but freshness/expiry must be rechecked
  before admission; opening an old tab is not durable authentication evidence.

Targeted preparation regressions: **17/17 PASS**, including the adapter for actual
native persisted post-sync fields (it preserves a residual issue instead of zeroing it).
Completed local full gate before that isolated adapter/test addition:
**367/367 repository + 47/47 candidate tests**, lint, typecheck, production build,
dependency audit **0 vulnerabilities**, snapshots and migrations PASS. CI must
also pass on the exact prepared commit and is the durable per-commit record.
F09 remains OPEN; no synthetic watchdog/digest/sync or alert suppression occurred.
No new OAuth scopes, consent grants or terms acceptance occurred in this task.
The installed Vercel CLI 50.8.1 had no saved session. Its authorized device login
reached the correct existing account, but `Allow Access` remained disabled after
both the supplied link and ordinary code entry. The page logged a React hydration
error. No disabled control was overridden and no Vercel access was granted.

Before requesting execution approval: prove the complete rollback/Web path and
native controls within measured bounds, demonstrate a schedule-compatible window
including rollback and 15-minute slack, then regenerate fresh private acceptance
evidence and recovery. Until then, leave exact v56 OPEN and PR draft.
