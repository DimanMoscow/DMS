import assert from "node:assert/strict";

export const EXPECTED_RUNTIME_SERVICE = "dms-fitness-apps-script";
export const EXPECTED_RUNTIME_RELEASE = "calendar-onboarding-r8-production-guards";

export function verifyRuntimeIdentity(identity, expectedHashes, { requireOk = true } = {}) {
  const keys = [
    "clientPortalHandlerLoaded", "clientPortalSha256", "release", "routerSha256", "service",
    "telegramConfirmationsHandlerLoaded", "telegramConfirmationsSha256",
  ];
  if (requireOk) keys.push("ok");
  assert.deepEqual(Object.keys(identity).sort(), keys.sort(), "runtime identity fields differ");
  if (requireOk) assert.equal(identity.ok, true);
  assert.equal(identity.service, EXPECTED_RUNTIME_SERVICE);
  assert.equal(identity.release, EXPECTED_RUNTIME_RELEASE);
  assert.equal(identity.clientPortalHandlerLoaded, true);
  assert.equal(identity.telegramConfirmationsHandlerLoaded, true);
  assert.equal(identity.routerSha256, expectedHashes.routerSha256);
  assert.equal(identity.clientPortalSha256, expectedHashes.clientPortalSha256);
  assert.equal(identity.telegramConfirmationsSha256, expectedHashes.telegramConfirmationsSha256);
  return true;
}
