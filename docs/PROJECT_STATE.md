# Current project state

Last verified: 2026-09-01 (UTC).

## Confirmed state

- Current `origin/main` is the repository source of truth.
- MiniApp production release is `0.2.1`; Vercel deployment
  `dpl_GHqWQ9F6s1H1jawKbvxopskcXSUE` is healthy and `/api/health` reports HTTP 200
  with `dataMode: connected`.
- Vercel Production has the required server-only `DMS_APPS_SCRIPT_URL`; its value stays
  outside Git.
- Apps Script production uses the existing web-app deployment on numbered version
  `v43`. The live runtime identity matches `apps-script/candidates/v43`, including the
  router and client-portal fingerprints and `clientPortalHandlerLoaded: true`.
- Numbered `v42` is retained as a historical incident artifact and is not deployed. Its
  stored source contained `client_portal_bootstrap`, but the serving runtime
  reproducibly returned `unknown_action`. Republishing the same router/client module in
  `v43` with an explicit identity marker produced the expected runtime.
- Numbered `v41` is a damaged historical release artifact and was never deployed.
- `apps-script/versions/v42` and `apps-script/versions/v43` preserve the sanitized
  16-file numbered sources. The snapshot verifier checks their exact trees and their
  identities with the reviewed candidates.
- Production sheets `Доступ клиентов` and `Замеры` exist with the approved schemas.
  Both contain headers only: zero client bindings and zero measurements.
- The production client action is recognized: an invalid signed-data fixture returns
  `invalid_init_data`, not `unknown_action`, and the response is `Cache-Control:
  no-store`.
- The Apps Script admin authentication/bootstrap self-test is green. The complete
  read-only gate passes 15 of 15 checks; Calendar ↔ Queue ↔ Journal reconciliation has
  zero issues across 74 queue rows, 97 journal rows, and 83 calendar events.
- Local `npm run check` and CI cover MiniApp lint, tests, TypeScript, build, Apps Script
  snapshot integrity, client isolation, and runtime identity code.

## Open risk and next step

The runtime/source mismatch is closed by a mandatory live identity gate. The next
functional step is a controlled two-client pilot: dry-run two explicit
`telegramUserId → clientId` bindings, import only approved measurements, run
A/B/unlinked isolation smoke, and retain a row-level rollback plan. No real pilot data
has been written.

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
