# Controlled Client Portal pilot

This runbook covers the approved two-client pilot only. The exact client IDs and names
belong in the trainer's private operational view, not in Git:

| Pilot role | Client |
| --- | --- |
| A | First approved pilot client |
| B | Second approved pilot client |

The invitation URLs are one-time secrets. They are never committed, logged, or placed
in this runbook. Each URL must be sent privately only to its named client.

If the one-time plaintext URL is lost before delivery, the stored hash cannot reconstruct
it. Revoke that pending invitation and create a replacement only under a new explicit
production-write authorization; never weaken hashing or expose the stored row to recover
the token.

## Before either client opens a link

1. In the authenticated trainer MiniApp, read both exact client cards again.
2. Require one unexpired `pending` invitation per client, no active binding, and zero
   measurements unless a later trainer action explicitly created one. Match each row
   to the privately approved ID/name pair in the authenticated trainer view.
3. Run system diagnostics and require all checks green with reconciliation at zero.
4. If a pending invitation is wrong, expired, duplicated, or cannot be matched to the
   exact client card, revoke it and stop. Do not infer a Telegram ID from a name,
   username, or display name.

## A / B / unlinked ceremony

1. Client A opens only the private invitation prepared from A's exact approved card in their
   own native Telegram. The server derives both the opaque token and Telegram identity
   from signed `initData`, atomically consumes the invitation, and creates only
   `Telegram A -> Client A`.
2. Read back A: invitation `used`, exactly one active binding, and the client response
   contains only A's profile and allow-listed measurements.
3. Repeat separately for Client B and require only `Telegram B -> Client B`.
4. Launch `/client` from an unrelated account with no binding and require
   `client_not_linked` with no client data.

The gate fails if A receives any B field, B receives any A field, a client selector is
accepted, a replay succeeds, an expired/revoked invitation is consumed, either side of
the one-to-one binding becomes ambiguous, an admin action is reachable from a client
identity, or a response/log contains financial fields, internal notes, raw `initData`,
Telegram identity, or invitation token. Client responses must remain `no-store`.

## Race and replay checks

The production handler holds the document lock while re-reading the invitation and both
one-to-one constraints. Two concurrent consumes cannot both pass: the first successful
consume marks the invitation `used`; the second fails closed. Tests cover replay,
client/Telegram collisions, selectors, revoked/expired states, and cleanup if the
binding append succeeds but the invitation update fails.

Do not race a real invitation as a smoke test. The automated fixtures are the race
gate; production proves one normal consume and one later replay rejection only after
the client has completed enrollment.

## Rollback

### Pending invitation

Use `Отозвать приглашение` on the exact client card, then read back `unlinked` with no
active invitation and confirm there is still no binding. Revocation changes only the
invitation row and its audit timestamps.

### Incorrect consumed binding

Stop client access first. Under a separately approved production-data action, identify
the exact binding by binding ID plus exact client ID, confirm there is only one active
row on both sides, export the invitation and access rows for recovery, and change the
binding status from `active` to `disabled` with a new `Updated At`. Do not delete the
row: retaining it preserves the audit trail. Read back that the client endpoint now
returns `client_not_linked`, the invitation remains `used`, and neither intended client
is exposed through another active binding.

Rollback must not touch `Клиенты`, Blocks, Payments, Queue, Journal, Calendar, training
records, or measurements. Run the full read-only system gate after rollback.
