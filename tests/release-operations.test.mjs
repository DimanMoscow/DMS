import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

import { buildReleaseCheckpoint } from "../scripts/capture-release-checkpoint.mjs";

const production = JSON.parse(fs.readFileSync("apps-script/production.json", "utf8"));

test("release checkpoint keeps only non-sensitive rollback metadata", () => {
  const checkpoint = buildReleaseCheckpoint({
    capturedAt: "2026-09-05T00:00:00.000Z",
    vercelDeployment: "dpl_example",
    appsScriptVersion: "v49",
    appsScriptDeployment: "deployment-reference-example",
    schemaVersion: "client-portal-v1",
    migrationLedgerSha256: "c".repeat(64),
    health: {
      ok: true,
      release: "0.2.7",
      runtimeFingerprint: "miniapp-r8-apps-script-runtime-probe",
      sourceRevision: "2c04fc55e32d45650b441efdab8096c33749e7b7",
      dataMode: "connected",
      backendUrl: "https://secret.invalid",
    },
    appsScriptRuntime: {
      ok: true,
      ...production.runtimeIdentity,
    },
  });

  const serialized = JSON.stringify(checkpoint);
  assert.equal(checkpoint.miniApp.vercelDeployment, "dpl_example");
  assert.equal(checkpoint.appsScript.numberedVersion, "v49");
  assert.equal(checkpoint.appsScript.deploymentReference, "deployment-reference-example");
  assert.equal(checkpoint.sheets.productionDataIncluded, false);
  assert.equal(checkpoint.sheets.migrationLedgerSha256, "c".repeat(64));
  assert.equal(checkpoint.rollbackReferencesRecorded, true);
  assert.equal(checkpoint.remoteStateVerified, false);
  assert.equal(checkpoint.rollbackReady, false);
  assert.doesNotMatch(serialized, /secret\.invalid/);
});

test("release checkpoint fails closed without rollback references", () => {
  const input = {
    health: {
      ok: true,
      release: "0.2.7",
      runtimeFingerprint: "fingerprint",
      sourceRevision: "2c04fc55e32d45650b441efdab8096c33749e7b7",
      dataMode: "connected",
    },
    appsScriptRuntime: {
      ok: true,
      ...production.runtimeIdentity,
    },
  };
  assert.throws(() => buildReleaseCheckpoint(input), /VERCEL_DEPLOYMENT_ID/);
  assert.throws(
    () => buildReleaseCheckpoint({
      ...input,
      vercelDeployment: "dpl_example",
      appsScriptVersion: "v49",
      appsScriptDeployment: "deployment-reference-example",
      schemaVersion: "client-portal-v1",
    }),
    /ledger SHA-256/,
  );
});

test("release checkpoint fails closed without exact runtime identity", () => {
  assert.throws(() => buildReleaseCheckpoint({
    health: {
      ok: true,
      release: "0.2.7",
      runtimeFingerprint: "fingerprint",
      sourceRevision: "2c04fc55e32d45650b441efdab8096c33749e7b7",
      dataMode: "connected",
    },
    appsScriptRuntime: { ok: false },
  }), /runtime identity/);
});

test("release checkpoint rejects runtime hash and numbered-version drift", () => {
  const input = {
    health: {
      ok: true,
      release: "0.2.7",
      runtimeFingerprint: "miniapp-r8-apps-script-runtime-probe",
      sourceRevision: "2c04fc55e32d45650b441efdab8096c33749e7b7",
      dataMode: "connected",
    },
    appsScriptRuntime: { ok: true, ...production.runtimeIdentity },
    vercelDeployment: "dpl_example",
    appsScriptVersion: "v49",
    appsScriptDeployment: "deployment-reference-example",
    schemaVersion: "client-portal-v1",
    migrationLedgerSha256: "c".repeat(64),
  };
  assert.throws(() => buildReleaseCheckpoint({
    ...input,
    appsScriptRuntime: { ...input.appsScriptRuntime, routerSha256: "a".repeat(64) },
  }), /runtime identity/);
  assert.throws(() => buildReleaseCheckpoint({ ...input, appsScriptVersion: "v48" }),
    /production pointer/);
});
