# Current project state

Last verified: 2026-09-02 (UTC).

## Confirmed state

- Current `origin/main` at `b54c32b15a2f53180a1c63d369e829235d1256af` is the
  repository source of truth.
- MiniApp production release is `0.2.1`; Vercel deployment
  `dpl_6KAzsKKu1xFHr1JSiaZdCd2JnqJq`, built from the Git-tracked MiniApp files at
  that commit, is `READY`. Its immutable URL and production alias both return HTTP
  200 from `/api/health` with `dataMode: connected`; `/` and `/client` also return
  HTTP 200.
- Vercel Production has the required server-only `DMS_APPS_SCRIPT_URL`; its value stays
  outside Git.
- Apps Script production uses the existing web-app deployment on numbered version
  `v44`. Its three changed files were copied byte-for-byte from
  `apps-script/candidates/v44` with only the two documented operational URL
  substitutions. The numbered deployment was created only after the complete
  read-only gate passed 15/15 with reconciliation at zero.
- Numbered `v42` is retained as a historical incident artifact and is not deployed. Its
  stored source contained `client_portal_bootstrap`, but the serving runtime
  reproducibly returned `unknown_action`. Republishing the same router/client module in
  `v43` with an explicit identity marker produced the expected runtime.
- Numbered `v41` is a damaged historical release artifact and was never deployed.
- `apps-script/versions/v42`, `apps-script/versions/v43`, and
  `apps-script/versions/v44` preserve the sanitized 16-file numbered sources. The
  snapshot verifier checks their exact trees and reviewed-candidate identities.
- Production sheets `Доступ клиентов`, `Замеры`, and
  `Приглашения Client Portal` exist with the approved schemas. All contain headers
  only: zero client bindings, zero measurements, and zero enrollment invitations.
- The Apps Script runtime includes hashed, expiring, single-use enrollment under a
  document lock and append-only trainer measurements with correction history. The
  corresponding trainer and client MiniApp UI is active in Vercel Production.
- The production client action is recognized: an invalid signed-data fixture returns
  `invalid_init_data`, not `unknown_action`, and the response is `Cache-Control:
  no-store`.
- Authenticated Telegram smoke confirms that a signed `start_param` routes the root
  MiniApp into enrollment and an unknown invitation returns
  `enrollment_invite_invalid`. Runtime logs contain only the allow-listed action,
  request ID, status, error class, and duration; the token, signed `initData`, Telegram
  identity, and PII are absent.
- The Apps Script admin authentication/bootstrap self-test is green. The complete
  read-only gate passes 15 of 15 checks; Calendar ↔ Queue ↔ Journal reconciliation has
  zero issues across 79 queue rows, 97 journal rows, and 88 calendar events.
- Local `npm run check` and CI cover MiniApp lint, tests, TypeScript, build, Apps Script
  snapshot integrity, client isolation, and runtime identity code.

## Open risk and next step

The signed `start_param` release gate is complete. The next controlled step is the
two-client pilot preflight and creation of exactly one pending invitation for each
approved pilot client. No binding or measurement may be created without the client's
own authenticated Telegram action or an explicit trainer write respectively.

## Known limitations

- The Vercel project is not Git-linked; a GitHub merge does not deploy production.
- `package.json` remains `0.2.0`; `/api/health` carries the production release marker
  `0.2.1` separately.
- Apps Script snapshots are sanitized repository copies, not live runtime. Operational
  URLs and Script Properties remain outside Git.
- Exact unsanitized exports are intentionally local-only. No `.clasp.json` or
  repository-to-Apps-Script write workflow is configured.
- Real Telegram bindings and measurements are intentionally absent until a separately
  approved pilot write.
