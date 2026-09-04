# Calendar-driven client onboarding

## Queue contract

A valid training event whose Calendar title has no exact canonical name or alias is
stored in `Очередь подтверждения` with both matching and processing status
`Требует регистрации`. This is an administrative state, not a system error. It must
not append a Journal row, charge a block, create a payment, or change the Calendar
event.

Calendar sync remains exact-match only. It never guesses a client from a similar name.
The read-only `previewDmsCalendarQueueSync` function reports only aggregate counts,
queue IDs, and destination statuses; it omits event IDs, titles, and client data.

## Admin resolution

The Today screen offers three explicit actions for a registration item:

- **New client**: validates the proposed name and product, applies approved standard
  prices for one-off, Block 5, and Block 10, and requires explicit terms for Hybrid or
  Individual. Payment is a separate explicit choice.
- **Link**: the administrator chooses one active client. The exact Calendar title is
  saved as an alias only after collision checks.
- **Ignore**: marks this queue event only as non-training. It never deletes the Calendar
  event and never creates a global title pattern.

Every action has a server-generated preview and a separate confirmation request. The
server repeats every precondition while holding the document lock. It rejects alias
collisions, processed or changed queue rows, and any event already represented in the
Journal. A matching replay returns a no-op; a conflicting replay fails closed.

## New-client transaction

The first Calendar training supplies the date and Calendar title. The server allocates
the next client ID and, for block products, the next block ID. A paid selection appends
a distinct confirmed Payment row; it never marks the training as conducted. The source
queue item is linked to the new client and returns to the normal waiting state, still
without a Journal row.

Client, block, payment, queue, and alias mutations are performed under one document
lock. Before mutation, the touched ranges, formulas, and validations are captured. If a
write or audit append fails, the captured state is restored before the lock is released.
The successful action appends an auditable undo payload.

## Safety and release checks

- Queue validations must allow `Требует регистрации` in matching and processing
  status columns before the runtime can emit the state.
- `runDmsReadOnlySelfTests` must pass, including `debt-formula-integrity` and
  Calendar ↔ Queue ↔ Journal reconciliation.
- Production logs may contain bounded action, status, error class, request ID, and
  queue ID. They must not contain signed `initData`, Telegram identities, invite
  tokens, Calendar titles, client names, or client IDs.
- Existing recognized clients, client-portal isolation, and trainer measurement guards
  remain part of the repository gate.

## Production acceptance

For an existing unknown queue row, run the read-only sync preview first. Apply sync only
when the projected writes are understood. Confirm that the row moves from legacy
`Ошибка` to `Требует регистрации`, `queueErrors` becomes zero,
`queueRegistrations` increases, Journal/financial counts do not change, and
reconciliation remains zero.

Do not choose **New client**, **Link**, or **Ignore** without the administrator's actual
business answer. Until then, the queue row remains safely pending registration.
