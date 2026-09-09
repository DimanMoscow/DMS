# DMS Fitness operations map

Status: audited against `origin/main` `4a1d9568ae30f3cf54e0a6858456bbf656b699ff`, immutable Apps Script `v54`, and the production evidence recorded on 2026-09-09. This document describes the current system; findings below are not claims that the target domain-operation model has already been implemented.

## Runtime boundaries and entry points

| Boundary | Production entry points | Authentication / authority | Current role |
| --- | --- | --- | --- |
| Vercel MiniApp | `/`, `/client`, `POST /api/dms`, `GET /api/health` | Telegram `initData` is passed only to Apps Script; the health route is public and redacted | UI, strict action allow-list, request validation, 20 s upstream timeout, PII-free request totals, release/runtime identity |
| Apps Script web app | `doGet`, `doPost` | public runtime probe; MiniApp HMAC validation; Telegram webhook secret and admin allow-list | routes MiniApp requests, Telegram messages and Telegram callbacks |
| Telegram admin | messages/commands and callback queries through `doPost` | webhook secret, Telegram admin identity, secure confirmation ticket for writes | operational reads and the broadest write surface |
| Admin MiniApp | `bootstrap`, `client`, `health`, `set_queue_decision`, `confirm_day`, portal administration, measurements, Calendar onboarding | signed Telegram `initData`, admin allow-list | mobile admin reads and selected writes |
| Client portal | `resolve_miniapp_entry`, `client_portal_bootstrap`, `client_portal_enroll` | signed Telegram `initData`; active binding or single-use invite | client-scoped read view and enrollment |
| Bound spreadsheet UI | `onOpen`, `onEdit`, `setupDmsFitness`, `addTrainingFromSelectedRow`, `closeBlockFromSelectedRow`, `cancelTrainingFromSelectedRow`; queue preview/process/setup functions | Google account with access to the bound spreadsheet | manual administration and compatibility entry points |
| Calendar automation | `syncCalendarToQueue`, `previewDmsCalendarQueueSync`, `installCalendarSyncTrigger` | installable trigger owner or authorized script operator | Calendar ingestion into the confirmation queue |
| Scheduled automation | `createDmsAutomaticBackup`, `sendTelegramMorningDigest`, `sendTelegramDailyQueue`, `syncCalendarToQueue`, `runDmsWatchdog` | one owner-bound managed trigger set | backup, notifications, ingestion, health supervision |
| Backup / recovery | `createTelegramDataBackup`, `validateLatestDmsBackup`, `runDmsBackupRestoreDryRun`, automatic backup; local backup and isolated restore runners | script owner for Drive copies; local writer profile only for explicit release work | creates and verifies backups; restore validation runs against an isolated copy |
| Maintenance / recovery | Calendar cancellation repair, exhausted-block repair, reconciliation preview/repair, queue validation repair, monitoring/setup helpers | explicit operator execution in the bound script | exceptional repair paths; several write directly under the shared lock |
| Release / migration | `apps-script/scripts/release-*.mjs`, preflight/runtime/source/backup verifiers, migration runners under `apps-script/migrations/*` | separated local reader/writer Google profiles; GitHub CI | backup, candidate verification, HEAD staging, numbered-version publish, deployment mapping and isolated migrations |

The five production trigger handlers are managed as one set by `installDmsScheduledAutomation()`: backup daily at 03:00, morning digest daily at 08:00, evening queue daily at 22:00, Calendar sync hourly, and watchdog every two hours (`Europe/Moscow`). The older per-feature trigger installers delegate to this managed installer.

### Exact callable Apps Script surface

The following global functions are present in v54. Functions ending in `_` are internal and are represented by the domain rows below.

