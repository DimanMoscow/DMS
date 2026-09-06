# DMS Fitness handoff

Last audited: 2026-09-06 (Europe/Moscow).

Use `origin/main`, `AGENTS.md`, relevant current `docs/*`, and live service state.
Old chats, old handoffs, and non-main branches are not authoritative.

## Checkpoint

- Resolve the Git SHA from current `origin/main` at session start.
- MiniApp release `0.2.7`, fingerprint `miniapp-r8-apps-script-runtime-probe`, public
  routes, connected health, source SHA, `no-store`, and Apps Script identity must pass
  the production verifier after each approved merge.
- Apps Script Production is `v50`. Official API read-back proved HEAD, numbered version,
  deployment mapping, and runtime identity. The read-only live gate passed `17/17` and
  reconciliation is `0`.
- Latest production counts: Clients 18; Blocks 15; Queue 94; Journal 115; Calendar 104;
  Payments 21; bindings 2 active; invitations 3 revoked / 2 used / 0 pending;
  measurements 0. Queue has 1 waiting, 0 errors, and 0 registration rows.
- `telegram-confirmations-v1` is applied. `Журнал операций Telegram` exists with the
  exact 13-column schema and 0 data rows. The v50 rollout performed no payment or
  Calendar smoke mutations.
- A complete 16-sheet private Drive backup and an isolated restore copy match exactly.
  Recovery manifests and all Google identifiers remain outside Git.
- Official local Google OAuth is split into reader and writer profiles under the private
  operations directory, conventionally `${DMS_PRIVATE_CHECKPOINTS}/google-auth/`.
  The profiles use exact scopes and Apps Script release no longer depends on Work or
  OAuth Playground. The Google app is still in Testing, so periodic official
  reauthorization may be required until publication prerequisites are completed.
- Calendar onboarding and the sole Debt formula anchor at `Клиенты!J5` remain healthy;
  `Q-0085` was processed exactly once.

## Constraints

- Do not create the pending Hybrid product before a separately confirmed Calendar start.
- Create measurements only through explicit authenticated admin action.
- Do not change prices, business rules, or weaken client/admin access.
- Start no new functional stage without an explicit instruction.

Release procedure is in `docs/RELEASE_OPERATIONS.md`; recovery is in
`docs/DISASTER_RECOVERY.md`.
