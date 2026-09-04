import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("health exposes a stable release fingerprint and optional source revision", async () => {
  const [health, identity, packageJson] = await Promise.all([
    readFile("app/api/health/route.ts", "utf8"),
    readFile("lib/release-identity.ts", "utf8"),
    readFile("package.json", "utf8").then(JSON.parse),
  ]);

  assert.match(health, /MINIAPP_RUNTIME_FINGERPRINT/);
  assert.match(health, /getMiniAppSourceRevision/);
  assert.match(identity, /miniapp-r8-apps-script-runtime-probe/);
  assert.match(identity, new RegExp(`MINIAPP_RELEASE = "${packageJson.version}"`));
  assert.match(identity, /\^\[0-9a-f\]\{40\}\$/);
  assert.doesNotMatch(identity, /DMS_APPS_SCRIPT_URL/);
});

test("request IDs are bounded to a log-safe allow-list", async () => {
  const source = await readFile("lib/request-id.ts", "utf8");
  assert.match(source, /\[A-Za-z0-9:_-\]/);
  assert.match(source, /\{1,180\}/);
  assert.match(source, /crypto\.randomUUID/);
});

test("production verifier fails closed on release, fingerprint and source mismatch", async () => {
  const source = await readFile("scripts/verify-production.mjs", "utf8");
  assert.match(source, /release mismatch/);
  assert.match(source, /runtime fingerprint mismatch/);
  assert.match(source, /source mismatch/);
  assert.match(source, /no-store/);
  assert.match(source, /dataMode !== "connected"/);
  assert.match(source, /apiProbe\.status !== 400/);
  assert.match(source, /api\/dms error response is cacheable/);
  assert.match(source, /api\/dms method response is cacheable/);
  assert.match(source, /method_not_allowed/);
  assert.match(source, /api\/apps-script-runtime/);
  assert.match(source, /Apps Script runtime identity mismatch/);
});

test("Apps Script runtime proxy is allow-listed, fail-closed and non-cacheable", async () => {
  const [route, identity] = await Promise.all([
    readFile("app/api/apps-script-runtime/route.ts", "utf8"),
    readFile("lib/apps-script-runtime-identity.ts", "utf8"),
  ]);

  assert.match(route, /Cache-Control.*no-store/);
  assert.match(route, /runtime_identity_mismatch/);
  assert.match(route, /clientPortalHandlerLoaded === true/);
  assert.doesNotMatch(route, /error\.message/);
  assert.doesNotMatch(identity, /DMS_APPS_SCRIPT_URL/);
  assert.match(identity, /calendar-onboarding-r8-production-guards/);
});
