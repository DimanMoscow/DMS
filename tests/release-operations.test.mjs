import assert from "node:assert/strict";
import test from "node:test";

import { buildReleaseCheckpoint } from "../scripts/capture-release-checkpoint.mjs";

test("release checkpoint keeps only non-sensitive rollback metadata", () => {
  const checkpoint = buildReleaseCheckpoint({
    capturedAt: "2026-09-05T00:00:00.000Z",
    vercelDeployment: "dpl_example",
    appsScriptVersion: "v49",
    schemaVersion: "client-portal-v1",
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
      service: "dms-fitness-apps-script",
      release: "calendar-onboarding-r8-production-guards",
      routerSha256: "a".repeat(64),
      clientPortalSha256: "b".repeat(64),
      clientPortalHandlerLoaded: true,
      telegramUserId: "123456789",
    },
  });

  const serialized = JSON.stringify(checkpoint);
  assert.equal(checkpoint.miniApp.vercelDeployment, "dpl_example");
  assert.equal(checkpoint.appsScript.numberedVersion, "v49");
  assert.equal(checkpoint.sheets.productionDataIncluded, false);
  assert.doesNotMatch(serialized, /secret\.invalid|telegramUserId|123456789/);
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
