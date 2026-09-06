# P1 remediation

Baseline: `178a3503a11ed7c02e65fca52010cc0bb0f23007`, fetched from `origin/main`.
The initial worktree was clean and there were no open PRs. GitHub main CI run
34058626281 succeeded. Vercel Production was READY at the same source SHA.
An authenticated reader preflight matched production numbered v50, HEAD, and the
complete Git snapshot. The Telegram operation ledger was present and empty.
The private recovery manifest passed the 16-sheet contract with approximately
1.2 hours of age; its isolated restore evidence passed the repository DR policy.
Schema remains `telegram-confirmations-v1`; no migration has been applied here.

## Ingress (P1.1)

Reproduced on the complete v50 bundle: malformed JSON reaches the outer error
handler before authentication and appends a row through the real audit function.
Candidate v51 rejects empty, oversized, scalar, array, and malformed input without
persistent error handling. The route boundary emits a fixed platform log message,
never request or exception text. MiniApp authentication and webhook authentication
remain separate; valid webhook dispatch and update deduplication are preserved.

The 13 behavioral tests in `tests/apps-script-ingress-safety.test.mjs` load all 16
server source files, include the old failure, repeat rejected requests 20 times,
and observe Sheet writes at the service boundary. Candidate v51 is a repository
candidate only; production remains v50 until the combined remediation release.

## Remaining P1 gates

P1.2/P1.4/P1.5: source recheck confirms mutable session reads after acceptance,
an indefinitely pending replay path, and no confirmation-property retention.
P1.3: source recheck confirms generic clear/restore undo validates range shape but
does not validate current state or domain references.
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