| Surface | Global functions |
| --- | --- |
| Spreadsheet lifecycle and menu | `onOpen`, `onEdit`, `setupDmsFitness`, `addTrainingFromSelectedRow`, `closeBlockFromSelectedRow`, `cancelTrainingFromSelectedRow` |
| Queue administration | `setupQueueProcessing`, `previewSelectedQueueDay`, `previewOldestQueueDay`, `processSelectedQueueDay`, `selfTestQueueProcessing` |
| Calendar | `syncCalendarToQueue`, `previewDmsCalendarQueueSync`, `installCalendarSyncTrigger` |
| Telegram web app and setup | `doGet`, `doPost`, `installTelegramAutomation`, `repairTelegramWebhook`, `uninstallTelegramAutomation`, `getTelegramSetupStatus`, `logTelegramWebhookHealth`, `discoverTelegramAdmin`, `sendTelegramTestMessage`, `inspectDmsDataSchema` |
| Telegram notifications | `sendTelegramMorningDigest`, `sendTelegramDailyQueue`, `installTelegramNotificationTriggers` |
| Backup | `createTelegramDataBackup`, `validateLatestDmsBackup`, `runDmsBackupRestoreDryRun`, `createDmsAutomaticBackup`, `installDmsBackupTrigger` |
| Health, maintenance and recovery | `authorizeDmsCalendarWrite`, `repairDmsCalendarCancellations`, `closeAllExhaustedBlocks`, `runDmsMaintenance`, `repairDmsExhaustedQueueRows`, `getDmsSystemHealth`, `runDmsReadOnlySelfTests`, `runDmsCalendarQueueReconciliation`, `previewDmsCalendarQueueRepair`, `repairDmsCalendarQueueReconciliation`, `repairDmsCalendarCancellationQ0038`, `runDmsBackupSetupV31`, `runDmsWatchdog`, `installDmsWatchdogTrigger`, `runDmsMonitoringSetupV32`, `repairDmsQueueSourceValidation` |
| MiniApp setup and self-tests | `runDmsMiniAppReadOnlyApiSelfTest`, `runDmsMiniAppAuthAndBootstrapSelfTest`, `configureDmsMiniAppMenuButton`, `getDmsMiniAppMenuButtonStatus`, `runDmsMiniAppAdminSelfTest` |
| Release safety and managed schedule | `installDmsScheduledAutomation`, `getDmsScheduledAutomationHealth`, `inspectDmsP1ReleaseState`, `startDmsP1ExecutionDrain`, `activateDmsP1Release` |

The release activation and repair/setup functions are callable globals because Apps Script operators run them from the editor. They are control-plane entry points and must not be exposed as MiniApp or Telegram actions.

## Operation inventory

“Shared mutation lock” means `getDmsMutationLock_()` / ScriptLock. Telegram `cf2` adds a durable ticket and operation ledger around that lock. “Direct” means the operation has its own validation and write orchestration and is not yet executed through a transport-neutral domain-operation contract.

