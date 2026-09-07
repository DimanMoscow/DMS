# DMS Fitness handoff

Last audited: 2026-09-08 (Europe/Moscow).

Use `origin/main`, `AGENTS.md`, relevant current `docs/*`, and live service state.
Old chats, old handoffs, and non-main branches are not authoritative.

## Checkpoint

- Resolve the Git SHA from current `origin/main` at session start.
- MiniApp release `0.2.7`, fingerprint `miniapp-r8-apps-script-runtime-probe`, public
  routes, connected health, source SHA, `no-store`, and Apps Script identity must pass
  the production verifier after each approved merge.
- Apps Script Production is `v51`. Official API read-back proved the 21-file numbered
  snapshot, deployment mapping, and runtime identity. The original-context live gate
  passed `17/17`; reconciliation is `0` across Queue 98, Journal 115, Calendar 101.
- Do not treat v51 as release-ready. Its maintenance interlock remained closed from
  07.09 02:52:57 to 23:36:21 Europe/Moscow. Owner-visible triggers existed with
  correct schedules and fired, but backup 03:06, morning Telegram 08:34, hourly
  Calendar sync, and evening Telegram 22:28 failed with the same paused-mutations
  error. `DMS_TG_FINAL_SETTINGS` had both notifications enabled; no authorization,
  Queue, or Journal fault was found. The next natural Calendar sync at 08.09 00:25
  and watchdog at 00:45 completed after activation.
- Candidate `v52` is the scoped trigger-health correction. Require one owner-bound
  managed trigger per handler, the recorded Europe/Moscow schedule, enabled
  morning/evening settings, and fresh natural successes before the final checkpoint.
  Do not send test digests or create a production backup solely to turn the gate green.
- Latest migration counts: Clients 18; Blocks 16; Payments 21. The independent
  financial guard reports zero formula issues and zero numeric mismatches.
- `telegram-confirmations-v2` and `financial-formulas-v1` are applied. The exact
  17-column append-only ledger is active. Its first two accepted operations were safe
  state-change rejections with `no_mutation`; no ambiguous or manual-review outcome
  was present in the final count-only inspection.
- The v51 interlock is active with both locks available and zero legacy Properties
  tickets. The rollout performed no payment, Calendar, measurement, or binding smoke
  mutation.
- A final owner-only 16-sheet private Drive backup and a separate restore copy matched
  exactly at `2026-09-07T20:50:01Z`. Recovery manifests and all Google identifiers
  remain outside Git.
- Official local Google OAuth is split into reader and writer profiles under the private
  operations directory, conventionally `${DMS_PRIVATE_CHECKPOINTS}/google-auth/`.
  The profiles use exact scopes and Apps Script release no longer depends on Work or
  OAuth Playground. The Google app is still in Testing, so periodic official
  reauthorization may be required until publication prerequisites are completed.
- Calendar onboarding and the nine shared financial anchors remain healthy; `Q-0085`
  was processed exactly once.

## Constraints

- Do not create the pending Hybrid product before a separately confirmed Calendar start.
- Create measurements only through explicit authenticated admin action.
- Do not change prices, business rules, or weaken client/admin access.
- Finish the v52 scheduled-automation blocker before starting P2 or any new functional
  stage.

Release procedure is in `docs/RELEASE_OPERATIONS.md`; recovery is in
`docs/DISASTER_RECOVERY.md`.
