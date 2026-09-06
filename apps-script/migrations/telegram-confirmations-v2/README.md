# Telegram confirmations v2

This additive migration extends the existing operation ledger from 13 to 17 columns.
It never rewrites historical operation rows. v50 still reads its original 13-column
header prefix while the reviewed candidate is prepared. cf2 runtime requires all 17
headers and rejects old cf1 callbacks, which must be regenerated.

The new private columns contain protocol, immutable ticket metadata, canonical payload,
and durable result. This deliberately replaces v1's cache-only payload contract. The
workbook is an operational private store: no payload, nonce, credentials or row data
may appear in Git, logs, public reports, or client API responses. Nonces remain hashed.

Run preflight against fresh read-only metadata with a verified production-bound backup
and the applied v1 ledger. The preflight function accepts evidence assertions from the
release runner; the standalone result is not remote evidence and cannot authorize a
write. Write only the four extension headers after checking empty extension columns.
Read the full historical row prefix before and after and require byte-equivalent values.

Old ticket properties must be inventoried in the original document-bound context.
Preserve every raw ticket record in private recovery evidence and the durable ledger
before removing any ephemeral key. Unknown or accepted pending operations require
manual review, never inferred completion. Cleanup must be bounded and idempotent;
absence of a document store from a web app is not evidence that it was empty.

New cf2 tickets allocate no PropertiesService entries. Durable bindings and results
remain in the append-only ledger after ephemeral cache expiry. The quota diagnostic
counts UTF-8 key/value bytes, warns at 400,000 bytes, and refuses new confirmations at
450,000 bytes, below Google's 500 KB property-store limit. Per-value limits are 9 KB.
The actual platform limit and quota changes remain Google's authority:
[Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas).

Keep the 16-sheet private backup, isolated restore evidence, old numbered snapshot and
Vercel source reference. Once cf2 has accepted an operation, recover by rolling forward;
v50 cannot interpret the new recovery protocol. Never truncate events during rollback.
