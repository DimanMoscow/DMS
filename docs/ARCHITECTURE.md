# Architecture

## Runtime path

1. Telegram opens the Next.js MiniApp hosted on Vercel.
2. The browser sends Telegram `initData` and an approved action to `app/api/dms/route.ts`.
3. The server-only proxy calls the deployed Apps Script web app.
4. Apps Script validates Telegram authorization and executes business logic against the
   bound Google Sheets workbook and Google Calendar.
5. Apps Script also drives the Telegram bot, notifications, menus, and administrative
   workflows. Apple Calendar receives Google Calendar changes through external sync.

The Main Mini App remains at `/`, and the read-only client portal also has a direct
screen at `/client`. A signed `start_param` on the root is dispatched to enrollment
before role resolution. An ordinary root launch calls the payloadless
`resolve_miniapp_entry` action: Apps Script validates signed Telegram `initData` and
returns only `admin`, `client`, or `unlinked`. Admin opens the administrative shell;
linked and unlinked non-admin identities open the client portal, where the dedicated
`client_portal_bootstrap` action either returns the allow-listed profile or
`client_not_linked`. The browser never selects or receives a `clientId` or Telegram ID.

Enrollment uses a separate admin action and a payloadless client action. The admin
selects an exact existing client, Apps Script stores only a one-time invitation hash,
and Telegram delivers the opaque token as signed `start_param`. Ordinary bot-menu
launches have no `start_param` and are routed by the server-resolved role. Consumption is
serialized by a document lock and creates the one-to-one binding without client-side
`clientId` input. Invitation state lives in `Приглашения Client Portal`; plaintext
tokens exist only in the one-time admin response/link.

## Responsibility boundaries

- `app/_components/mini-app-shell.tsx`: MiniApp presentation, navigation, request state,
  and client-side safeguards.
- `app/api/dms/route.ts`: server-only action allow-list and Apps Script proxy.
- `app/client/`: read-only client presentation with no administrative navigation or
  write controls.
- The administrative client card owns invite creation/revocation and trainer-entered
  measurement writes. Measurement corrections are append-only audit records; the
  client portal still receives only the current allow-listed values.
- Apps Script repository copies of `ZZZZZZZZMiniAppApi.gs`: MiniApp authentication and
  read API.
- Apps Script repository copies of `ZZZZZZZZZZMiniAppAdmin.gs`: MiniApp administrative
  mutations.
- `apps-script/versions/v43`: sanitized snapshot matching the deployed numbered `v43`.
- `apps-script/versions/v42`: historical source snapshot from the runtime/source
  mismatch incident; it is not deployed.
- `apps-script/candidates/v43`: retained reviewed source matching `versions/v43`; it
  contains the isolated client portal and runtime identity probe.
- `CalendarSync.gs`, `QueueProcessing.gs`, and `ZZZZZZZRuntime.gs`: shared calendar,
  queue, dry-run, reconciliation, and processing logic.
- Telegram files: bot UI, commands, scheduling, client/block management, and alerts.
- Google Sheets: operational records and business state. Google Calendar: schedule and
  event state. These are production data stores, not repository artifacts.

## Runtime versus repository copies

| Component | Production runtime | Repository role |
| --- | --- | --- |
| MiniApp | Vercel deployment | Canonical source in `app/`, `lib/`, `public/` |
| Apps Script | Google Apps Script deployment on `v45` | Complete reviewed source in `apps-script/candidates/v45` |
| Saved `v39` | Historical numbered version; not deployed | Reviewable snapshot beside `v38` |
| Retained `v40` candidate | No runtime effect by itself | Reviewed source matching `versions/v40` byte-for-byte |
| Numbered `v42` | Historical deployment with a proven runtime/source mismatch; not deployed | Source snapshot matching `candidates/v41` |
| Client portal `v43` | Historical client-portal runtime; not deployed now | Snapshot and candidate match byte-for-byte after URL sanitization |
| Enrollment and measurements `v44` | Previous production runtime | Snapshot and candidate match byte-for-byte after URL sanitization |
| Role routing `v45` | Active production runtime | Candidate contains the reviewed runtime marker, MiniApp router, and client portal role resolver diff |
| Sheets / Calendar | Live Google services | No production data is stored in Git |
| Telegram | Telegram API calling Apps Script webhook | Bot behavior is implemented in Apps Script files |

The versioned Apps Script files in Git do not update Apps Script HEAD or a deployment.
They are auditable source snapshots with per-file hashes and documented placeholders.
