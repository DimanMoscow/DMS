# Client portal v1 migration package

This package is offline and read-only. It does not call Google, Telegram, Apps Script,
or Vercel APIs and cannot create sheets or rows. Production values must never be added
to Git; prepare the input in a temporary local file outside the repository.

## Input and preflight

The JSON input has exactly three arrays: `existingClients`, `bindings`, and
`measurements`. `existingClients` is a read-only export containing only exact `CL-*`
IDs from `Клиенты`; names and usernames are forbidden. The binding and measurement
objects use the camel-case equivalents of the columns in `schema.json`.

Run:

```bash
node apps-script/migrations/client-portal-v1/preflight.mjs /absolute/path/migration-input.json
```

The command reports only counts, row numbers, field names, and error codes. It never
prints identifiers or client data. Exit code `0` means the proposed rows pass the
schema, references, ranges, and uniqueness checks; it does not authorize writes.

## Exact production sequence

1. Read-only export the exact client IDs and prepare proposed rows outside Git.
2. Obtain each Telegram numeric ID from a separately approved, authenticated enrollment
   ceremony tied to that Telegram account. Pair it with an exact `CL-*` selected from the
   authoritative client record. Names, usernames, display names, and fuzzy matching are
   not accepted as evidence. If that ceremony is not available, do not create a binding.
3. Run this preflight. A nonzero exit or any duplicate blocks the migration.
4. Record workbook sheet names, headers, row counts, and a recovery export.
5. With separate production approval, create the two sheets and validations, then insert
   only the preflighted rows. Re-export and run the same logical checks on the result.
6. Release Apps Script and MiniApp through their independent gates. Test two bound users,
   one unlinked user, selector rejection, allow-listed responses, and `no-store`.
7. Only after a bound client has started the bot, set and read back that private chat's
   `/client` menu button. Keep the global/admin `/` button unchanged.

## Rollback

Disable all new binding rows first and prove the endpoint returns `client_not_linked`.
Reset only affected per-chat menu buttons to Telegram default. Export both new sheets,
then remove only `Доступ клиентов` and `Замеры`. Do not modify `Клиенты`, Queue,
Journal, Calendar, Payments, Blocks, Reports, or the global Telegram menu.

The exact writes requiring approval are: two sheet creations, two header rows and their
validations, every binding row, every measurement row, every per-chat menu-button change,
Apps Script HEAD/version/deployment, and the Vercel production deployment.
