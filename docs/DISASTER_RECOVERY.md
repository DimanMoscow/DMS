# Disaster recovery

The recovery source is a private Google Drive copy of the complete production workbook,
paired with repository release metadata. The in-workbook `Резервные копии бота` sheet is
an operational snapshot and cannot replace this independent copy.

## Backup ceremony

1. Freeze migration writes and record the current Git SHA, Vercel deployment, Apps Script
   numbered version, production pointer, and migration-ledger digest.
2. Use the official Google Drive `files.copy` operation to create an immutable private
   copy in the existing operator-owned Drive. Do not publish it, download it into the
   repository, or broaden sharing.
3. Read the copy back and build a private manifest containing hashed source/copy
   references, all required sheet names (including `Настройки`), row counts, and hashes of headers, formulas,
   validations, and complete sheet structure. The manifest contains no rows or IDs.
4. Run `npm run release:backup:verify -- <private-manifest.json>`. A stale, incomplete,
   unverified, or untested copy fails closed.

Keep at least three copies for at least 30 days. Do not delete older copies until a
separate retention policy is approved. Calendar, Script Properties, Telegram settings,
Apps Script source, and Vercel artifacts are separate systems; record their versions and
safe hashes in the release checkpoint rather than claiming they are inside the workbook.

## Restore test and incident recovery

Restore tests use an isolated workbook. Verify exact sheet structure, formulas,
validations, portal schemas, migration ledger, and safe counters, then run the complete
read-only self-test and reconciliation. Never point production Apps Script at the test
copy.

During an incident, freeze writes, select the last verified copy and matching Git/Vercel/
Apps Script references, restore into an isolated workbook, and repeat all checks. Moving
production to the restored workbook is a separate production-data action. Preserve the
failed workbook and recovery evidence until the incident is closed.

Official mechanisms: [Drive `files.copy`](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/copy),
[Workspace export](https://developers.google.com/workspace/drive/api/guides/manage-downloads),
and [Google Sheets version history](https://support.google.com/docs/answer/190843).

The pre-v50 recovery point preserves the complete 15-sheet production contract. The
current contract and every post-migration manifest include `Журнал операций Telegram`
as the sixteenth sheet. A post-v50 private Drive backup and an isolated restore copy
were verified exactly at the Sheets values layer. Once the ledger contains an event it
is recovery evidence: retain it during rollback and restore, and never truncate it to
make a check pass.