| Operation | Entry points | Canonical domain function | Reads | Writes | Lock | Side effects | Audit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Runtime identity | Apps Script `doGet`; Vercel `/api/health`; release smoke | runtime probe; `getMiniAppSourceRevision()` | release constants, Vercel config | none | none | HTTP response | deployment/source evidence outside runtime |
| MiniApp transport | Vercel `POST /api/dms` → Apps Script `doPost` → `handleDmsMiniAppRequest_` | none; transport allow-list and router | request envelope, release config | none directly | none | Apps Script HTTP call | PII-free action/status/duration in Vercel; safe failure class in Apps Script |
| Admin dashboard | MiniApp `bootstrap`; Telegram `/today`, `/attention`, balances, debt, reports | `getDmsMiniAppBootstrap_` and Telegram view builders (parallel read models) | Clients, Blocks, Queue, Journal, Payments, Settings | none, except several Telegram views first run Calendar sync | Calendar sync takes shared lock | possible Calendar API calls and queue writes before a read response | request total only; no component timings |
| Client detail | MiniApp `client`; Telegram client cards/search | `getDmsMiniAppClient_` and Telegram card builders (parallel read models) | client-scoped Clients, Blocks, Journal, Payments | none | none | none | none |
| Client portal bootstrap | `client_portal_bootstrap` | `handleDmsClientPortalRequest_` | Access, Clients, Blocks, Journal, Payments, Measurements | none | none | HTTP response | redacted API failure only |
| Client portal enrollment | `client_portal_enroll` | `handleDmsClientPortalEnrollmentRequest_` | Invitations, Access, client record | Access binding; invitation state/timestamps | shared mutation lock | binding activation | invitation and access sheet records |
| Portal invite creation | MiniApp `create_client_portal_invite` | `createDmsClientPortalInvite_` | Clients, Access, Invitations | revocation/creation rows in Invitations | shared mutation lock | returns one-time start parameter | invitation ledger rows |
| Portal invite revocation | MiniApp `revoke_client_portal_invite` | `revokeDmsClientPortalInvite_` | Invitations | invitation status/timestamps | shared mutation lock | none | invitation ledger row update |
| Measurement creation | MiniApp `create_client_measurement` | `createDmsClientPortalMeasurement_` | Clients, Measurements | Measurements append | shared mutation lock | client portal data changes | measurement record contains actor and operation metadata |
| Measurement correction | MiniApp `correct_client_measurement` | `correctDmsClientPortalMeasurement_` | Clients, Measurements | append-only correction/supersession records | shared mutation lock | client portal data changes | measurement history contains actor and operation metadata |
| Queue decision | Telegram `qd:*`; MiniApp `set_queue_decision`; move workflow | `setTelegramQueueDecision_` owns the shared validation, mutation, and domain-result shape | Queue | decision/status/source/comment | shared mutation lock; Telegram creates and accepts `cf2` internally on the original row click | Telegram message refresh or starts Calendar move | Telegram operation ledger and queue `[tgop:*]`; MiniApp has no durable operation ledger |
| Day confirmation | Telegram `qp:*`; MiniApp `confirm_day`; spreadsheet `processSelectedQueueDay` | stabilization candidate: `executeDmsDayConfirmation_` owns accepted-row validation, preflight, processing, Calendar cancellation, and one result shape; sheet menu remains a control-plane path | Queue, Clients, Blocks, Journal, accepted Calendar targets | Journal, Queue, Blocks, Clients; conditional Calendar cancellations | shared mutation lock; Telegram also has `cf2` lifecycle | Calendar delete; Telegram edit | Telegram operation ledger/action audit; MiniApp returns the same domain result but has no durable operation ledger yet |
| Calendar ingestion | hourly trigger, manual sync, inline Telegram reads, morning/evening notifications | `syncCalendarToQueue` → reconcile/plan/apply/reconcile | Calendar, Clients, Queue, Journal, Settings, trigger metadata | Queue, Settings, sync generation/watermark properties | shared mutation lock | Calendar API reads, spreadsheet toast | scheduled handler total and generation/reconciliation evidence |
| Calendar sync preview | `previewDmsCalendarQueueSync` | `buildCalendarQueueSyncPlan_` | Calendar, Clients, Queue, Settings | none | none | Calendar API reads | redacted counts printed |
| Calendar onboarding preview | MiniApp `preview_calendar_onboarding` | `previewDmsCalendarOnboarding_` | Queue, Clients, Journal, product/payment input | none | none | none | none |
| Calendar onboarding resolve | MiniApp `resolve_calendar_onboarding` (`new`, `link`, `ignore`) | `resolveDmsCalendarOnboarding_` and mode-specific applicators | Queue, Clients, Blocks, Payments, Journal | Queue; alias, or new Client/Block/optional Payment; audit | shared mutation lock | source Calendar event remains unchanged | Admin Audit with actor and reversible captures |
| Payment creation | Telegram secure payment; onboarding optional payment | `confirmTelegramPayment_`; `appendDmsCalendarOnboardingPayment_` is independent | Clients, Blocks, Payments | Payments; related formulas/state | shared mutation lock via caller; Telegram `cf2` lifecycle | Telegram edit/message | operation ledger + Admin Audit for Telegram; onboarding action audit owns its compound rollback |
| Payment void | Telegram `ops:voidPaymentYes:*` | `confirmTelegramVoidPayment_` | Payments and related client/block state | void status and related financial state | shared mutation lock + `cf2` lifecycle | Telegram response | operation ledger + Admin Audit |
| Calendar event create | Telegram schedule confirmation | `confirmTelegramSchedule_` | Clients/blocks/settings and Calendar conflicts | Calendar event | shared mutation lock + `cf2` lifecycle | Calendar insert, Telegram response | operation ledger; `dmsOperationId` extended property enables recovery |
| Calendar event move | Telegram upcoming/queue move | `confirmTelegramUpcomingMove_` / queue move path | Queue, Calendar, cached accepted state | Calendar event and Queue | shared mutation lock + `cf2` lifecycle | Calendar update, Telegram response | operation ledger and action audit |
| Calendar event cancel | Telegram upcoming cancellation; day processing cancellation | `confirmTelegramUpcomingCancellation_`; `applyTelegramCalendarCancellationsForDate_` | Queue, Calendar | Calendar delete and queue cancellation evidence | shared mutation lock through caller | Calendar delete, Telegram response | operation/action audit and queue evidence |
| Client create | Telegram management; Calendar onboarding `new` | Telegram management creator; `applyDmsCalendarOnboardingNewClient_` is an independent compound implementation | Clients, Blocks, optional Payments, Queue | Client, optional Block/Payment, Calendar aliases, Queue | shared mutation lock; Telegram `cf2` lifecycle | Telegram response | Admin Audit; onboarding captures ranges for rollback |
| Client rename / price | Telegram secure management | `confirmTelegramRenameClient_`, `confirmTelegramSinglePrice_` | Clients | Clients | shared mutation lock + `cf2` lifecycle | Telegram response | operation ledger + Admin Audit |
| Client archive / restore | Telegram secure management | `confirmTelegramArchiveClient_`, `confirmTelegramRestoreClient_` | Clients and linked state | Clients and linked lifecycle state | shared mutation lock + `cf2` lifecycle | Telegram response | operation ledger + Admin Audit |
| Block create / edit | Telegram management; Calendar onboarding `new` | Telegram block functions; onboarding writes the block independently | Clients, Blocks, optional Payments | Blocks, Clients, optional Payments | shared mutation lock; Telegram `cf2` lifecycle | Telegram response | operation ledger + Admin Audit; onboarding compound audit |
| Block pause / resume / close / gift | Telegram secure callbacks; selected-row close; automatic exhaustion maintenance | status/gift helpers; `autoCloseExhaustedBlock_` for exhaustion | Blocks, Clients, Journal | Blocks and current Client link | shared mutation lock for current paths | Telegram response | operation ledger + Admin Audit for Telegram; row/status evidence for maintenance |
| Undo | Telegram `ops:undoYes:*` | `performTelegramUndo_` | Admin Audit and target ranges | operation-specific compensating writes | shared mutation lock + `cf2` lifecycle | Telegram response | new undo audit plus durable operation result |
| Reconciliation | watchdog/self-tests, Calendar sync pre/post, manual run | `runDmsCalendarQueueReconciliation` | Calendar, Queue, Journal, sync generation/watermark | none | caller-dependent; read-only run has none | Calendar API reads | redacted counts/evidence |
| Reconciliation repair | manual preview/repair, specific cancellation repair | repair functions in `ZZZZZZZRuntime.gs` | Calendar, Queue, Journal, Clients/Blocks as needed | Queue and/or Calendar cancellation evidence | shared mutation lock on mutating repairs | Calendar API write in cancellation repair | console result and row evidence; no common operation ledger |
| Backup | daily trigger, Telegram secure backup, manual backup | `createTelegramDataBackup` / `createDmsAutomaticBackup` | all protected data sheets and Drive backup metadata | Drive folder/files and backup manifest/status | shared mutation lock in manual core | Drive copy, validation, optional Telegram response | Admin Audit + scheduled health; private local manifest for release backup |
| Backup validation / restore rehearsal | manual validation; `runDmsBackupRestoreDryRun`; local isolated worker | backup validator and isolated restore tooling | backup copy/manifest and all protected sheets | isolated restore copy only | isolated target | Drive/API activity outside production data | private manifest and redacted result |
| Watchdog / system health | two-hour trigger; `getDmsSystemHealth`; `runDmsReadOnlySelfTests`; `getDmsScheduledAutomationHealth` | current health and self-test functions | schema, formulas, triggers, release marker, ledgers, reconciliation inputs | scheduled success/failure record only | no domain lock for read checks | possible Calendar API reads; Telegram alert on failure | safe error class, total duration, deduplicated alert signature |
| Scheduled notifications | 08:00 and 22:00 triggers | `sendTelegramMorningDigest`, `sendTelegramDailyQueue` | Settings plus dashboard/queue/attention data; currently Calendar sync first | queue/settings through inline sync; scheduled result record | shared lock during inline sync | Telegram send | scheduled total duration and Telegram delivery result |
| Trigger installation | managed installer and compatibility installers | `installDmsScheduledAutomation` | project triggers, owner, settings, time zones | trigger set and manifest properties | ScriptLock | create/delete Apps Script triggers | manifest and health read-back |
| Spreadsheet manual operations | custom menu and selected-row functions | legacy/current row helpers | active selection and domain sheets | Journal/Blocks/Queue depending on action | path-dependent | spreadsheet UI alerts/toasts | sheet rows; not uniformly in Admin Audit/operation ledger |
| Maintenance | `runDmsMaintenance`, exhausted queue/block repair, queue validation repair | operation-specific repair functions | Queue, Clients, Blocks, Journal, Calendar cancellation evidence | affected operational rows and Calendar cleanup | shared mutation lock per repair; compound maintenance reacquires by step | Calendar delete, console output | result counts and row evidence; no common operation ledger |
| Release | local plan/preflight/release runners | release runner for the requested version | Git snapshot, Google HEAD/version/deployment, backup manifest, trigger/runtime evidence | candidate HEAD, numbered version, deployment, release marker only in approved rollout | local phase gates plus runtime drain/ScriptLock activation | Google APIs and live read-only gates | private phase artifacts, immutable Git snapshot, checkpoint docs |
| Migration | versioned local migration runners and ledgers | migration-specific runner | source spreadsheet, schema, migration ledger | isolated target first; production only in approved release | migration-specific guards | Google Sheets API | append-only migration ledger and Git fixtures |

