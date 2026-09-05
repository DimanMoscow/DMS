# Telegram confirmation ledger v1

This non-destructive migration creates the append-only `Журнал операций Telegram`
sheet required by candidate v50. The sheet stores only salted identity hashes,
payload hashes, operation states, and sanitized result references. It never stores a
plaintext nonce, Telegram identifier, client payload, payment amount, or Calendar data.

Run the private read-only preflight first. Apply the schema only after a verified private
Drive backup of production v49. Before the first ledger event, rollback may remove the
new empty sheet. Once events exist, retain the audit history and use a forward code
rollback so consumed confirmations cannot be replayed.

The runtime must fail closed when the sheet is absent or its headers differ. Production
smoke testing is read-only; create no payment, Calendar event, queue decision, or client
change to test this migration.
