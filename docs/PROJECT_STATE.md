# Current project state

Last verified: 2026-09-04 (UTC).

## Confirmed production

- `main` at the start of this rollout included the merged client-progress/enrollment UX.
  Release `0.2.5` and the Calendar onboarding UI are prepared behind the full repository
  gate; the exact serving SHA must match Vercel deployment metadata at rollout.
- MiniApp production follows Git-linked `main`. Its verified deployment is `READY`;
  `/`, `/client`, and
  `/api/health` return HTTP 200. Health reports release `0.2.4`, fingerprint
  `miniapp-r5-progress-enrollment-guard`, the exact source SHA, and
  `dataMode: connected`.
- Apps Script production uses the existing deployment on numbered version `v48`.
  Its runtime implements signed server-authoritative `admin` / `client` / `unlinked`
  entry resolution, hashed single-use enrollment, one-to-one bindings, and append-only
  trainer measurements. `v46` added server-side no-op measurement correction rejection;
  `v47` added Calendar onboarding, debt-formula integrity, and redacted API errors;
  `v48` makes matching repeated new-client resolution idempotent.
- The two-client controlled pilot is complete. Production contains exactly two active
  bindings for the two approved clients, with two distinct Telegram identities. The
  invitation audit has five rows: three `revoked`, two `used`, and zero `pending`.
  Measurements remain zero.
- B-side live evidence contains a successful atomic enrollment and client bootstrap,
  ordinary linked-client re-entry, and replay denial. A-side ordinary re-entry was
  already confirmed after the role-routing rollout. Automated gates cover A/B data
  isolation, unlinked denial, selector rejection, client/admin separation, replay,
  expired/revoked states, and the document-lock race contract.
- Post-pilot read-only reconciliation reports zero Calendar ↔ Queue ↔ Journal issues
  across 85 queue rows, 108 journal rows, and 95 Calendar events in the bounded live
  check. Enrollment did not write to those three systems.
- The Debt `ARRAYFORMULA` is restored at the sole canonical `Клиенты!J5` anchor. The
  conflicting formula in the spill range was removed without changing payment or block
  amounts, and the new live guard passes.
- Existing unknown queue item `Q-0085` is no longer a system error. It is the sole
  `Требует регистрации` item; it has no client/block assignment, no Journal row, and no
  financial write. Final resolution awaits an explicit administrator business answer.
- Production logs use bounded request IDs and allow-listed action/status/error fields.
  They contain no raw `initData`, invitation tokens, Telegram identities, client IDs,
  or PII.

## Delivered UX and release hardening

- The read-only Client Portal shows per-metric changes from the previous active
  measurement, with corrections already collapsed by Apps Script. Empty, loading, and
  error states remain read-only and mobile-first.
- Admin enrollment now warns that plaintext links cannot be recovered, offers the
  native share sheet without persistence, explains revoke-and-recreate, and requires a
  second confirmation before revoke. No token is written to browser storage.
- The production verifier now checks release, runtime fingerprint, source SHA,
  connectivity, three public routes, health `no-store`, and a fail-closed `/api/dms`
  error response with `no-store`.
- The full repository gate passes 58 tests plus lint, TypeScript, production build, and
  Apps Script candidate/snapshot integrity.

## Calendar onboarding release

`apps-script/versions/v46`, `v47`, and `v48` are immutable sanitized snapshots of the
numbered releases. Production `v48` has passed the 16-check read-only gate with zero
reconciliation issues. Queue validation accepts `Требует регистрации`; the read-only
sync preview identified only `Q-0085`, and applying that exact write removed the legacy
queue error without touching Journal, Calendar, clients, blocks, payments, bindings, or
measurements.

## Remaining risks and next step

- Real measurements still require an explicit authenticated trainer action. No real
  measurement values have been entered.
- Resolve `Q-0085` only after the administrator chooses New client, Link, or Ignore and,
  for a new client, confirms product and payment terms. No client is inferred from the
  Calendar title.
- Complete Vercel production rollout of release `0.2.5`, then verify the Calendar
  onboarding wizard in the authenticated admin MiniApp without confirming a mutation.
