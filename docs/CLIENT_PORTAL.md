# Read-only client portal

## Access boundary

- Client entry point: `/client`. Telegram Main Mini App links land on `/`; the root
  dispatcher selects the client enrollment UI only when signed `initData` contains a
  non-empty `start_param`. For an ordinary bot-menu launch, Apps Script resolves the
  role from signed `initData`: admins enter the admin MiniApp, while linked and
  unlinked non-admins enter the Client Portal without browser-side identity heuristics.
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

## One-time enrollment

The trainer creates an invite from the authenticated admin client card. The server
validates the exact existing `clientId`, refuses an already-linked client, generates a
43-character base64url secret, stores only its SHA-256 hash, and returns a Telegram Main
Mini App link once. The public link contains neither a client ID nor a name. Invites
expire after 48 hours and have `pending`, `used`, `revoked`, or `expired` status.

Telegram passes the opaque value in signed `start_param`. The client calls
`client_portal_enroll` with only signed `initData`; top-level selectors and payloads are
rejected. Apps Script revalidates signature and age, resolves the token hash, and under
a document lock rechecks the invite plus both one-to-one constraints. It then appends
one active binding and marks the invite used. A failed second write removes the newly
appended binding before returning an error. Replays and ambiguous rows fail closed.

The exact empty production schema and preflight are in
`apps-script/migrations/client-portal-enrollment-v1/`. Raw tokens, signed initData, and
Telegram IDs are not logged. The bot must report `has_main_web_app=true` before an
invite can be created.

The browser never trusts `tgWebAppStartParam` or another query-string selector for
enrollment. Routing and consumption both derive the token only from signed `initData`.

## Production bootstrap plan

This plan is not executed by repository changes.

The offline migration package is in `apps-script/migrations/client-portal-v1/`. Its
`schema.json` is the exact column/type contract; `preflight.mjs` validates proposed
rows without network access or writes and emits no identifiers. Real input stays
outside Git.

1. Confirm the current Apps Script production version, export the workbook structure, and
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
| Corrects Measurement ID | Optional prior `MSR-*`; corrections append instead of overwrite |
| Created At | UTC audit timestamp |
| Created By | Authenticated admin Telegram ID, never returned to clients or logs |

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

## Trainer measurement workflow

The authenticated admin client card can add an allow-listed measurement for an exact
client. The UI requires a preview before save; the server independently validates the
date, at least one metric, one decimal place, and the documented ranges. A client/date
may have only one active measurement.

The preview uses the Moscow calendar date, accepts either decimal separator, displays
normalized numeric values, and rejects impossible/future dates, excessive precision,
out-of-range metrics, and correction attempts that do not change any value. These are
trainer UX checks only; Apps Script remains the authoritative validation boundary.

Correction never overwrites a row. It appends a new measurement with
`Corrects Measurement ID`; the old row remains in the audit chain and the client API
returns only the active leaf. A second correction of the same row, cross-client target,
unknown fields, invalid ranges, or a future date fail closed. Measurement IDs, audit
actor, and correction links remain admin-only.

The read-only client UI compares each active measurement only with the preceding active
measurement and shows neutral one-decimal changes where both values exist. Corrections
are already collapsed by the server before this comparison; the UI does not infer goals
or medical meaning.

Production `v49` includes the no-op correction rejection at the server boundary under
the document lock and preserves Client Portal error codes through the admin API.
