# Current project state

Last verified: 2026-09-02 (UTC).

## Confirmed state

- Current `origin/main` is the repository source of truth.
- MiniApp production release is `0.2.1`; Vercel deployment
  `dpl_GHqWQ9F6s1H1jawKbvxopskcXSUE` is healthy and `/api/health` reports HTTP 200
  with `dataMode: connected`.
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
  corresponding MiniApp UI is merged in `main` but still requires a new Vercel
  production deployment.
- The production client action is recognized: an invalid signed-data fixture returns
  `invalid_init_data`, not `unknown_action`, and the response is `Cache-Control:
  no-store`.
- The Apps Script admin authentication/bootstrap self-test is green. The complete
  read-only gate passes 15 of 15 checks; Calendar ↔ Queue ↔ Journal reconciliation has
  zero issues across 78 queue rows, 97 journal rows, and 87 calendar events.
- Local `npm run check` and CI cover MiniApp lint, tests, TypeScript, build, Apps Script
  snapshot integrity, client isolation, and runtime identity code.

## Open risk and next step

The next release step is a Vercel production deployment of current `main`, followed
by admin, invalid-invite, unlinked-client, and cache-policy smoke. The two-client pilot
remains blocked until that smoke is green; no real invite, binding, or measurement has
been written.

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
