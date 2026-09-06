import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { verifyMigrationRepository } from "../apps-script/scripts/migration-integrity.mjs";
import { verifyAppendOnlyLedger } from "../apps-script/scripts/verify-ledger-history.mjs";
import { verifyTargetDependencies } from "../scripts/verify-migration-readiness.mjs";

const repositoryRoot = path.resolve(".");
const migrationsRoot = path.join(repositoryRoot, "apps-script", "migrations");

test("production migration ledger matches every versioned migration", () => {
  const result = verifyMigrationRepository({ repositoryRoot, migrationsRoot });
  assert.deepEqual(result.applied, [
    "client-portal-v1",
    "client-portal-enrollment-v1",
    "telegram-confirmations-v1",
  ]);
  assert.match(result.ledgerSha256, /^[0-9a-f]{64}$/);
});

test("migration ledger rejects artifact drift", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dms-migration-ledger-"));
  const copiedMigrations = path.join(root, "apps-script", "migrations");
  fs.cpSync(migrationsRoot, copiedMigrations, { recursive: true });
  fs.copyFileSync(
    path.join(repositoryRoot, "apps-script", "verification.json"),
    path.join(root, "apps-script", "verification.json"),
  );
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "CLIENT_PORTAL_PILOT.md"), "evidence\n");
  fs.appendFileSync(
    path.join(copiedMigrations, "client-portal-v1", "pilot-preflight.mjs"),
    "\n// unexpected drift\n",
  );

  assert.throws(
    () => verifyMigrationRepository({ repositoryRoot: root, migrationsRoot: copiedMigrations }),
    /artifact digest differs/,
  );
});

test("applied migration ledger is append-only", () => {
  const base = JSON.parse(fs.readFileSync(path.join(migrationsRoot, "ledger.json"), "utf8"));
  const appended = structuredClone(base);
  appended.catalog.push({
    id: "future-v2",
    schemaVersion: 2,
    dependsOn: ["client-portal-enrollment-v1"],
    artifactSha256: "f".repeat(64),
  });
  assert.equal(verifyAppendOnlyLedger(base, appended), true);

  const rewritten = structuredClone(base);
  rewritten.applied[0].verifiedOn = "2026-09-05";
  assert.throws(() => verifyAppendOnlyLedger(base, rewritten), /immutable/);
});

test("migration history gate rejects a nonexistent base commit", () => {
  const result = spawnSync(process.execPath, ["apps-script/scripts/verify-ledger-history.mjs"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, DMS_LEDGER_BASE_SHA: "1".repeat(40) },
  });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /history begins/);
});

test("migration readiness requires every declared dependency to be applied", () => {
  const state = {
    applied: ["base-v1"],
    dependencies: { "future-v2": ["base-v1", "missing-v1"] },
  };
  assert.throws(
    () => verifyTargetDependencies("future-v2", state),
    /dependency missing-v1 is not applied/,
  );
});
