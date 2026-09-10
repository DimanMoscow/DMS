# Stabilization acceptance matrix

This matrix is the release acceptance contract for the stabilization candidate. All mutation, fault, replay and concurrency evidence runs only against in-memory fixtures or an isolated recovery copy. Production acceptance is limited to read-only identity, health, reconciliation and UI/API smoke checks.

| ID | Scenario | Entry paths | Acceptance evidence | Required result | Status |
| --- | --- | --- | --- | --- | --- |
| A01 | Telegram navigation and read commands | Bot commands, reply keyboard, `nav:menu` | `tests/apps-script-telegram-navigation.test.mjs` | Current handlers are reachable, pending navigation state is cleared, non-admin identities receive no data | covered: fixture |
| A02 | Telegram secure mutations | `cf2` callbacks for queue, day, payments, Calendar and management | `tests/apps-script-operation-safety.test.mjs`; `tests/apps-script-telegram-row-action-ux.test.mjs`; `tests/telegram-confirmation-hardening.test.mjs` | Accepted actor/chat/message/action/payload are immutable and every mutation runs under the shared lock | covered: fixture |
| A03 | Admin MiniApp equivalents | `set_queue_decision`, `confirm_day`, admin health and existing admin actions | `tests/apps-script-telegram-row-action-ux.test.mjs`; `tests/apps-script-domain-day-confirmation.test.mjs`; `tests/repository.test.mjs` | Queue/day results match Telegram domain results; durable retries do not repeat writes | covered: fixture |
| A04 | Calendar to Queue | Incremental sync, pagination, deletion, move, bounded verification | `tests/apps-script-calendar-bounded-scan.test.mjs`; `tests/apps-script-day-confirmation.test.mjs` | Applicable Calendar changes reach Queue; cursor advances only after apply and reconciliation | covered: fixture |
| A05 | Unknown Calendar event onboarding | MiniApp preview and explicit `new`, `link`, `ignore` resolution | `tests/apps-script-calendar-onboarding.test.mjs` | Unknown title becomes registration state; repeated resolution is idempotent and audited | covered: fixture |
| A06 | Queue to Journal | Telegram/MiniApp day confirmation | `tests/apps-script-operation-safety.test.mjs`; `tests/apps-script-domain-day-confirmation.test.mjs` | Only the accepted row set is processed and each completed training produces one Journal effect | covered: fixture |
| A07 | Blocks, balances and debt | Day processing and financial recalculation | `tests/apps-script-financial-safety.test.mjs`; `tests/apps-script-p1-reproduction.test.mjs` | Block ownership, balance/debt values and formula anchors remain consistent and drift fails closed | covered: fixture |
| A08 | Payments | Secure payment creation, recovery and void | `tests/apps-script-operation-safety.test.mjs`; `tests/apps-script-financial-safety.test.mjs` | Exact amount/block/client state is bound; retry or transport failure never duplicates a payment | covered: fixture |
| A09 | Cancellation and move | Queue/upcoming Calendar actions and day cancellation | `tests/apps-script-operation-safety.test.mjs`; `tests/apps-script-telegram-row-action-ux.test.mjs` | Conditional Calendar write applies once; changed revision or accepted state fails closed | covered: fixture |
| A10 | Replay and idempotency | Repeated Telegram and MiniApp delivery | `tests/apps-script-operation-safety.test.mjs`; `tests/apps-script-domain-day-confirmation.test.mjs`; `tests/apps-script-telegram-row-action-ux.test.mjs` | Durable result is returned byte-for-byte without a second business effect | covered: fixture |
| A11 | Concurrent requests | Competing callbacks and API requests | `tests/apps-script-operation-safety.test.mjs`; `tests/apps-script-telegram-row-action-ux.test.mjs`; `tests/telegram-confirmation-hardening.test.mjs` | ScriptLock admits one executor; contenders observe in-progress/result or fail closed | covered: fixture |
| A12 | Expired confirmation | Expired/revoked `cf2` ticket and stale source button | `tests/apps-script-operation-safety.test.mjs`; `tests/apps-script-telegram-row-action-ux.test.mjs`; `tests/telegram-confirmation-hardening.test.mjs` | Operation is rejected before every business write | covered: fixture |
| A13 | Trigger jitter | Watchdog around incomplete or aborted ingestion generations | `tests/apps-script-calendar-generation-v54.test.mjs`; `tests/apps-script-scheduled-automation-v54.test.mjs` | Jitter cannot promote incomplete evidence into drift or trigger repair writes | covered: fixture |
| A14 | Temporary Calendar lag | Event observed between scheduled sync generations | `tests/apps-script-calendar-generation-v54.test.mjs`; `tests/apps-script-operational-health.test.mjs` | Health reports `awaiting_sync` or `delayed`; no premature alert or repair occurs | covered: fixture |
| A15 | Backup and recovery | Manifest validation and isolated restore rehearsal | `tests/backup-contract.test.mjs`; `tests/release-operations.test.mjs` | Complete, fresh backup is bound to production/version references and restore writes target only the isolated copy | covered: fixture + isolated copy |
| A16 | Client Portal read isolation | Signed Telegram identity, bindings and measurements | `tests/apps-script-client-portal.test.mjs`; `tests/repository.test.mjs` | Client selector injection fails closed; responses contain only the bound client's allow-listed fields | covered: fixture |

## Redundant Telegram confirmations removed in the candidate

The original button is accepted as final intent only when it already represents a specific row or a dedicated preview result. The candidate still creates and consumes the same immutable `cf2` ticket internally.

- Queue row decisions: completed, charged, free and move.
- Block actions from a dedicated preview: gift training, pause, resume and close.
- Dedicated confirmation buttons: undo, client archive/restore and payment void.

Day confirmation, settings toggles and manual backup retain a visible confirmation. Payment creation, Calendar creation, client/block editing, rename, price change, upcoming move and upcoming cancellation retain their existing dedicated preview/confirmation flow; stale pre-candidate state callbacks remain invalid.

## Milestone release gate

Before rollout, all rows above must remain covered, `npm run check` must pass, the Git snapshot must match the candidate snapshot, and the fresh backup must pass an isolated restore rehearsal. After deployment, acceptance is read-only: numbered-version/deployment/runtime identity, live gate, reconciliation, unified health and browser/API smoke. Payment, Calendar and other business mutations are forbidden as release smoke.
