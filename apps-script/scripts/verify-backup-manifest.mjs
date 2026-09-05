#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { sha256 } from "./source-integrity.mjs";
import { assertPrivateRegularFile } from "../../scripts/path-policy.mjs";

const appsScriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(appsScriptRoot, "..");
const hashPattern = /^[0-9a-f]{64}$/;
const production = JSON.parse(
  fs.readFileSync(path.join(appsScriptRoot, "production.json"), "utf8"),
);

function exactKeys(value, keys, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} fields differ`);
}

export function verifyBackupManifest(manifest, {
  contract = JSON.parse(fs.readFileSync(path.join(appsScriptRoot, "backup", "contract.json"), "utf8")),
  productionPointer = production,
  now = new Date(),
} = {}) {
  exactKeys(manifest, [
    "appsScriptVersion", "backupFileRefSha256", "copyVerifiedAt", "createdAt",
    "formatVersion", "migrationLedgerSha256", "provider", "restoreTest", "retention",
    "sheetStructureSha256", "sheets", "sourceSpreadsheetRefSha256",
  ], "backup manifest");
  assert.equal(manifest.formatVersion, contract.formatVersion);
  assert.equal(manifest.provider, contract.provider);
  assert.match(manifest.sourceSpreadsheetRefSha256, hashPattern);
  assert.match(manifest.backupFileRefSha256, hashPattern);
  assert.notEqual(manifest.sourceSpreadsheetRefSha256, manifest.backupFileRefSha256,
    "source and backup references must differ");
  for (const key of ["sheetStructureSha256", "migrationLedgerSha256"]) {
    assert.match(manifest[key], hashPattern, `${key} must be a SHA-256 digest`);
  }
  assert.match(manifest.appsScriptVersion, /^v\d+$/);
  assert.equal(manifest.appsScriptVersion, `v${productionPointer.numberedVersion}`,
    "backup Apps Script version differs from the production pointer");

  const createdAt = new Date(manifest.createdAt);
  const copyVerifiedAt = new Date(manifest.copyVerifiedAt);
  assert.equal(Number.isNaN(createdAt.getTime()), false, "createdAt is invalid");
  assert.equal(Number.isNaN(copyVerifiedAt.getTime()), false, "copyVerifiedAt is invalid");
  assert.ok(copyVerifiedAt >= createdAt, "copy verification predates backup creation");
  const ageHours = (now.getTime() - copyVerifiedAt.getTime()) / 3_600_000;
  assert.ok(ageHours >= 0 && ageHours <= contract.maximumCheckpointAgeHours,
    "backup verification is stale or from the future");

  assert.ok(Array.isArray(manifest.sheets));
  const seen = new Set();
  for (const sheet of manifest.sheets) {
    exactKeys(sheet, [
      "formulaSha256", "headerSha256", "name", "rowCount", "validationSha256",
    ], "sheet checkpoint");
    assert.equal(seen.has(sheet.name), false, `${sheet.name}: duplicate sheet checkpoint`);
    seen.add(sheet.name);
    assert.ok(Number.isInteger(sheet.rowCount) && sheet.rowCount >= 0,
      `${sheet.name}: invalid row count`);
    for (const key of ["headerSha256", "formulaSha256", "validationSha256"]) {
      assert.match(sheet[key], hashPattern, `${sheet.name}: ${key} is invalid`);
    }
  }
  assert.deepEqual([...seen].sort(), [...contract.requiredSheets].sort(),
    "backup manifest does not cover the required workbook sheets");
  const structureMaterial = [...manifest.sheets]
    .sort((left, right) => left.name.localeCompare(right.name, "ru"))
    .map((sheet) => JSON.stringify(sheet))
    .join("\n");
  assert.equal(manifest.sheetStructureSha256, sha256(`${structureMaterial}\n`),
    "sheetStructureSha256 does not match the sheet checkpoints");

  exactKeys(manifest.retention, ["deleteRequiresApproval", "minimumCopies", "minimumDays"],
    "retention");
  assert.ok(manifest.retention.minimumCopies >= contract.retention.minimumCopies);
  assert.ok(manifest.retention.minimumDays >= contract.retention.minimumDays);
  assert.equal(manifest.retention.deleteRequiresApproval, true);

  exactKeys(manifest.restoreTest, ["isolatedWorkbook", "status", "verifiedAt"], "restoreTest");
  assert.equal(manifest.restoreTest.status, "verified");
  assert.equal(manifest.restoreTest.isolatedWorkbook, true);
  const restoreVerifiedAt = new Date(manifest.restoreTest.verifiedAt);
  assert.equal(Number.isNaN(restoreVerifiedAt.getTime()), false,
    "restore test timestamp is invalid");
  const restoreAgeDays = (now.getTime() - restoreVerifiedAt.getTime()) / 86_400_000;
  assert.ok(restoreVerifiedAt >= copyVerifiedAt && restoreAgeDays >= 0 &&
    restoreAgeDays <= contract.maximumRestoreTestAgeDays,
  "restore test is stale, predates copy verification, or is from the future");
  return { ok: true, ageHours, sheetCount: manifest.sheets.length };
}

function runCli() {
  const manifestPath = process.argv[2];
  assert.ok(manifestPath && process.argv.length === 3,
    "Usage: node verify-backup-manifest.mjs <private-backup-manifest.json>");
  const resolvedManifestPath = path.resolve(manifestPath);
  assertPrivateRegularFile(resolvedManifestPath, repositoryRoot, "private backup manifest");
  const manifest = JSON.parse(fs.readFileSync(resolvedManifestPath, "utf8"));
  const result = verifyBackupManifest(manifest);
  process.stdout.write(
    `Private recovery manifest verified: ${result.sheetCount} sheets, age ${result.ageHours.toFixed(1)}h.\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "backup verification failed"}\n`);
    process.exitCode = 1;
  }
}
