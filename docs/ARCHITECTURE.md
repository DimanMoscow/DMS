# Architecture

## Runtime path

1. Telegram opens the Next.js MiniApp hosted on Vercel.
2. The browser sends Telegram `initData` and an approved action to `app/api/dms/route.ts`.
3. The server-only proxy calls the deployed Apps Script web app.
4. Apps Script validates Telegram authorization and executes business logic against the
   bound Google Sheets workbook and Google Calendar.
5. Apps Script also drives the Telegram bot, notifications, menus, and administrative
   workflows. Apple Calendar receives Google Calendar changes through external sync.

## Responsibility boundaries

- `app/_components/mini-app-shell.tsx`: MiniApp presentation, navigation, request state,
  and client-side safeguards.
- `app/api/dms/route.ts`: server-only action allow-list and Apps Script proxy.
- `apps-script/versions/*/ZZZZZZZZMiniAppApi.gs`: MiniApp authentication and read API.
- `apps-script/versions/*/ZZZZZZZZZZMiniAppAdmin.gs`: MiniApp administrative mutations.
- `apps-script/candidates/v40`: complete Git-only candidate; it has no live runtime effect.
- `CalendarSync.gs`, `QueueProcessing.gs`, and `ZZZZZZZRuntime.gs`: shared calendar,
  queue, dry-run, reconciliation, and processing logic.
- Telegram files: bot UI, commands, scheduling, client/block management, and alerts.
- Google Sheets: operational records and business state. Google Calendar: schedule and
  event state. These are production data stores, not repository artifacts.

## Runtime versus repository copies

| Component | Production runtime | Repository role |
| --- | --- | --- |
| MiniApp | Vercel deployment | Canonical source in `app/`, `lib/`, `public/` |
| Apps Script | Google Apps Script deployment on `v38` | Sanitized snapshots in `apps-script/versions/` |
| Saved `v39` | Numbered version; not deployed and rejected by safety gate | Reviewable snapshot beside `v38` |
| Candidate `v40` | No runtime presence | Complete proposed source in `apps-script/candidates/v40` |
| Sheets / Calendar | Live Google services | No production data is stored in Git |
| Telegram | Telegram API calling Apps Script webhook | Bot behavior is implemented in Apps Script files |

The versioned Apps Script files in Git do not update Apps Script HEAD or a deployment.
They are auditable source snapshots with per-file hashes and documented placeholders.
