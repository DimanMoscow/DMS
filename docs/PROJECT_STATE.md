# Current project state

Last verified: 2026-09-03 (UTC).

## Confirmed state

- Current `origin/main` at `610f9a38200518414cab3acaec662e43ebee7fd5` is the
  repository source of truth.
- MiniApp production is release `0.2.2`; Vercel deployment
  `dpl_64WeerPa7NmtczDHcsLd4G5faGYK`, built from Git-linked `main` at
  `610f9a38200518414cab3acaec662e43ebee7fd5`, is `READY`. Its immutable URL and production alias both return HTTP
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
  zero issues across 79 queue rows, 97 journal rows, and 88 calendar events.
- Local `npm run check` and CI cover MiniApp lint, tests, TypeScript, build, Apps Script
  snapshot integrity, client isolation, and runtime identity code.

## Open risk and next step

The existing Vercel project is now Git-linked to `DimanMoscow/DMS`; the production
branch is `main`. This gives the project a durable deployment path without changing
its project, domains, or production environment variables.

The first pilot enrollment proved atomic consume, read-only client bootstrap, and replay
rejection. It also exposed one routing gap: an ordinary Main Mini App launch without a
signed `start_param` still opened the admin shell first, so a linked client received
`access_denied` instead of returning directly to the client portal.

Candidate `v45` plus MiniApp release `0.2.3` fix the mechanism with the payloadless
`resolve_miniapp_entry` action. Apps Script validates signed Telegram `initData` and
returns only `admin`, `client`, or `unlinked`; the browser never selects a client or
uses names, usernames, query parameters, or Telegram IDs. The candidate is covered by
the complete local gate but is not production until the Apps Script and Vercel rollout
and authenticated re-entry smoke succeed.

## Known limitations

- Linked-client ordinary re-entry still fails on production `0.2.2` until the reviewed
  `v45` / `0.2.3` rollout completes.
- Apps Script snapshots are sanitized repository copies, not live runtime. Operational
  URLs and Script Properties remain outside Git.
- Exact unsanitized exports are intentionally local-only. No `.clasp.json` or
  repository-to-Apps-Script write workflow is configured.
- The second pilot binding still requires that client's own authenticated Telegram
  action. Real measurements require an explicit trainer action.
