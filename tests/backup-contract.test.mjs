import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { verifyBackupManifest } from "../apps-script/scripts/verify-backup-manifest.mjs";

const fixture = JSON.parse(fs.readFileSync("tests/fixtures/backups/valid.json", "utf8"));
const now = new Date("2026-09-05T01:00:00Z");

test("private Drive-copy recovery manifest covers the complete workbook contract", () => {
  const result = verifyBackupManifest(fixture, { now });
  assert.equal(result.ok, true);
  assert.equal(result.sheetCount, 16);
});

test("recovery manifest binds the aggregate structure and production version", () => {
  const changed = structuredClone(fixture);
  changed.sheets[0].rowCount += 1;
  assert.throws(() => verifyBackupManifest(changed, { now }), /sheetStructureSha256/);

  const oldVersion = structuredClone(fixture);
  oldVersion.appsScriptVersion = "v48";
  assert.throws(() => verifyBackupManifest(oldVersion, { now }), /production pointer/);
});

test("recovery manifest fails closed when a sheet is missing", () => {
  const invalid = structuredClone(fixture);
  invalid.sheets.pop();
  assert.throws(() => verifyBackupManifest(invalid, { now }), /required workbook sheets/);
});

test("recovery manifest rejects stale and untested backups", () => {
  assert.throws(
    () => verifyBackupManifest(fixture, { now: new Date("2026-09-08T01:00:00Z") }),
    /stale/,
  );
  const untested = structuredClone(fixture);
  untested.restoreTest.status = "not-run";
  assert.throws(() => verifyBackupManifest(untested, { now }), /not-run/);
});
