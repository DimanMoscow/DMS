# Telegram confirmation hardening preflight

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

## Proposed contract

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
