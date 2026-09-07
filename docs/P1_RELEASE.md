# P1 combined release procedure

This is the scoped v50 → v51 procedure that was executed on 2026-09-06/07.
Repository readiness alone did not establish a production change; the final state
below is based on authenticated read-back and original-context live checks.

During the staged rollout the MiniApp transition verifier accepted exactly the v50
or v51 fingerprints. The production checkpoint now accepts only v51. Mixed hashes
and unloaded safety modules fail closed.
The v51 confirmation fingerprint covers all five safety modules, including undo,
financial checks and the release interlock. Numbered-source comparison still
covers every file. Remove the v50 bridge after the successful backend checkpoint.

1. Merge all P1 changes after the complete release gate, CI and isolated tests.
   Generate and verify the offline v51 plan from that exact Git revision. Validate
   reader/writer credential profiles separately, then authenticate.
2. Run the `backup` phase of `apps-script/scripts/release-v51.mjs`. It creates an
   owner-only Drive backup and a separate restore copy, compares all 16 sheets,
   entered values/formulas, formats, validations and notes, and records the current
   migration ledger. It refuses a source that changes during copying. Private
   recovery material and target references never enter Git.
3. Run `stage` using the fresh manifest. The phase requires unchanged v50 HEAD and
   production, writes the full candidate and compares read-back. Installable
   triggers now execute the paused candidate. Existing v50 web-app executions may
   still finish; no migration is performed yet.
4. In the original Apps Script editor run the reviewed
   `inspectDmsP1ReleaseState`. Save its count-only report privately. A web-app
   execution cannot inventory Document Properties. Unknown legacy state is
   retained; malformed evidence blocks publication and requires private recovery.
5. Run `publish` with the fresh inventory. It creates numbered v51, compares all
   source bytes, and updates the existing deployment. v51 starts with mutations
   paused because `DMS_P1_RELEASE_READY` is absent. Verify the public runtime probe
   and Vercel bridge before running `startDmsP1ExecutionDrain` in the editor.
6. Wait at least 420 seconds after that marker. Google documents a
   [six-minute execution limit](https://developers.google.com/apps-script/guides/services/quotas);
   the extra minute is margin. The new web-app, scheduled mutation entry points,
   checkbox handlers and shared mutation lock refuse writes during this interval.
   Do not invoke unguarded legacy editor helpers or manually edit business cells.
7. Read a new original-context inventory and run `migrate`. This rechecks v51
   HEAD/deployment/runtime, fresh inventory and drain time, creates another verified
   private recovery point, extends the operation ledger to 17 columns without
   changing history, then installs the nine financial anchors in one atomic Sheets
   request while preserving input columns. The manifest records the actual paused
   v51 runtime. All original legacy Properties remain available.
8. Run `activateDmsP1Release` in the original editor. Under ScriptLock it requires
   the completed drain, exact ledger headers, independent numeric financial gate
   and valid legacy inventory before setting the v51 readiness property. Then run
   the read-only self-tests and reconciliation, runtime identity and MiniApp reads.
   Do not send real payment, Calendar, measurement or binding mutations for smoke.
9. Record immutable v51 sources, verified migration artifacts, production identity,
   backup/restore evidence and live results. Pin the MiniApp to v51 after the
   checkpoint. A default rollback to v50 is unsafe after shared formula ownership
   or cf2 acceptance; preserve the paused state and evidence on a failed gate.

## Execution record

- The exact 21-file candidate and numbered v51 matched tree
  `4893e98864e18bd879597ce2f1c32a000e5e04ee2d1f25a324fc22dc0729103b`.
  Publication began paused; the public runtime probe matched before migration.
- Original-context inventory found zero legacy tickets and zero ledger rows before
  migration. The old-execution drain began at `2026-09-06T23:52:57Z`; migration
  ran only after the 420-second gate. The ledger v2 and financial packages each
  made one declared schema/formula write while payment, Calendar, measurement, and
  binding writes remained zero.
- `activateDmsP1Release` completed with the financial and retention gates true.
  The final inspection at `2026-09-07T20:42:35Z` reported `mutationReady: true`,
  no legacy Properties tickets, and both locks available.
- The read-only gate passed 17/17 and the separate reconciliation reported zero
  issues across 98 Queue rows, 115 Journal rows, and 101 Calendar events. The two
  early failed operation outcomes were safe `underlying_state_changed` rejections
  with `no_mutation`; there was no ambiguous or manual-review result.
- A final owner-only v51 backup and separate restore copy matched all 16 sheets at
  `2026-09-07T20:50:01Z`. The private recovery paths and identifiers are omitted
  from Git by policy.

The runner takes positional arguments `phase privateRoot planPath backupPath
inventoryPath v51`. Unused path slots must still be supplied. Phases are explicit;
the CLI never silently advances through editor-only proof or activation. A failed
phase stores details privately and prints no source/API payloads.

Legacy retention copies and verifies each raw ticket in the durable ledger before
removing an unchanged ephemeral key, in batches of at most 50. Cleanup requires an
explicit old-execution drain assertion. It does not delete ledger history or replay
old callbacks. Isolated tests cover consumed, expired, revoked, pending and unknown
legacy states, interruption boundaries and native Sheets read-back.
