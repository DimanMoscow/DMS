#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { verifyBackupManifest } from "../apps-script/scripts/verify-backup-manifest.mjs";
import { verifyMigrationRepository } from "../apps-script/scripts/migration-integrity.mjs";
import { assertPrivateRegularFile } from "./path-policy.mjs";

export function verifyTargetDependencies(migrationId, migrationState) {
  const dependencies = migrationState.dependencies[migrationId];
  assert.ok(dependencies, `${migrationId}: migration is missing from the catalog`);
  for (const dependency of dependencies) {
    assert.ok(migrationState.applied.includes(dependency),
      `${migrationId}: dependency ${dependency} is not applied`);
  }
  return true;
}

export function verifyMigrationReadiness({ migrationId, backupManifestPath, repositoryRoot }) {
  const migrationsRoot = path.join(repositoryRoot, "apps-script", "migrations");
  const migrationState = verifyMigrationRepository({ repositoryRoot, migrationsRoot });
  assert.ok(fs.existsSync(path.join(migrationsRoot, migrationId, "migration.json")),
    `${migrationId}: migration package is missing`);
  assert.equal(migrationState.applied.includes(migrationId), false,
    `${migrationId}: migration is already recorded as applied`);
  verifyTargetDependencies(migrationId, migrationState);

  const resolvedBackupManifest = path.resolve(backupManifestPath);
  assertPrivateRegularFile(resolvedBackupManifest, repositoryRoot, "private backup manifest");
  const backupManifest = JSON.parse(fs.readFileSync(resolvedBackupManifest, "utf8"));
  const backup = verifyBackupManifest(backupManifest);
  assert.equal(backupManifest.migrationLedgerSha256, migrationState.ledgerSha256,
    "backup manifest was not captured against the current migration ledger");

  console.log(
    `Migration readiness verified for ${migrationId}: private recovery copy covers ` +
    `${backup.sheetCount} sheets. Run the package's read-only preflight separately; ` +
    "production writes still require separate approval.",
  );
  return true;
}

function runCli() {
  const migrationId = process.argv[2];
  const backupManifestPath = process.argv[3];
  assert.ok(migrationId && backupManifestPath && process.argv.length === 4,
    "Usage: node verify-migration-readiness.mjs <migration-id> <private-backup-manifest.json>");
  return verifyMigrationReadiness({
    migrationId,
    backupManifestPath,
    repositoryRoot: path.resolve("."),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "migration readiness failed"}\n`);
    process.exitCode = 1;
  }
}
