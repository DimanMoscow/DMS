# v57 retry admission — BLOCKED, 14 September 2026

Historical second-attempt checkpoint. Subsequent preparation fixes the metadata
contract without production changes; see
[V57_RELEASE_TOOLING_PREPARED](V57_RELEASE_TOOLING_PREPARED.md). The owner has not
authorized a third attempt; exact v56 remains OPEN and PR #80 remains draft.

The owner authorized the corrected release in **12:25–13:10 Moscow**, with
initial activation and signed smoke complete by **12:45**. This attempt did not
close the interlock, stage HEAD, switch a deployment, or merge main.

## Why no production switch was admitted

Work began at **12:30:14 Moscow**. Fresh identity, recovery and Calendar checks
passed, but the previous temporary control tab no longer existed. Reclaiming the
owner tab and navigation also timed out. With the release commit and signed
smoke sessions not yet prepared, completing the mandatory seven-minute drain,
source/mapping/Web operations and the full verified signed smoke by 12:45 could
no longer be assured. The window was declined before closing, not shortened or
extended into its rollback reserve. This is not a v57 regression or a rollback.

A second preparation gap was found before any code switch: the actual snapshot
verifier (`apps-script/scripts/verify-snapshots.mjs`) asserts
`production.lastVerified.reconciliationIssues === 0`. The corrected procedure
explicitly permits three enumerated, pre-existing horizon omissions until the
next natural v57 ingestion. A truthful intermediate release-pointer observation
with count 3 is rejected by the current verifier. The existing pointer's old
zero is historical v56 evidence, not fresh v57 evidence.

This rejection was reproduced by running the **actual verifier** with only the
locally supplied JSON observation changed to 3; it failed with actual 3 / expected
0. No file in production or source bundle was altered. Do not falsify the count,
reuse an old timestamp as fresh v57 acceptance, weaken P1, bypass required checks,
or force sync solely to make it zero. Before another activation, prepare and
verify an honest release-metadata/acceptance contract and the exact Web release
commit. The earlier procedure YES proved the interlock ordering and candidate;
it did not establish this intermediate metadata compatibility.

**READY TO EXECUTE THE RETRY: NO** until these preparation gates are resolved
and a new permitted window has enough time. The owner-authorized window is not
silently moved. Candidate source remains unchanged and is not blamed.

## Fresh evidence from this attempt

| Gate | Observed result |
|---|---|
| Owner source at 09:32:17Z, repeated 09:37:51Z | HEAD and numbered/mapping exact v56; numbered 57 exact candidate, 26 files, inactive |
| Candidate tree | `332ef8a3c8672293598704abf62ee445b496d29d5bbddd4f4f98a9b1c404220c` |
| GitHub main / Vercel | `4ab73e2103e85c3e0dd199ac220db51d2ccd61d3`, Vercel READY; PR #80 draft/unmerged |
| Private recovery | Two new owner-only copies; all 16 sheets; source/backup equality verified 09:31:33.795Z |
| Isolated restore | Equal to backup, verified 09:31:49.567Z; prior copies retained |
| Recovery fingerprint | `abf85fe4e37c077be3cd5b401df539995ad1b39a48c18158dda60229ae722af8` |
| Calendar preview 09:33:20.427Z | Live cursor 09:21:11.049Z; incremental 0; wide 132 including 19 cancelled; pagination complete |
| Planned writes | v56 0; v57 **3 pending additions + 8 identical rewrites**, cancellation/error 0; preview only |
| Runtime/Web GET 09:36Z | HTTP 200, no-store, exact v56 runtime and main revision |
| POST ingress | Deliberately invalid auth on bootstrap returned backend JSON **401 invalid_init_data**, proving ingress remains OPEN; this is not successful signed smoke |
| Business comparison 09:21:43Z → 09:37:51Z | Counts equal, duplicate IDs 0, unexpected changed cells 0; only 72 individually verified NOW() cells moved |
| Existing CI | `425eda7f1a3140969d1c9fa10b25b8eff4369f35`, run 34827704759 SUCCESS; preceding fixture change passed 351 + 47 |

Source/runtime release is **emergency-semantic-recovery**, numbered **56**.
Router `845880a146750df5f7d94ceae4ddfcb533fe2f995d566b26a1635630721ffbd7`;
portal `763e56aebc3bd07db8bae8e70e33e40ea3ab29856f7fb9ed408c482e979e4b98`;
confirmations `cdf03fac0af9b7757c0ba5090817fadac35819ff9685c4afba6ac4590b1fbb7e`.
Both handler-loaded flags are true.

| Business entity | Before | After |
|---|---:|---:|
| Clients | 21 | 21 |
| Blocks | 19 | 19 |
| Payments | 35 | 35 |
| Journal | 137 | 137 |
| Queue | 125 | 125 |

No pending row was added by this task. The 3+8 set remains an approved preview;
the existing three horizon omissions remain visible on v56. The previous exact
local projection proves zero reconciliation issues after the proposed ingestion;
it is not presented as current live zero reconciliation.

Telegram and signed Admin MiniApp production-release smoke: **NOT RUN**, since
activation never started. Web/runtime and the auth-negative ingress check passed.
No `/today` or `/attention` request was sent to v56 for smoke.

## Effects and retained risk

- Production code/config/interlock/trigger changes: **0**.
- Production Sheet/Calendar/client/block/alias/payment/attendance mutations: **0**.
- External changes: two private recovery/restore copies; repository checkpoint
  documentation and PR status description. No main merge, deploy or new version.
- OAuth/consent: existing reader, writer and Calendar read-only profiles refreshed
  normally; no new scope, access grant, API enablement or terms acceptance.
- F09 **OPEN**: latest observed natural v56 watchdog remains 34.120 s overall /
  32.367 s health, after 12.208 and 18.978 s. The two increases warrant performance
  investigation; no synthetic run, alert suppression or new feature was introduced.

RELEASE BLOCKED — PRODUCTION LEFT SAFE
