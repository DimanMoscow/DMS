# DMS Fitness handoff

Last audited: 2026-09-05 (Europe/Moscow).

## Source of truth

Use the current `origin/main`, `AGENTS.md`, relevant current files in `docs/`,
and live service state. Old chats, handoff notes, and non-main branches are not
authoritative.

## Current checkpoint

- `main`: `d8ab59d820cfb807310b6902459e50004cad5595`.
- Vercel Production: `dpl_Hn9XVaYRHTNdkViyfW8KCyAGxU15`, release `0.2.7`,
  fingerprint `miniapp-r8-apps-script-runtime-probe`; source matches `main`.
  `/`, `/client`, `/api/health`, and `/api/apps-script-runtime` return 200;
  APIs are `no-store` and `dataMode` is `connected`.
- Apps Script Production: `v49`; last verified live gate `17/17`.
- Repository gate: `60/60`; reconciliation: `0`.
- Production rows: Clients 18, Blocks 15, Queue 85, Journal 109, Payments 21;
  bindings 2 active; invitations 3 revoked / 2 used / 0 pending; measurements 0.
- Calendar-driven onboarding is active. The Debt formula has one canonical anchor
  at `Клиенты!J5` with no spill errors. `Q-0085` has one Queue row and one
  linked Journal row and was processed once.

## Constraints

- Do not create the pending Hybrid product until a separate confirmed Calendar
  start and explicit terms exist.
- Create measurements only through an explicit authenticated admin action.
- Do not change prices, business rules, or weaken the client/admin access model.
- No new functional stage has started after this checkpoint.

At session start, fetch `origin/main`, read `AGENTS.md` and
`docs/PROJECT_STATE.md`, then recheck live state relevant to the requested work.
