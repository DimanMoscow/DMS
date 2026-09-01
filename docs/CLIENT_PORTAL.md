# Read-only client portal

## Access boundary

- Entry point: `/client`; the administrative MiniApp remains separate at `/`.
- The browser sends signed Telegram `initData` and action
  `client_portal_bootstrap` with no payload.
- Apps Script validates the Telegram signature and age, then resolves the exact numeric
  Telegram user ID through `Доступ клиентов`. Names, usernames, display names, and
  approximate matching are never used.
- Active bindings are one-to-one. Multiple active rows for either side, duplicate
  binding IDs, malformed IDs, missing client records, and invalid measurement rows fail
  closed without returning client data.
- Responses expose only name, training format, measurement dates, and allow-listed
  metrics. Client, binding, and measurement IDs; financial fields; notes; payments; and
  administrative state are omitted. The proxy returns `Cache-Control: no-store`.

## API contract

Request:

```json
{"initData":"<Telegram signed value>","action":"client_portal_bootstrap"}
```

Any payload or top-level `clientId` is rejected with `invalid_request`.

Successful `data` shape:

```json
{
  "generatedAt": "ISO-8601",
  "profile": {"name": "string", "trainingFormat": "string"},
  "latestMeasurement": {"measuredAt": "ISO-8601", "metrics": {"weightKg": 0}},
  "measurements": [{"measuredAt": "ISO-8601", "metrics": {"weightKg": 0}}]
}
```

Allowed metric keys are `weightKg`, `chestCm`, `waistCm`, `hipsCm`, `upperArmCm`, and
`thighCm`. Blank metrics are omitted. Expanding the set requires a reviewed code and
schema change.

## Production bootstrap plan

This plan is not executed by repository changes.

The offline migration package is in `apps-script/migrations/client-portal-v1/`. Its
`schema.json` is the exact column/type contract; `preflight.mjs` validates proposed
rows without network access or writes and emits no identifiers. Real input stays
outside Git.

1. Confirm Apps Script production is still `v40`, export the workbook structure, and
   record row counts for existing sheets.
2. Create `Доступ клиентов` with exactly these columns:

   | Column | Value |
   | --- | --- |
   | Binding ID | Unique random `BND-*` identifier |
   | Telegram User ID | Exact numeric Telegram user ID stored as text |
   | Client ID | Existing exact `CL-*` value from `Клиенты` |
   | Status | `active` or `disabled` |
   | Created At | UTC timestamp |
   | Updated At | UTC timestamp |

3. Create `Замеры` with exactly these columns:

   | Column | Value |
   | --- | --- |
   | Measurement ID | Unique random `MSR-*` identifier |
   | Client ID | Existing exact `CL-*` value |
   | Measured At | Measurement timestamp |
   | Weight Kg | Optional numeric value |
   | Chest Cm | Optional numeric value |
   | Waist Cm | Optional numeric value |
   | Hips Cm | Optional numeric value |
   | Upper Arm Cm | Optional numeric value |
   | Thigh Cm | Optional numeric value |

4. Add data validation for statuses and numeric ranges. Do not modify `Клиенты`; the
   portal only reads its ID, name, active status, and training format.
5. Insert each first binding only after an authenticated enrollment ceremony proves
   control of the exact Telegram numeric ID and the trainer selects the exact existing
   `CL-*` record. Do not copy names/usernames into the access table or infer a match. If
   no approved enrollment ceremony is available, no binding may be created.
6. Before release, prove uniqueness in both directions, verify every active client ID
   exists exactly once in `Клиенты`, and run fixture plus read-only isolation tests for
   two distinct accounts and one unlinked account.
7. After each client has started the bot and the numeric Telegram ID is independently
   confirmed, set that private chat's menu button to the production MiniApp `/client`
   URL. Use Telegram's per-chat `setChatMenuButton` with `chat_id`; do not replace the
   existing global/admin menu button, which must continue opening the admin root `/`.
   Read back each per-chat button before considering the binding active.

Writes requiring explicit production approval are creation of the two sheets, their
headers/validation, every real binding row, every real measurement row, and each
per-chat Telegram menu-button change. Apps Script HEAD/version/deployment and the
MiniApp deployment are separate approvals.

Rollback is fail-closed: disable all new bindings first, verify the client endpoint no
longer returns profiles, reset each affected per-chat menu button to Telegram's default,
then remove only the two newly created sheets after exporting them for recovery.
Existing `Клиенты`, Calendar, Queue, Journal, Blocks, Payments, and Reports are never
modified by this migration.
