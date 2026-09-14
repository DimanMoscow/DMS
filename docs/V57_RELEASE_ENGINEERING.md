# v57 release engineering — preparation only, 2026-09-14

**NO production admission.** v56 HEAD/mapping and main remain active, ingress OPEN,
PR #80 draft/unmerged. No candidate runtime changes, new numbered version, production
configuration changes, trigger changes or business writes were performed in this task.
This checkpoint supersedes earlier readiness claims for the next attempt.

## Verified live state

- main / production Web: `4ab73e2103e85c3e0dd199ac220db51d2ccd61d3`.
- Candidate runtime commit: `af99236e18b1dd13273768171972063dc11af6eb`.
- Candidate tree: `332ef8a3c8672293598704abf62ee445b496d29d5bbddd4f4f98a9b1c404220c`.
- Numbered 57: existing, inactive, 26 files; owner-reader source comparison exact
  after the two documented operational URL substitutions. No version was created.
- HEAD = numbered56 (25 files); independent repeat readback 11:56Z confirmed this.
- Production Vercel: `dpl_AtwnnRYUiVY6rmbe4U8wiSupuTXn`, READY, exact main above.
- Natural Calendar generation 114 completed 11:21:18.264Z / 14:21 Moscow:
  ingestion 6.495 s; enclosing scheduled operation 7.298 s. Known v56 drift = 3.
- Natural watchdog 11:10Z / 14:10 Moscow: overall 20.906 s, health 18.128 s,
  metric outcome partial; scheduled handler completed. Alert was not suppressed.
  F09 remains OPEN; zero uninstrumented phase fields are not zero-cost proof.
- Native original-document inspector at 11:52:43.188Z: OPEN, durable pending/stale/
  manual_review = 0/0/0, legacy malformed = 0, scheduled configuration/owner valid.
  The historical ledger contains pending/started events; its latest durable state
  is clean. Raw event counts must not be mistaken for unresolved operations.
- Business data before/after read smoke: Clients 21, Blocks 19, Payments 35,
  Journal 137, Queue 125, operation-ledger rows 64. No business-cell differences;
  72 changed computed cells independently verified as `=NOW()` formulas.
- Existing recovery and isolated restore re-read 11:56Z: both owner-only, all 16
  sheets exact, fingerprint `abf85fe4e37c077be3cd5b401df539995ad1b39a48c18158dda60229ae722af8`.
  Read duration 8.073 s. This validates existing recovery, not a new pre-release copy.

## Metadata contract and collector

The pre-activation exception remains exact-set, not count-based. Only known
`calendarTrainingMissingQueue` omissions with horizon proof may qualify. Full issue
identity/semantics/revision, all 17 Queue cells, release SHA, actual candidate and
numbered-source tree, approved package hash and 300-second admission expiry are bound.
Duplicate, finance/payment, client/block/link, **alias**, Queue↔Journal, processed
missing journal, cancellation and every other issue class remain NO-GO.

A tooling defect was reproduced against the actual v57 native lifecycle: beginning
or failing a sync retains the previous generation. The old test advanced generation
artificially. Source-bound native `running`/`failed` evidence now consumes the exception
before other checks, even with the old generation; the journal must persist rejection.
Successful post-sync acceptance requires an advanced generation, exact v57 source,
completed matching post-sync evidence and zero issues/drift/pending/immediate, no
overflow. A consumed exception cannot return to pre-activation state.

`collect-calendar-release.mjs` now collects owner source HEAD/56/57/mapping, complete
business ranges including all 19 Journal columns, fixed-time raw Calendar incremental
and wide pages including deletes/etags, actual v56/v57/v56-wide planners, numeric and
semantic financial findings, live and projected reconciliation. It performs no apply,
forbids bundle redirection, rejects incomplete/cyclic pagination, and writes a private
exclusive-create, fsynced, fingerprinted artifact. Actual planners run only against a
memory workbook; any workbook/network effect from the bundle is rejected.

**End-to-end collector readiness remains NO.** The Google default-GCP bound project
does not expose a supported REST Script Properties reader. `collectReleaseEvidence`
accepts a live native-reader adapter and requires an independent later cursor/safety
read. The current CLI reads a fresh native receipt file and therefore **always outputs
DIAGNOSTIC_ONLY**, deleting any acceptance package. It cannot admit a release. A
supported live native adapter and complete independently collected safety receipt are
still required. There is no silently fabricated empty safety report or approved hash.

Private CLI invocation, from repository root:

```text
node apps-script/scripts/collect-calendar-release.mjs <absolute-private-config.json> <absolute-new-evidence.json>
```

The config identifies separate reader/calendar profiles, native receipt and target.
Credentials, target IDs, raw Calendar rows and source substitutions stay outside Git.

