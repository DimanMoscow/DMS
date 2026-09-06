# P1 remediation

Baseline: `178a3503a11ed7c02e65fca52010cc0bb0f23007`, fetched from `origin/main`.
The initial worktree was clean and there were no open PRs. GitHub main CI run
34058626281 succeeded. Vercel Production was READY at the same source SHA.
An authenticated reader preflight matched production numbered v50, HEAD, and the
complete Git snapshot. The Telegram operation ledger was present and empty.
The private recovery manifest passed the 16-sheet contract with approximately
1.2 hours of age; its isolated restore evidence passed the repository DR policy.
Production schema remains `telegram-confirmations-v1`. The additive v2 migration
has been applied only to the private isolated test copy.

## Ingress (P1.1)

Reproduced on the complete v50 bundle: malformed JSON reaches the outer error
handler before authentication and appends a row through the real audit function.
Candidate v51 rejects empty, oversized, scalar, array, and malformed input without
persistent error handling. The route boundary emits a fixed platform log message,
never request or exception text. MiniApp authentication and webhook authentication
remain separate; valid webhook dispatch and update deduplication are preserved.

The 13 behavioral tests in `tests/apps-script-ingress-safety.test.mjs` load the complete
server source files, include the old failure, repeat rejected requests 20 times,
and observe Sheet writes at the service boundary. Candidate v51 is a repository
candidate only; production remains v50 until the combined remediation release.

PR #49 was squash-merged as `7e9218188045b48e3f1904b0c86d70d77c1b27d1`.
GitHub release-gate passed and the automatic Vercel Production deployment at this
exact SHA passed the read-only route, authentication-boundary and no-store checks.

## Operation primitive (P1.2 / P1.4 / P1.5)

The complete v50 bundle reproduces session replacement after acceptance, a crash
that leaves the operation indefinitely pending, unsafe range undo, and unbounded
ticket properties. The web-app null DocumentLock failure is reproduced separately;
document-bound fixtures used to expose the latent mutation bugs are explicitly
labelled and are not evidence of a production lock.

Candidate v51 uses one ScriptLock with nested leases across cooperating writers.
The lock covers validation, acceptance, immutable execution, and durable outcome.
cf2 stores the full confirmed payload and identity binding in an append-only
17-column operation ledger, with no per-ticket Properties allocation. Cache loss
or another session cannot change accepted parameters. A conservative business
snapshot hash rejects changed data. Calendar changes additionally use captured
ETags and conditional writes, while creation uses a deterministic event ID.

The lifecycle is ticket → pending → started → result → committed. A crash at
pending resumes only if the business state still matches; a durable result is
finalized without repeating its mutation. After started, recovery requires a
positive domain effect proof. Payment recovery checks unique marker, client,
block, amount, method and status; Calendar creation checks unique ID and the
confirmed title/times. An ambiguous effect becomes durable manual_review and is
never blindly executed again. This is not a cross-service atomic transaction:
partially completed multi-step actions can require manual reconciliation. A day
with blocked rows has a durable partial result, not a false success.

Legacy cf1/cx1 buttons fail closed. The additive migration preserves all v1 rows.
Bounded legacy cleanup copies and reads back each raw ticket before deleting its
ephemeral property, preserves unknown/pending evidence, and requires an explicit
old-execution drain assertion. Live inventory in the original document context
is still a release prerequisite. Historical ledger and identity bindings have no
automatic deletion. Property diagnostics warn at 400,000 bytes and stop new
confirmations at 450,000 bytes. The 2,000-lifecycle test leaves property use flat.

The private Drive test copy was first compared against all 16 source sheets,
including values, formatting, validation and notes. It was then reset with
synthetic fixtures. Six crash/retry cases ran the complete candidate bundle with
real Sheets API writes and verified actual read-back. The additive migration was
idempotent. Production writes were zero. The test runner reports its limits:
Apps Script business code executes in Node VM; ScriptLock and Telegram/Calendar
transports are emulated, not a live Apps Script concurrency test. Separate
service-boundary tests enforce mutual exclusion across independent executions.
The operation-stage `npm run release:check` passed all 149 tests, dependency audit,
lint, TypeScript, production build, snapshot verification and migration integrity.
PR #50 merged as `b392fb19e082835be7885dae12f13031f14fdaf3`. Its exact automatic
Vercel Production deployment passed read-only health/runtime and page checks.

## Domain undo (P1.3)

Inventory: restore_range is emitted for client fields, block fields, payment
status and queue changes; clear_range for newly created clients, blocks and
payments; compound groups these; move_calendar_event restores a prior time.
delete_calendar_event was accepted by the old dispatcher but has no active emitter.
The old generic execution dispatcher is removed. New audit records seal a
versioned domain plan with audit/action/entity identity, row ID, expected values
and the post-operation business hash. Legacy plans require manual review.

Compensation archives a created client, closes a created block while retaining
its original terms, and voids a created payment. IDs and history remain. A queue
or field restoration checks expected state and references before writing. All
steps are validated before the first write under the shared ScriptLock. New
Journal, Payment, Block, Queue or portal references reject unsafe retirement.
Calendar restoration also checks the original post-operation ETag. Immediate
queue compensation after a failed Calendar cancellation has a separate narrow
expected-value check; it cannot execute arbitrary historical range payloads.

Eleven complete-bundle tests exercise actual onboarding with/without payment,
the required downstream-reference cases, row/audit drift, repeated undo, competing
executions and interrupted cf2 undo across a VM restart. Five scenarios also
passed actual isolated Sheets writes/read-back with zero dangling references and
zero production writes. Their synthetic starting state is produced by the real
onboarding implementation; the Node runtime/lock limitations above still apply.
The undo-stage full release gate passed 160 tests and all other repository checks.

## Remaining P1 gates

Operation changes remain an undeployed candidate; final combined release checks,
fresh private recovery, and live legacy inventory are still required.
Domain undo remains a repository candidate until the combined Apps Script release.
P1.6: source recheck confirms financial generators stop at rows 203/503 and the
Debt guard explicitly expects these fixed boundaries. Behavioral reproduction and
remediation for these findings remain required; none is closed by this checkpoint.

Google's [LockService contract](https://developers.google.com/apps-script/reference/lock/lock-service)
returns null for DocumentLock in web app execution. Existing tests that inject an
always-successful DocumentLock do not establish mutual exclusion. The operation
stage must establish a shared ScriptLock contract across all cooperating writers,
including nested calls, before confirmation, undo, or recovery may be released.

## Deferred P2 backlog

| Priority | Item | Dependency |
| --- | --- | --- |
| P2 | Semantic reconciliation | Durable operation and financial invariants |
| P2 | Disabled-to-active binding lifecycle | Existing identity and enrollment contract |
| P2 | Measurement corruption isolation | Append-only measurement schema |
| P2 | Universal release runner | Proven P1-specific migration/release procedure |
| P2 | External backup independence | Existing private backup/restore contract |
| P2 | Calendar history scanning | Queue and Calendar operation safety |
| P2 | Product features | All P1 gates and production verification |