## Independently implemented business paths

These are active paths that implement overlapping business behavior independently. Compatibility wrappers and immutable historical version snapshots are excluded.

| ID | Severity | Overlap | Evidence and risk |
| --- | --- | --- | --- |
| D1 | high | Telegram mutation dispatcher vs domain operations | `executeTelegramSecureMutation_` is a Telegram-specific switch covering payments, Calendar writes, queue/day decisions, client/block lifecycle, undo, settings and backup. The durable `cf2` lifecycle surrounds transport handlers rather than a transport-neutral domain command/result. Other transports cannot reuse that safety contract. |
| D2 | medium | Day confirmation | The stabilization candidate routes Telegram and MiniApp through `executeDmsDayConfirmation_`, compares the accepted row set, uses one preflight/processing/Calendar contract and returns one result shape. MiniApp no longer imports unseen Calendar rows during acceptance and captures Calendar preconditions for conditional deletion. Telegram still owns the durable `cf2` result; MiniApp needs the transport-neutral durable adapter before this finding can close. |
| D3 | medium | Queue decision | The stabilization candidate shares validation, source write, idempotent-value behavior, and the domain-result shape through `setTelegramQueueDecision_`. Telegram still adds `[tgop:*]` and a durable `cf2` result while MiniApp has lock/idempotent-value behavior only, so replay evidence is not yet transport-neutral. |
| D4 | medium | Client/block/payment creation | Calendar onboarding `new` composes its own Client, Block and optional Payment writes with captured rollback. Telegram management uses separate creator/payment/block functions and the `cf2` ledger. Invariants can drift between the two production paths. |
| D5 | medium | Read models that trigger ingestion | Telegram dashboard/attention and scheduled notifications run `syncCalendarToQueue()` inline, while the hourly trigger owns the same ingestion. A nominal read therefore becomes a write workflow and can repeat the full scan around the scheduled run. |
| D6 | medium | Manual spreadsheet and repair mutations | selected-row actions and repair functions mutate the same entities through path-specific validation/audit. They are legitimate control-plane paths, but are not represented by the durable domain operation lifecycle. |

