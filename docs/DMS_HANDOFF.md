# DMS Fitness handoff

Last audited: 2026-09-06 (Europe/Moscow).

## Source of truth

Use the current `origin/main`, `AGENTS.md`, relevant current files in `docs/`,
and live service state. Old chats, handoff notes, and non-main branches are not
authoritative.

## Current checkpoint

- Resolve `main` from current `origin/main`; do not copy a SHA from this document.
- Vercel Production follows Git-linked `main` automatically. Release `0.2.7` and
  fingerprint `miniapp-r8-apps-script-runtime-probe` must match the deployed source.
  `/`, `/client`, `/api/health`, and `/api/apps-script-runtime` return 200;
  APIs are `no-store` and `dataMode` is `connected`.
- Apps Script Production: `v49`; last verified live gate `17/17`.
- Repository gate includes dependency audit, Apps Script source/production identity,
  migration ledger, tests, lint, TypeScript, and production build; reconciliation: `0`.
- Production rows: Clients 18, Blocks 15, Queue 85, Journal 109, Payments 21;
  bindings 2 active; invitations 3 revoked / 2 used / 0 pending; measurements 0.
- Calendar-driven onboarding is active. The Debt formula has one canonical anchor
  at `Клиенты!J5` with no spill errors. `Q-0085` has one Queue row and one
  linked Journal row and was processed once.
- Repository candidate `v50` implements Telegram one-time confirmations and exactly-once
  operation handling. It is not deployed. Its required append-only ledger migration is
  catalogued but not applied; production therefore remains exactly on `v49` behavior.
- A private owner-only Drive backup and isolated restore-test copy were verified on
  2026-09-06 against all 15 production sheets. The non-sensitive private manifest stays
  outside Git; backup-reference SHA-256 prefix: `bad0040e`. The Apps Script console shows
  the active production deployment on numbered version `49`.

## Constraints

- Do not create the pending Hybrid product until a separate confirmed Calendar
  start and explicit terms exist.
- Create measurements only through an explicit authenticated admin action.
- Do not change prices, business rules, or weaken the client/admin access model.
- The active stage is security hardening only; no prices, business rules, bindings,
  measurements, or production business rows are changed by the repository candidate.

Release policy, rollback references, staging boundaries, and migration discipline are
defined in `docs/RELEASE_OPERATIONS.md`; private backup recovery is defined in
`docs/DISASTER_RECOVERY.md`.

At session start, fetch `origin/main`, read `AGENTS.md` and
`docs/PROJECT_STATE.md`, then recheck live state relevant to the requested work.
