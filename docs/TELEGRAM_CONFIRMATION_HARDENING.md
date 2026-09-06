# Telegram confirmation hardening

## Threat model

The current payment, Calendar-conflict, and block-edit buttons use generic callback data
such as `pc:yes`, `scc:yes`, and `ops:blockEditYes`. Session state is keyed by admin and
chat with a short cache lifetime, but the button does not identify the state it was
rendered for. An older message can therefore confirm a newer pending action. Telegram
update deduplication also relies on best-effort cache state written after the handler, so
a retry after a partial failure can repeat a durable mutation.

The next implementation should defend against stale buttons, forwarded or replayed
callbacks, duplicate Telegram delivery, cache eviction, concurrent clicks, and failure
between a Sheet/Calendar write and the acknowledgement.

## Implemented contract

- Generate a cryptographically random one-time nonce for every confirmation preview.
- Store only a nonce hash with flow version, admin user, chat, message ID, action type,
  canonical payload digest, creation/expiry times, and status.
- Put the compact flow version and opaque nonce in callback data. Do not put client,
  payment, event, or financial fields in the callback.
- Under the document lock, revalidate Telegram admin identity, chat, message ID, action,
  payload digest, TTL, and `pending` status. Atomically move the nonce to `consumed`
  before or with the first durable mutation.
- Derive an operation key from action type plus canonical target/payload. Store it in an
  append-only operation ledger with `pending`, `committed`, or `failed` state and the
  resulting object references. A duplicate delivery returns the recorded result and
  performs no second write.
- Expired, unknown, consumed, mismatched, or legacy generic callbacks fail closed and
  replace the message controls with a fresh-preview action.

## Compatibility and evidence

Roll out as a new callback version while accepting old read-only navigation callbacks.
Generic mutation confirmations become invalid after deployment; pending previews must be
regenerated. No business rule, price, client selector, or access role changes.

Required fixture evidence covers stale-message/new-state confusion, wrong admin/chat/
message/action, expiry boundary, concurrent double click, duplicate update IDs, cache
loss, failure before and after the durable write, Calendar/payment retries, and audit-log
redaction. Production verification should use read-only inspection of ledger invariants;
it must not create a payment or Calendar event as a smoke test.

Production `v50` implements the contract in
`ZZZZZZZZZZZZTelegramConfirmations.gs`. The callback contains only `cf1`, a random
confirmation ID, and a one-time random nonce. Document Properties keep the nonce hash,
salted admin/chat hashes, exact message binding, action, canonical action/payload hash,
timestamps, lifecycle status, and deterministic logical operation ID. The payload stays
only in the bounded script cache and is never written to the ledger or logs.

The append-only `Журнал операций Telegram` records sanitized `pending`, `committed`,
`failed`, `replay`, `expired`, and `revoked` events. The operation ID is derived from the
flow identity and canonical payload, so two confirmations for the same logical flow
share one durable result. The document lock serializes acceptance and consumes the
confirmation before mutation. A concurrent callback sees `pending`; a later delivery
sees `committed` and returns the recorded result without a second mutation. Payment and
Calendar-create operations carry a private operation marker so an ambiguous Telegram
transport failure can be reconciled after the durable write.

All pre-v50 generic mutation confirmations fail closed. Payload-specific legacy buttons
are converted into a new one-time confirmation before they can mutate. Read-only
navigation remains compatible. The secured surface includes payment creation/void,
Calendar creation/move/cancel, Queue decisions and day confirmation, block changes,
client archive/restore, undo, management writes, settings changes, and manual internal
backup creation.

The non-destructive `telegram-confirmations-v1` migration is applied. Official Google
API read-back proved the exact candidate, HEAD, numbered `v50`, and deployment mapping;
the runtime module fingerprint and handler marker passed. The read-only live gate passed
`17/17`, reconciliation remained `0`, and the new ledger had zero data rows. A
complete 16-sheet backup plus isolated restore comparison passed. No payment or Calendar
mutation was used as release smoke.
