# Current project state

Last verified: 2026-09-07 (Europe/Moscow).

## Confirmed production

- Apps Script Production is numbered `v51`. Official Google API read-back matched all
  21 snapshot files and candidate tree
  `4893e98864e18bd879597ce2f1c32a000e5e04ee2d1f25a324fc22dc0729103b`.
  The original bound-document inspection at `2026-09-07T20:42:35Z` reported the
  shared ScriptLock and DocumentLock available, zero legacy tickets in Script or
  Document Properties, no quota warning, and `mutationReady: true`.
- The public runtime identity matched the v51 router, client portal, and aggregate
  confirmation-safety fingerprints through the MiniApp proxy at
  `2026-09-07T20:46:30Z`. The exact Git-linked MiniApp production deployment served
  connected health, `/`, `/client`, and both JSON probes with HTTP 200; health and
  runtime responses remained `no-store`. The repository checkpoint removes the
  temporary v50 runtime bridge and pins the proxy to v51.
- The original-context read-only live gate passed `17/17` at
  `2026-09-07T20:40:44Z`. The independent financial guard reported zero formula
  issues and zero numeric mismatches. The dedicated Calendar ↔ Queue ↔ Journal
  reconciliation at `2026-09-07T20:41:53Z` reported zero issues across 98 queue
  rows, 115 journal rows, and 101 Calendar events.
- Production has 18 Clients, 16 Blocks, and 21 Payments at the migration checkpoint.
  The 17-column append-only Telegram operation ledger is active. Its first seven
  post-activation events were three tickets and two accepted operations followed by
  two safe `underlying_state_changed` rejections for `confirm_day`; both recorded
  `no_mutation`. There were no `started`, `result`, `committed`, or `manual_review`
  events in that count-only inspection.
- `telegram-confirmations-v2` and `financial-formulas-v1` are applied. The ledger
  migration preserved all historical rows and added four columns. The financial
  migration installed nine shared anchors, preserved every input cell, and passed
  the live numeric guard. These migration writes did not create a payment, change a
  Calendar event, record a measurement, or change a client binding.
- A final owner-only v51 recovery copy and a separate restore copy were verified at
  `2026-09-07T20:50:01Z`. All 16 required sheets, metadata, entered values and
  formulas, formats, validations, and notes matched. Private manifests, credentials,
  target identifiers, operational URLs, and raw ledger rows remain outside Git.

## P1 result

- P1.1 rejects malformed or oversized ingress before authentication and before any
  Sheets audit write; platform logs are fixed and redacted.
- P1.2/P1.4/P1.5 use immutable cf2 tickets and payloads in the append-only ledger,
  one project-wide ScriptLock, durable ticket → pending → started → result → committed
  transitions, positive-effect recovery, fail-closed manual review, and bounded
  legacy-property cleanup with read-back before deletion.
- P1.3 replaces generic destructive range undo with versioned domain compensations
  that preserve IDs and history and reject dependency or state drift before writing.
- P1.6 removes fixed financial history horizons. Shared anchors cover occupied IDs
  and complete Payments/Journal history; the independent numeric guard verifies the
  displayed balances instead of trusting formula text.
- The final candidate passed 174 repository tests, all fault-injection and isolated
  Sheets scenarios, the high-severity dependency audit, lint, TypeScript, production
  build, snapshot verification, migration integrity, live `17/17`, and zero-issue
  reconciliation. No unresolved P1 blocker or new security/race ambiguity remains.

## Release and access controls

- GitHub `main` requires a current pull request and the `release-gate`, blocks force
  push and deletion, and permits zero required approvals for an explicitly authorized
  Codex merge. Merged head branches are deleted automatically.
- Vercel Preview has no production data. A merge to `main` automatically creates the
  Production deployment; no manual promotion is part of the normal flow.
- Google operations use separate reader and writer Desktop OAuth profiles with exact
  scopes. The Google Auth Platform app remains in Testing, so its refresh tokens may
  require periodic official local reauthorization.
- Production recovery uses private owner-only Drive copies. At least three copies are
  retained for at least 30 days; deletion requires separate approval.

## Constraints and next stage

- P1 remediation is complete. Preserve the v51 snapshot, migration ledger, private
  recovery evidence, and append-only operation history.
- Create measurements only through an explicit authenticated administrator action.
- Do not create the pending Hybrid product until a separate confirmed Calendar start
  and explicit terms exist.
- Do not change prices, business rules, or weaken the client/admin access model.
- P2 and new product work require a separate explicit instruction and should start in
  a fresh Codex task after recovering this state from Git and live read-only checks.
