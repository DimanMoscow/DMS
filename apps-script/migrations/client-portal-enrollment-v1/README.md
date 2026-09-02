# Client Portal enrollment schema

`schema.json` is the exact contract for the invitation store. Run
`node preflight.mjs <private-input.json>` before production creation. The private input
contains only `existingSheets` and an empty `rows` array; it is never committed.

Production creation is allowed only when the target sheet does not exist. Create the
sheet with the ten headers in order, freeze row 1, format token hashes and IDs as plain
text, and apply the status allow-list plus date validations through row 1000. Read the
headers and row count back after creation. The rollout state is valid only at zero rows.

Rollback before first use is deletion of this newly-created empty sheet. After an
invitation exists, rollback is fail-closed: revoke pending invitations, disable any
resulting binding, export the invitation and access rows for recovery, and only then
consider removing the sheet. Existing client, financial, training, Queue, Journal, and
Calendar data are outside this migration.
