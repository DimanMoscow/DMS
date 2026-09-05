# Current project state

Last verified: 2026-09-05 (Europe/Moscow).

## Confirmed production

- `main` contains the client-progress/enrollment UX, Calendar-driven onboarding,
  and the production Apps Script runtime verifier. MiniApp release `0.2.7` can
  verify the active Apps Script source through its server-only configured URL.
- MiniApp production follows Git-linked `main`. The release gate requires `/`,
  `/client`, `/api/health`, and `/api/apps-script-runtime` to return HTTP 200;
  health must report release `0.2.7`, fingerprint
  `miniapp-r8-apps-script-runtime-probe`, the exact serving source SHA, and
  `dataMode: connected`.
- Apps Script production uses the existing deployment on numbered version `v49`.
  Its runtime implements signed server-authoritative `admin` / `client` / `unlinked`
  entry resolution, hashed single-use enrollment, one-to-one bindings, and append-only
  trainer measurements. `v46` added server-side no-op measurement correction rejection;
  `v47` added Calendar onboarding, debt-formula integrity, and redacted API errors;
  `v48` makes matching repeated new-client resolution idempotent; `v49` accepts
  the canonical one-off conditions written by onboarding, validates Queue sources,
  and prevents new clients from duplicating the Debt spill formula.
- The two-client controlled pilot is complete. Production contains exactly two active
  bindings for the two approved clients, with two distinct Telegram identities. The
  invitation audit has five rows: three `revoked`, two `used`, and zero `pending`.
  Measurements remain zero.
- B-side live evidence contains a successful atomic enrollment and client bootstrap,
  ordinary linked-client re-entry, and replay denial. A-side ordinary re-entry was
  already confirmed after the role-routing rollout. Automated gates cover A/B data
  isolation, unlinked denial, selector rejection, client/admin separation, replay,
  expired/revoked states, and the document-lock race contract.
- Post-onboarding read-only reconciliation reports zero Calendar ↔ Queue ↔ Journal
  issues across 85 queue rows, 109 journal rows, and 95 Calendar events.
- The Debt `ARRAYFORMULA` is restored at the sole canonical `Клиенты!J5` anchor. The
  conflicting formula in the spill range was removed without changing payment or block
  amounts, and the new live guard passes.
- The approved unknown-client queue case was resolved from an explicit administrator
  preview as a new one-off client. It produced exactly one payment and one Journal row,
  preserved the approved Calendar alias, and created no block or future Hybrid product.
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
  connectivity, public routes, health `no-store`, the allow-listed Apps Script runtime
  identity, and fail-closed `/api/dms` responses. Every API response in those paths must
  carry `Cache-Control: no-store`.
- The full repository gate passes 86 tests and covers a high-severity dependency audit, lint,
  TypeScript, production build, Apps Script candidate/snapshot integrity and production
  pointer, and the applied-migration ledger.
- GitHub and Vercel release behavior is explicit: pull requests receive Preview
  deployments and an approved merge to `main` automatically deploys Production. The
  repository exposes `release:check`, `release:verify`, and an ignored, non-sensitive
  local release-checkpoint command. Migration packages now carry machine-checked
  preflight, post-check, rollback, and approval metadata.
- Vercel Preview is isolated from production data: the audited PR Preview reports
  `dataMode: not-configured`, and its Apps Script runtime endpoint fails closed because
  the production backend environment is absent.
- The existing authenticated admin diagnostics view now combines MiniApp identity,
  Apps Script runtime identity, queue waiting/error/registration counts, the read-only
  live gate result, trigger count, and last-check time. It exposes no identifiers or
  client, medical, or financial records.
- Next.js and `eslint-config-next` are pinned to `16.3.4`. The upgrade removes the
  audited Next.js/PostCSS/Sharp findings, including the vendor-published `16.3.3`
  critical security fixes, without changing application code.
- Apps Script source verification canonicalizes LF/CRLF while rejecting lone carriage
  returns, so Windows and Linux prove the same immutable source hashes. Offline release
  plans remain explicitly non-deployable until separate Google authorization verifies
  remote state.
- The repository records two confirmed applied portal migrations by immutable artifact
  digest. A private Drive-copy contract and restore runbook exist, but no new production
  backup was created.

## Calendar onboarding release

`apps-script/versions/v46` through `v49` are immutable sanitized snapshots of the
numbered releases. Production `v49` passed the 17-check read-only gate with zero
reconciliation issues. Queue validation accepts both `Требует регистрации` and
`MiniApp` as the resolution source; the Debt guard requires `Клиенты!J5` to remain the
only formula anchor in its spill range.

## Remaining risks and next step

- Real measurements still require an explicit authenticated trainer action. No real
  measurement values have been entered.
- A later confirmed Calendar entry may start Hybrid onboarding, but no Hybrid block
  exists until that separate entry and its terms are explicitly confirmed.
- Telegram confirmation callbacks are not yet bound to a per-flow nonce/message. A
  focused security-hardening stage should prevent an old confirmation button from acting
  on newer cached state and add durable idempotency keys for payment/calendar mutations.
- Continue with read-only invitation history without introducing client-side writes.