Fresh diagnostic observation at 11:42:59.282Z:

- 2 raw pages; 132 wide events, including 19 deleted events; complete pagination.
- v56 incremental writes 0; v57 additions 3, rewrites 8, cancellations/errors 0.
- Each existing rewrite retains all 17 values. Candidate equals normal v56 wide
  ingestion. Projected reconciliation = 0; finance/numeric/business findings = 0.
- Exact issue identity hashes:
  `ab2bfcc21e7e45e9a95f9cef2e2e89caf186b11046e850048d8cd66d960a51a4`,
  `bd557a823426848b9dca4b889fde502a119a9b52a96842deb153451f163383d5`,
  `4c734acef55c3b43a99233aca2ea176ac6c9282de39804b260bee6f5a68b5f52`.
- Raw candidate-write-array fingerprint:
  `665d80c8dafca235c45ca30775a34b52500494bea925fb18d94c7b23d37db719`.
  This is not the normalized acceptance-package fingerprint and grants no approval.
- Immutable diagnostic artifact fingerprint:
  `b6b64a2b53c621e10fd554153cc7e363984883dafcc43a550aeb6b4bd631be5b`.

These timestamps are historical evidence; collect a new reviewed package immediately
before any future admission. No new pending rows were applied during preparation.

## Supported transports and remaining dependencies

| Operation | Supported path / expected proof | Measured evidence | Timeout / fallback |
|---|---|---|---|
| Fresh source / Sheets / Calendar | Owner reader + Calendar readonly API; exact source/rows | Full diagnostic invocation 3.294 s, one sample | Individual Google GET 30 s; abort collection, no admission |
| CLOSED | Native project settings: remove only readiness property, save; native drain function | **Not measured through full live close/open cycle** | Existing 60 s provisional ceiling; stop before drain if UI not ready |
| CLOSED/OPEN readback | Native original-context inspector, exact marker | Server log 14:52:41–44, about 3 s; UI preparation excluded | Fresh editor tab recovered prior tab timeout; no hidden RPC |
| Guarded OPEN | Native `activateDmsP1Release`; ScriptLock, drain, financial/durable/schedule guards | Contract tests exist; no live mutation in this task | Existing 60 s provisional ceiling; failed proof cannot count as OPEN |
| HEAD stage/restore | Apps Script API PUT full private exact files, independent GET | Reader/source equality proven; PUT latency not re-measured | Prepared request bodies, 30 s API timeout; ambiguous result → readback before retry |
| Mapping switch/restore | PUT existing deployment config to numbered57 / exact56, independent GET | Mapping identity/source readbacks proven | No new deployment/version; ambiguous response → readback |
| Git merge | GitHub expected-head squash merge through required release-gate | PR draft, head pinned, main rules required | Do not merge now; 90 s provisional ceiling, reread commit on lost response |
| Vercel forward | Protected-main merge → sole automatic production build → READY/exact merged SHA | 8 preview samples below | Production build duration not established as p95; no duplicate manual deploy |
| Vercel rollback | Supported Instant Rollback to previous production deployment | Exact v56 deployment visible/current | CLI unauthenticated; dashboard action disabled while already Current; future action not exercised |
| Signed reads | Authenticated Telegram Web + production MiniApp | Bootstrap, Clients, one-off/no-block card and Today read successfully | Full signed sequence timing not measured; exclude all mutation controls |

