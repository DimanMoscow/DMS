# Current project state

Last verified: 2026-09-06 (Europe/Moscow).

## Confirmed production

- MiniApp release `0.2.7` follows Git-linked `main`. Before this checkpoint PR,
  production served source `b7933d01d94478b85d45fbb2281ced3a2fd5c3f6`; `/`, `/client`,
  `/api/health`, and `/api/apps-script-runtime` returned HTTP 200, health reported
  `dataMode: connected`, and APIs remained `no-store`.
- Apps Script Production is numbered `v50`. Official Google API read-back proved
  candidate → HEAD → numbered version → production deployment identity. The live
  runtime reported the expected Telegram confirmation module fingerprint and loaded
  handler. The read-only gate passed `17/17`; reconciliation reported `0` issues.
- Production has Clients 18, Blocks 15, Payments 21, two active bindings, invitations
  3 revoked / 2 used / 0 pending, and measurements 0. The latest live check counted
  Queue 94, Journal 115, and Calendar 104; one queue row was waiting and none had an
  error or registration state.
- Calendar-driven onboarding remains active. The Debt formula has one canonical anchor
  at `Клиенты!J5`, its guard passes, and `Q-0085` remains processed exactly once.
- `telegram-confirmations-v1` is applied. The empty 13-column append-only
  `Журнал операций Telegram` is the sixteenth production sheet. The v50 release made
  no payment or Calendar mutations.
- A complete private post-migration Drive backup and a separate isolated restore copy
  were read back through official Google APIs. All 16 sheets, metadata, and cell values
  matched exactly. Private manifests and identifiers remain outside Git.

## Release and access controls

- Runtime identity now includes the confirmation-module hash and handler-loaded marker.
  The repository gate verifies the v50 candidate/snapshot, production pointer, applied
  migration ledger, dependency audit, tests, lint, TypeScript, and production build.
- Local Google operations use two official Desktop OAuth clients and two profiles:
  reader with the exact read-only scopes and writer with the exact release scopes.
  Credentials, target identifiers, backups, and reports are stored outside Git. OAuth
  Playground and Work are no longer required for Apps Script releases.
- The Google Auth Platform app is currently in Testing. Google may expire Testing-mode
  refresh tokens after about seven days, so an official local reauthorization may be
  required until the app's branding and publication requirements are completed.
- GitHub `main` requires a pull request and the `release-gate`, requires the branch to
  be current, blocks force-push and deletion, and permits zero required approvals for
  explicitly authorized Codex merges. Merged head branches are deleted automatically.
- Vercel Preview remains isolated from production data. A merge to `main` automatically
  creates the Production deployment; no manual promotion is part of the normal flow.

## Constraints and next stage

- P1 remediation is authorized and in progress; see `docs/P1_REMEDIATION.md`.
  The starting main and READY Vercel Production source were freshly verified as
  `178a3503a11ed7c02e65fca52010cc0bb0f23007`. Authenticated Google read-back still
  matched numbered v50 and an empty operation ledger. Candidate v51 contains the
  ingress fix only at this checkpoint and has not been deployed.

- Create measurements only through an explicit authenticated administrator action.
- Do not create the pending Hybrid product until a separate confirmed Calendar start
  and explicit terms exist.
- Do not change prices, business rules, or weaken the client/admin access model.
- The v50 security rollout is complete. Start no new functional stage from this
  checkpoint without a new explicit instruction.
