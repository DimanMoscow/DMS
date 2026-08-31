# Architecture

## Runtime path

1. Telegram opens the Next.js MiniApp hosted on Vercel.
2. The browser sends Telegram `initData` and an approved action to `app/api/dms/route.ts`.
3. The server-only proxy calls the deployed Apps Script web app.
4. Apps Script validates Telegram authorization and executes business logic against the
   bound Google Sheets workbook and Google Calendar.
5. Apps Script also drives the Telegram bot, notifications, menus, and administrative
   workflows. Apple Calendar receives Google Calendar changes through external sync.

The administrative MiniApp remains at `/`. The read-only client portal is a separate
screen at `/client`; it uses the same server proxy but only the dedicated
`client_portal_bootstrap` action. Apps Script resolves the signed Telegram user to one
client record before reading that client's profile and measurements. The browser never
selects or receives a `clientId`.

## Responsibility boundaries

- `app/_components/mini-app-shell.tsx`: MiniApp presentation, navigation, request state,
  and client-side safeguards.
- `app/api/dms/route.ts`: server-only action allow-list and Apps Script proxy.
- `app/client/`: read-only client presentation with no administrative navigation or
  write controls.
- Apps Script repository copies of `ZZZZZZZZMiniAppApi.gs`: MiniApp authentication and
  read API.
- Apps Script repository copies of `ZZZZZZZZZZMiniAppAdmin.gs`: MiniApp administrative
  mutations.
- `apps-script/versions/v40`: sanitized snapshot matching the deployed numbered `v40`.
- `apps-script/candidates/v40`: retained reviewed release candidate, byte-identical to
  the `v40` snapshot; repository copies have no live runtime effect.
- `apps-script/candidates/v41`: undeployed full-source candidate containing the isolated
  client portal API and server-side access/measurement readers.
- `CalendarSync.gs`, `QueueProcessing.gs`, and `ZZZZZZZRuntime.gs`: shared calendar,
  queue, dry-run, reconciliation, and processing logic.
- Telegram files: bot UI, commands, scheduling, client/block management, and alerts.
- Google Sheets: operational records and business state. Google Calendar: schedule and
  event state. These are production data stores, not repository artifacts.

## Runtime versus repository copies

| Component | Production runtime | Repository role |
| --- | --- | --- |
| MiniApp | Vercel deployment | Canonical source in `app/`, `lib/`, `public/` |
| Apps Script | Google Apps Script deployment on `v40` | Production-matching sanitized snapshot in `apps-script/versions/v40` |
| Saved `v39` | Historical numbered version; not deployed | Reviewable snapshot beside `v38` |
| Retained `v40` candidate | No runtime effect by itself | Reviewed source matching `versions/v40` byte-for-byte |
| Client portal `v41` candidate | Not present in Apps Script HEAD or a deployment | Undeployed full-source candidate for review and future release |
| Sheets / Calendar | Live Google services | No production data is stored in Git |
| Telegram | Telegram API calling Apps Script webhook | Bot behavior is implemented in Apps Script files |

The versioned Apps Script files in Git do not update Apps Script HEAD or a deployment.
They are auditable source snapshots with per-file hashes and documented placeholders.