## Performance baseline before optimization

The live values below are the latest safe production evidence in `docs/PROJECT_STATE.md`. They are total handler times from the v54 scheduled-health record, not a percentile or a component trace.

| Path | Observed production total | Work visible from source | What is and is not proven |
| --- | ---: | --- | --- |
| Morning digest | 12.854 s at 08:10:54 | inline Calendar sync, dashboard, attention summary, Telegram send | total is proven; lock/Sheets/Calendar/Telegram shares are unknown |
| Evening queue | 22.109 s at 22:52:23 | inline Calendar sync, queue view, Telegram send | total is proven; the reason it exceeded morning is not measured |
| Hourly Calendar sync | 7.852 s at `2026-09-09T20:21:19.759Z` | pre-reconciliation, plan, per-row writes, flush, post-reconciliation | total is proven; component and volume data are absent |
| Automatic backup | completed in its expected window | reads/copies/validates protected sheets and records scheduled success | exact duration was not preserved in checkpoint docs |
| Native financial write/recalculate/read verification | 2.0–3.1 s; tenfold fixture 2.26 s | isolated Sheets write, recalculation and read-back | includes API latency; it is not a production request latency sample |
| MiniApp API | PII-free per-request total exists in Vercel logs | Vercel validation/proxy plus Apps Script action | no aggregated v54 baseline or upstream component split is checked into Git |

