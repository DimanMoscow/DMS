# P1 combined release procedure

This is the scoped v50 → v51 procedure. Repository readiness does not establish
that HEAD, migrations or production have changed. Production remains v50 until
authenticated read-back proves otherwise.

The MiniApp transition verifier accepts exactly the existing v50 fingerprints or
the final v51 fingerprints. Mixed hashes and unloaded safety modules fail closed.
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

The runner takes positional arguments `phase privateRoot planPath backupPath
inventoryPath v51`. Unused path slots must still be supplied. Phases are explicit;
the CLI never silently advances through editor-only proof or activation. A failed
phase stores details privately and prints no source/API payloads.

Legacy retention copies and verifies each raw ticket in the durable ledger before
removing an unchanged ephemeral key, in batches of at most 50. Cleanup requires an
explicit old-execution drain assertion. It does not delete ledger history or replay
old callbacks. Isolated tests cover consumed, expired, revoked, pending and unknown
legacy states, interruption boundaries and native Sheets read-back.
