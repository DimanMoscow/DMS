# Current project state

Last verified: 2026-09-04 (UTC).

## Confirmed production

- `main` includes the merged client-progress/enrollment UX and Apps Script measurement
  guard candidate. The exact serving SHA is reported by `/api/health` and must match
  Vercel deployment metadata at every rollout.
- MiniApp production follows Git-linked `main`. Its verified deployment is `READY`;
  `/`, `/client`, and
  `/api/health` return HTTP 200. Health reports release `0.2.4`, fingerprint
  `miniapp-r5-progress-enrollment-guard`, the exact source SHA, and
  `dataMode: connected`.
- Apps Script production remains the existing deployment on numbered version `v45`.
  Its runtime implements signed server-authoritative `admin` / `client` / `unlinked`
  entry resolution, hashed single-use enrollment, one-to-one bindings, and append-only
  trainer measurements.
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
  across 85 queue rows, 108 journal rows, and 75 active Calendar events in the bounded
  connector view. Enrollment did not write to those three systems.
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
- The full repository gate passes 52 tests plus lint, TypeScript, production build, and
  Apps Script candidate/snapshot integrity.

## Prepared next Apps Script release

`apps-script/candidates/v46` is a reviewed, complete 16-file candidate. It adds two
integrity guards without schema or data migration: identical corrections are rejected
under the document lock before append, and Client Portal error codes/statuses survive
the shared admin API boundary. Production remains on `v45`; publishing `v46` requires
an authenticated Apps Script editor/API write path and the usual runtime identity,
15/15 gate, reconciliation, and rollback checks.

## Remaining risks and next step

- Deploy candidate `v46` only after Google authentication is available; the current
  cloud browser requires the account password, so no Apps Script HEAD/version/deployment
  write was attempted.
- Real measurements still require an explicit authenticated trainer action. No real
  measurement values have been entered.
- After `v46`, the next useful low-risk step is read-only invitation-history presentation
  in the admin card (statuses and audit timestamps only, never token hashes or Telegram
  identities), followed by fixture-based visual regression coverage for progress UX.
