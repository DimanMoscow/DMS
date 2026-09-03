# Current project state

Last verified: 2026-09-03 (UTC).

## Confirmed state

- The role-routing implementation on `main` is commit
  `417d774d74b9884c32ac29ffc2f9c7b181036b42`; the repository remains the source of
  truth.
- MiniApp production is release `0.2.3`; Vercel deployment
  `dpl_63g36CTHJoS5Dmhb9KCzucaPFnYx`, built from Git-linked `main` at
  `417d774d74b9884c32ac29ffc2f9c7b181036b42`, is `READY`. Its immutable URL and production alias return HTTP
  200 from `/api/health` with `dataMode: connected`; `/` and `/client` also return
  HTTP 200.
- Vercel Production has the required server-only `DMS_APPS_SCRIPT_URL`; its value stays
  outside Git.
- Apps Script production uses the existing web-app deployment on numbered version
  `v45`. Its three changed files are the exact reviewed `v44 -> v45` targeted diff:
  runtime identity, the payloadless request branch, and the isolated role resolver.
  The API self-test compiled and executed successfully; the post-deploy read-only gate
  passed 15/15 with reconciliation at zero.
- Numbered `v42` is retained as a historical incident artifact and is not deployed. Its
  stored source contained `client_portal_bootstrap`, but the serving runtime
  reproducibly returned `unknown_action`. Republishing the same router/client module in
  `v43` with an explicit identity marker produced the expected runtime.
- Numbered `v41` is a damaged historical release artifact and was never deployed.
- `apps-script/versions/v42`, `apps-script/versions/v43`, and
  `apps-script/versions/v44` preserve the sanitized 16-file numbered sources. The
  snapshot verifier checks their exact trees and reviewed-candidate identities.
  Production `v45` is represented by its complete reviewed source in
  `apps-script/candidates/v45` plus the numbered deployment and gate evidence.
- Production sheets `Доступ клиентов`, `Замеры`, and
  `Приглашения Client Portal` exist with the approved schemas. The first approved pilot
  client has exactly one active binding and a used invitation; its replay was rejected.
  The second approved pilot client has no binding and one pending invitation. There are
  zero measurements. Client identifiers, Telegram identities, and invitation secrets
  stay outside Git and logs.
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
  zero issues across 84 queue rows, 107 journal rows, and 94 calendar events.
- Local `npm run check` and CI cover MiniApp lint, tests, TypeScript, build, Apps Script
  snapshot integrity, client isolation, and runtime identity code.

## Open risk and next step

The existing Vercel project is now Git-linked to `DimanMoscow/DMS`; the production
branch is `main`. This gives the project a durable deployment path without changing
its project, domains, or production environment variables.

The `v45` / `0.2.3` rollout fixes ordinary-launch routing with the payloadless
`resolve_miniapp_entry` action. Apps Script validates signed Telegram `initData` and
returns only `admin`, `client`, or `unlinked`; the browser never selects a client or
uses names, usernames, query parameters, or Telegram IDs. Automated gates, production
deployment identity, and server-side read-only gates are green. Final pilot acceptance
still requires the first linked client to reopen the Main Mini App normally and the
second client to consume the existing pending invitation from their own Telegram.

## Known limitations

- Linked-client ordinary re-entry requires one live confirmation by the already linked
  pilot client; the server-routing release itself is deployed.
- Apps Script snapshots are sanitized repository copies, not live runtime. Operational
  URLs and Script Properties remain outside Git.
- Exact unsanitized exports are intentionally local-only. No `.clasp.json` or
  repository-to-Apps-Script write workflow is configured.
- The second pilot binding still requires that client's own authenticated Telegram
  action. Real measurements require an explicit trainer action.
