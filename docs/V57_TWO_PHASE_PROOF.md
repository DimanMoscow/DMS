# Two-phase rollout contract — preparation only

Backend remains exact v56; interlock OPEN. PR80 stays draft/unmerged.
No Apps Script HEAD/mapping/version or Web switch occurred.
No client/payment/attendance/block/alias data writes were performed.

## Separate Web artifact

Local branch `codex/v56-v57-transition-web`, based on exact main, has commit
`08c41e7bb451e2ad31f6e098850252b0d7c016f9`. Its production pointer remains v56.
The fixed transitional verifier accepts only the exact verified v56/v57 runtime
fingerprints and existing loaded markers. Numbered sources and the Web commit
are bound by the immutable phase manifest and external artifact receipt.
Both actual numbered bundles pass the same signed Web handler and read-view tests.
Unknown runtime, altered fingerprints and missing markers fail closed. Optional
v57 history/registration fields are absent, not invented, on v56.
Local Web gate: 324 tests, lint/types/build/dependency audit/snapshots/migrations PASS.

The separate Web branch is published as draft PR84 after exact-diff privacy review
and owner authorization. It is not merged or deployed to production. Publication
of the generic tooling is separate from authorization for a production switch.

## Native collector

`native-browser-reader.mjs` uses supported browser APIs to read only the three
allowlisted Script Properties and run the existing read-only original-document
inspector. No private RPC, helper deployment, extra scope or security bypass.
`native-ui-channel.mjs` connects it to the collector using separate nonce/time-bound
request/response files outside Git. The agent relays the browser receipt locally;
this is an agent-mediated browser adapter, not an unattended REST endpoint.

The collector checks owner/project, native completion, exact cursor, generation,
two independent fresh reads, actual immutable source, actual v56/v57 planners,
raw incremental/wide Calendar pages with showDeleted, all 17 Queue values,
financial/semantic/alias/duplicate/durable safety, issue identities and revisions.
Saved receipt mode remains DIAGNOSTIC_ONLY. Missing, expired, mismatched or failed
native evidence cannot issue acceptance. Runtime candidate and P1 are unchanged.

Live capture and acceptance receipts belong outside Git. A release-capable package
must bind the complete known issue set, exact proposed writes and source identity.
It expires after five minutes and is not approval for a later retry: recollection
and separate exact approval are required.

## Interlock rehearsal requirements

Require explicit owner authorization for the temporary production outage. Check
that no scheduled or mutating execution is running before CLOSED. Independently
read the closed marker, record a fresh drain timestamp, wait the full 420 seconds,
then use the existing guarded OPEN action and independently read back the state.
Keep source, mapping and Web unchanged throughout this isolated rehearsal.
Preserve private before/after property and business-data evidence outside Git.
A partial close/restore must never be presented as a completed drain proof.

The owner-authorized native CLOSED/full-drain/guarded-OPEN rehearsal passed on
unchanged v56. Independent readbacks verified closure, a fresh drain timestamp,
guarded reopening and restoration of every original Script Property. Private
timing receipts remain outside Git. This proves the transport cycle, not a
maximum duration for the complete activation and rollback sequence.

## Backend-only rollback

Native trigger configuration shows the project's head deployment for every
scheduled handler. Therefore stage/readback HEAD57 is necessary for natural v57
sync; restore HEAD56 AND mapping56 is necessary after regression. Changing only
the Web-app mapping cannot control installable triggers. The same transitional
Web accepts either backend, so no Vercel switch/build is needed in this path.

The rollback executor now has a separately verified transitional-Web mode. It
checks the unchanged Web before closure, enforces a new 420-second drain,
restores exact HEAD and mapping, and independently verifies the unchanged Web,
runtime, reconciliation and safe signed reads. `/today` and `/attention` stay
excluded from v56 Telegram rollback smoke. Fixtures cover this complete path,
missing adapters, changed identity, timeout, lost response, pending operations,
and reclosure after failed signed smoke. No production rollback was run here.

## Critical-window ceilings and remaining admission

| Step | Activation ceiling, seconds | Tool/path |
|---|---:|---|
| CLOSED + independent readback | 60 | Prepared native settings + inspector |
| Fresh drain | 420 | Native drain timestamp, no shortened wait |
| Drained inventory | 30 | Existing original-context inspector |
| Exact HEAD stage/readback | 30 | Owner Apps Script API |
| Existing mapping/readback | 30 | Owner Apps Script API, numbered57 already exists |
| Runtime/GET identity | 30 | Public GET + owner identity receipts |
| Guarded OPEN/readback | 60 | Existing native activate function + independent read |
| Signed read-only smoke | 180 | Prepared Telegram/MiniApp browser sessions |
| Reconciliation | 30 | Owner reader + native evidence |
| **Activation subtotal** | **870 = 14:30** | No Web build/deploy |
| **Rollback reserve** | **900 = 15:00** | Same steps + unchanged-Web read, no Web switch |
| **Total** | **1770 = 29:30** | Proposed admission ceilings |

These are ceilings, NOT a measured live worst-case. The native cycle is proved;
bounded end-to-end signed smoke and all production transport deadlines remain
unproved as a complete release sequence.
`two-phase-window.mjs` refuses admission until every live step has evidence and
the complete reserve fits before the next natural process. No browser setup,
OAuth discovery, commit editing or Web build belongs inside the admitted window.
Timeout/ambiguous mutation responses require independent readback, not blind retry.

Select a window only after naturally completed watchdog and Calendar sync, no
running executions, fresh evidence and the separately pre-deployed compatible
Web. Keep concrete schedules and operational timing receipts outside Git. Trigger
timing is not a guarantee; if any natural run is late or proof is absent, reject
the window.

## Subsequent phase

After a future successful activation, observe natural source-bound v57 sync.
Its advanced generation must succeed with completed matching post-sync evidence
and reconciliation=0. The pre-existing drift exception is then consumed, never
renewed or replaced by a fabricated zero. Only a separate later Web-only commit
may remove v56 from the allowlist. No forced sync, feature work or trigger changes.

For watchdog evidence, uninstrumented nested metrics must not be interpreted as
zero phase cost. Preserve natural run evidence privately and keep the performance
risk open until sufficient observations meet the release policy.

TRANSITIONAL WEB v56+v57 SAFE: YES (actual-bundle isolated proof)
UNKNOWN RUNTIME FAIL-CLOSED: YES
COLLECTOR RELEASE-CAPABLE: YES (supported browser adapter, fresh live proof)
INTERLOCK CYCLE PROVEN: YES
INTERLOCK PATH READY: YES (prepared authenticated native UI)
CRITICAL WINDOW <=30 MIN: NO (29:30 target; live maximum not proved)
ROLLBACK WITHOUT WEB SWITCH: YES (fixture proof; HEAD + mapping required)
READY FOR TWO-PHASE v57 RELEASE: NO
