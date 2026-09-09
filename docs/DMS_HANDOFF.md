# DMS Fitness handoff

Last verified: 2026-09-09 (Europe/Moscow).

Use `origin/main`, `AGENTS.md`, current `docs/*`, and live service state. Old
conversations and non-main branches are not authoritative.

## Production checkpoint

- Apps Script Production is immutable numbered `v54`; all 21 files, deployment mapping,
  and runtime identity `calendar-ingestion-stabilization` matched the reviewed candidate.
- The final live gate passed 19/19 at `2026-09-09T21:12:57.203Z`; reconciliation was zero after
  the natural Calendar sync at `2026-09-09T20:21:19.759Z`.
- A Calendar event arriving between successful sync windows was observed live as
  `awaiting_sync`, with zero actionable drift, alarm, or repair. The next successful
  sync cleared it. Watchdog decisions use durable sync generations and revision evidence,
  so they do not depend on relative cron timing.
- Five owner-bound triggers remain configured in `Europe/Moscow`. Natural backup,
  morning, evening, and post-activation Calendar runs are healthy. Evening completed at
  22:52:23; Calendar completed at `2026-09-09T20:21:19.759Z`. No trigger was reinstalled.
- The release drain caused expected maintenance failures for the 22:10 watchdog and
  22:21 Calendar run; activation finished at 22:22 and later natural runs recovered.
- The repository gate passes 212/212 tests, dependency audit zero, production build,
  exact snapshot verification, and migration checks.
- The fresh private pre-v54 recovery copy and isolated restore verification cover all
  16 required sheets. Private manifests and production identifiers remain outside Git.
- The MiniApp pointer expects v54. The checkpoint merge's automatic Vercel Production
  deployment is the only deployment for that commit and must match final `origin/main`.

## Operating constraints

- Do not manually repair Calendar or mutate business data merely to make a health gate
  green. Let Calendar sync own ingestion and post-sync reconciliation.
- Treat `awaiting_sync` as non-actionable. Alert reconciliation only for
  `drift_after_successful_sync`; report missing/delayed/failed sync with its own class.
- Preserve immutable versions v53/v54, confirmation and migration ledgers, and private
  recovery evidence. Do not change product behavior, pricing, or access boundaries.
- If a new security or race ambiguity appears, stop and escalate to Astra. Otherwise
  start no new milestone from this checkpoint.

Release procedure is in `docs/RELEASE_OPERATIONS.md`; recovery is in
`docs/DISASTER_RECOVERY.md`.