Apps Script Execution API requires an API-executable deployment and the calling
OAuth app and script to share a standard GCP project. Production uses the default
project; the existing technical OAuth project is separate. Changing that production
configuration or inventing an interlock bypass is outside this preparation.
[Official Apps Script requirements](https://developers.google.com/apps-script/api/how-tos/execute).

The Vercel dashboard is authenticated as the project owner. A fresh CLI device login
still displayed disabled Allow Access after the optional account-security reminder
was dismissed. No disabled control was bypassed, token extracted, security setting
changed or new permission granted. The waiting login was cancelled. Native editor
navigation also showed stale accessibility state: a transient unsaved space was
immediately undone, Save became disabled, no save was submitted, and independent
API readback still matched exact v56. Use visual confirmation before executing any
selected native function; never trust a stale selected-function accessibility label.

## Web preparation and timing

Prepared preview for the prior release SHA `51a0bb41c2a659e7430b370b68b31449e22dc056`:
`dpl_GRXM6jmSsy79aTzXRwLxxFuV1eRx`, READY. `/api/health` returned HTTP200/no-store,
exact sourceRevision, but **dataMode=not-configured**. It is not a production-env
staged artifact and cannot validate backend integration. A subsequent tooling commit
gets its own automatic preview; always bind the final immutable SHA, not this old ID.

Observed create→READY seconds for eight PR80 Git previews:
27.104, 26.237, 27.067, 28.224, 27.758, 26.559, 27.460, 26.849.
Empirical nearest-rank p95 of this sample = 28.224 s; build-only maximum 26.405 s.
These are preview samples (n=8), not a production service-level bound.

Preview promotion rebuilds with production environment values. Instant no-rebuild
promotion requires a staged **production** build with domain auto-assignment disabled.
Instant rollback reassigns domains to a previously served production deployment.
[Official promotion distinctions](https://vercel.com/docs/deployments/promoting-a-deployment),
[Instant rollback](https://vercel.com/docs/instant-rollback).

Therefore the existing preview cannot remove build time from the current approved
Git flow. Production staging would require a separately reviewed change to deployment
coordination/auto-assignment to avoid a later duplicate automatic main deployment.
No such change was made. Do not replace supported promotion with a raw alias of a
preview that lacks production environment configuration.

## Executable rollback rehearsal

`rollback-executor.mjs` is executable orchestration with injected, already prepared
service adapters. It refuses to close before every adapter is present. Sequence:

1. CLOSED and independent readback with a new drain timestamp.
2. Wait at least 420 s in chunks ≤30 s; fresh original-context drained inventory.
3. PUT exact full56 HEAD; independent exact-source GET; restore existing56 mapping,
   independent config GET. Do not restore the production Sheet.
4. Instant-rollback Web to exact prior56 deployment; confirm READY/deployment/SHA.
5. CLOSED runtime and read-only reconciliation: business effects zero, safety clean,
   only exact separately approved pre-existing v56 issue fingerprint.
6. Guarded OPEN/readback; safe v56 signed commands `/start`, `/clients`, `/balances`,
   `/debt`, `/report`; final reconciliation. **Never `/today` or `/attention` on v56.**
7. Failed post-open proof closes again and reports failure, never a safe-success label.

Non-production tests execute adapter calls and verify missing adapters, new full
drain, source mismatch, pending operation, transport deadline, lost successful PUT
response without duplicate retry, and failed signed smoke. Live transport adapters
for native interlock/signed smoke/Vercel rollback are not all connected. Thus fixture
PASS is not FULLY EXECUTABLE production rollback. A timeout with an outstanding
provider effect requires independent readback; never race a new attempt against it.

## Window admission

Preparation moved outside CLOSED: code, source payloads, immutable numbered57,
release metadata/commit, CI, source comparison, existing recovery validation,
Calendar collector, authenticated dashboard/Telegram tabs, and rollback rehearsals.
No code or commits may be assembled during a future window.

Two mandatory drains alone require **14 min**. Actual transport and signed-smoke
worst-case totals are still unproved; a ≤30-minute admission is therefore **NO**.
The existing conservative policy remains activation 28.5 + rollback 28.5 + slack15
= 72 min; it is an operational timeout allowance, not measured runtime. No ceilings
were reduced merely to make the table fit. Retaining the earlier extra15-minute
slack leaves only1 minute for all non-drain work inside30; that cannot be claimed
safe from current evidence. A future revised budget must explicitly identify the
reserve policy rather than silently discard it.

The admission function now additionally enforces the requested30-minute ceiling:
the old72-minute plan is rejected even if a caller supplies a longer available gap.

No next release attempt/window is admitted. The next useful observation is the
natural sync expected around **15:21 Moscow**, followed by fresh evidence. A nominal
15:25–15:55 interval is only a calendar gap, **not an approved safe window**: readiness
and the full timing bound are absent; trigger timing itself is not an exact guarantee.
The next watchdog expected window starts around16:10. Schedule remains unchanged.

Maintenance-pause proposal is deliberately deferred: excessive estimates due to
unproved transports do not establish that optimized execution objectively cannot
fit. No trigger should be paused to conceal unfinished release preparation.

## Remaining engineering work before YES

1. Supported repeatable native cursor/safety collector adapter with independent
   before/after receipt, and measured native CLOSED/drain/OPEN UI cycle on safe staging.
2. Working supported Vercel mutation authentication/path and a proven exact56 rollback
   readback; decide production-staging coordination only through a reviewed change.
3. Complete signed Telegram/MiniApp read-only rehearsal and measured upper bounds.
4. Recompute window admission from those receipts; fresh recovery/package/identities
   immediately before a separately authorized attempt.

Final code CI must be green; final SHA and current Vercel preview identity are recorded
in the local operational checkpoint after this commit exists. Runtime candidate stays
unchanged. No production switch is authorized by this document.

CRITICAL WINDOW ≤ 30 MIN: NO

ROLLBACK FULLY EXECUTABLE: NO

INTERLOCK PATH READY: NO

VERCEL PATH READY: NO

SIGNED SMOKE PREWARMED: NO — authenticated and partially exercised, full sequence unproved

READY TO EXECUTE v57: NO
