# Exact v56/v57 transitional Web — preparation only

This separate branch starts at main `4ab73e2103e85c3e0dd199ac220db51d2ccd61d3`.
The production pointer stays v56. No backend deployment, interlock operation,
scheduled sync, business mutation or main merge is part of this Web commit.

## Contract and proof

`lib/apps-script-runtime-identity.ts` contains a fixed `v56-v57-transition`
phase and exactly two attested numbered source trees. Each entry pins the
service, release, router/P1 aggregate fingerprint, portal fingerprint and
confirmation fingerprint. Both existing loaded markers and `ok: true` are
mandatory. Unknown releases, altered/mixed fingerprints and missing handlers
fail closed. No runtime version range, environment allowlist or request override.

The complete sanitized numbered57 snapshot is copied byte-for-byte from the
owner-verified immutable snapshot, with per-file SHA-256 and full-tree verification.
It is test evidence, not an instruction to deploy Apps Script. Numbered56 and57
trees are respectively `873ec728daf92883c31f67eed8857b092360a7fe1fbba3e3d30d316379470a7d`
and `332ef8a3c8672293598704abf62ee445b496d29d5bbddd4f4f98a9b1c404220c`.

The public runtime probe carries the existing fingerprints, not the complete
numbered-source tree or deployment version. Owner source readback remains a
separate required gate; a matching public response alone is insufficient.
The phase/allowlist is bound to the Web commit by its Git tree. Activation must
pin that exact commit, verify Vercel READY and `/api/health.sourceRevision`, and
retain the independent numbered-source receipt. An artifact cannot contain its
own commit SHA without a circular hash; the external release receipt binds it.

The same compiled Web API handlers, TSX renderer and backend URL configuration
run against BOTH complete actual numbered bundles, with synthetic data and only
Google service-boundary emulators. Actual Telegram HMAC validation and actual
`doPost` handlers run. Tests cover runtime, signed bootstrap/Today/Clients,
active-block/no-block/one-off cards, current/older onboarding preview, Report,
health, expired/invalid auth and rollback 57→56. Workbook values and write counters
must stay unchanged. Missing production triggers/backup in fixtures remain red
health findings; they are never substituted with a fabricated healthy verdict.

New history and registration fields are optional: v56 retains its existing
reads and does not display invented history. v57 supplies independent training
history and older registration rows. Client price is active block price, otherwise
confirmed single price, otherwise an em dash. No auth, API action allowlist,
nonce, locking, replay or Apps Script candidate source is changed.

## Future sequence (requires separate owner permission)

1. Merge this Web-only release under protected-main checks; wait for the sole
   Git-integrated production deployment and exact SHA. Prove signed reads on v56.
2. Before the backend window, verify source, identities, recovery/restore,
   fresh Calendar acceptance and every prepared native operation.
3. CLOSED/readback, fresh 420-second drain, drained original-context inventory.
4. Stage/readback full exact v57 HEAD, then switch the existing mapping to the
   already verified numbered57. GET/runtime checks while CLOSED.
5. Guarded OPEN/readback, immediate signed read-only Telegram/MiniApp smoke,
   reconciliation and absence of unexpected business effects.
6. Regression: CLOSED/readback, new 420-second drain, exact v56 HEAD AND mapping,
   GET/runtime/reconciliation, guarded OPEN and safe signed reads. Keep this Web.
   Do not use v56 Telegram `/today` or `/attention` as read-only smoke.

The HEAD step is essential: native time triggers run the project's head
deployment. Mapping-only activation leaves scheduled code on v56; mapping-only
rollback after staging57 leaves scheduled code on57. No Vercel rollback is
needed for this proven mixed-version Web contract, but HEAD restore is required.

## Closing the migration (not implemented now)

Wait for a natural v57 sync with matching HEAD source identity, advanced generation,
successful completion and completed post-sync evidence. Reconciliation must be
zero; the exact pre-activation drift exception is no longer permitted. Only then
prepare a separate Web-only commit that removes v56 from the fixed allowlist.
Do not force sync, clear alerts, or alter trigger schedules to obtain acceptance.

Operational native timings and the full collector/interlock admission are tracked
separately in PR80; mixed-version fixture success does not claim production
readiness or a measured maximum browser execution time.