Static work amplification explains the first optimization target without pretending to explain each live duration:

- One `syncCalendarToQueue()` performs Calendar reconciliation before planning, a second Calendar listing for the plan, and reconciliation after the write. Each path scans from the persistent start date in `Настройки!B15` through tomorrow, so the window grows over the lifetime of the system. This is at least three full-history Calendar listings per successful sync.
- The same sync reads the operational sheets needed by reconciliation and planning, including full Queue and Journal ranges, more than once.
- `applyCalendarQueueSyncPlan_()` issues one `setValues()` call per changed queue row and may copy a template per inserted row.
- There are 21 static `syncCalendarToQueue()` call sites in current Telegram sources, including the morning/evening handlers. This creates avoidable lock contention and repeated ingestion around the hourly owner.
- v54 records only total scheduled duration. It does not measure lock wait, Sheets reads/writes, Calendar calls, Telegram calls, reconciliation time, row/event counts, or retries. Optimization must first add bounded, PII-free component metrics, then capture comparable before/after samples.

The largest measured totals are evening queue (22.109 s), morning digest (12.854 s), Calendar sync (7.852 s), then the isolated native financial interval (2.0–3.1 s). Calendar work amplification is a proven cause of unnecessary service calls. Its exact contribution to the three scheduled totals remains unmeasured.

## Reliability gaps to close

1. Introduce a transport-neutral immutable command/result contract and durable lifecycle for the critical queue decision and day-confirmation operations first. Preserve the deliberate accepted-queue boundary while making it an explicit command option/invariant.
2. Instrument total, lock wait, Sheets read/write, Calendar, Telegram and reconciliation durations plus safe counts/retries. Metric keys must be allow-listed and must never contain client, event, invite, payment or Telegram identifiers.
3. Bound Calendar ingestion without losing cancellation/move detection. The durable generation/watermark is causal evidence, not yet a bounded query cursor; a safe design needs overlap, late-event handling and a periodic wider verification window.
4. Separate fresh-enough ingestion from read presentation so Telegram reads and digests do not each force a full sync. Health must report `awaiting_sync` or `delayed` during allowed eventual consistency rather than alerting immediately.
5. Normalize health to `healthy`, `not_due_yet`, `awaiting_sync`, `delayed`, `failed`, `stale`, `manual_review`, while retaining underlying evidence for runtime/version, scheduled handlers, reconciliation, pending operations, contention, errors and Vercel connectivity.
6. Add semantic reconciliation beyond count parity, then cover disabled-binding reactivation/invitation lifecycle and isolate malformed measurement rows so one corrupt record cannot suppress the entire client view.
7. Put manual repair and spreadsheet mutations behind explicit control-plane operation records or a documented exception with equivalent audit evidence.

## Planned PR sequence

1. **Operations map and baseline** — this inventory plus a drift test; no runtime change.
2. **Safe operation metrics** — PII-free timing/count collector, component instrumentation and fake-clock/unit coverage; behavior unchanged.
3. **Canonical queue decision** — shared validation/result is implemented in the stabilization candidate; add a transport-neutral durable execution adapter for MiniApp parity.
4. **Canonical day confirmation** — shared accepted-row/preflight/Calendar/result orchestration is implemented in the stabilization candidate; add the same durable adapter and fault-injection coverage for MiniApp retries.
5. **Bounded Calendar ingestion** — overlap cursor/watermark, batched Queue writes and periodic wide reconciliation; measured before/after evidence.
6. **Unified health** — normalized states and cross-runtime evidence, with eventual-consistency states excluded from premature alerts.
7. **P2 reliability** — semantic reconciliation, binding lifecycle, measurement corruption isolation and acceptance matrix.
8. **Milestone release** — fresh backup/isolated restore, candidate snapshot, auth preflight, Google-assigned numbered version, deployment update, runtime/live/reconciliation/health/read-only smoke, then checkpoint docs. No production business mutation is used for smoke.

Until the milestone release, implementation PRs update the next candidate snapshot and tests only. Immutable numbered snapshots and production remain unchanged.
