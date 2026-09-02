import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const candidateDirectory = path.resolve(scriptDirectory, "..", "candidates", "v44");
const runtimeUrl = String(process.env.DMS_APPS_SCRIPT_URL || "").trim();

assert.ok(runtimeUrl, "DMS_APPS_SCRIPT_URL is required");

function sha256(fileName) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(candidateDirectory, fileName)))
    .digest("hex");
}

const url = new URL(runtimeUrl);
url.searchParams.set("dms_runtime_identity", "1");
url.searchParams.set("probe", `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`);

const response = await fetch(url, {
  method: "GET",
  redirect: "follow",
  cache: "no-store",
  signal: AbortSignal.timeout(20_000),
});
assert.equal(response.ok, true, `runtime identity returned HTTP ${response.status}`);

const identity = await response.json();
assert.deepEqual(Object.keys(identity).sort(), [
  "clientPortalHandlerLoaded",
  "clientPortalSha256",
  "ok",
  "release",
  "routerSha256",
  "service",
]);
assert.equal(identity.ok, true);
assert.equal(identity.service, "dms-fitness-apps-script");
assert.equal(identity.release, "client-portal-enrollment-measurements-r3");
assert.equal(identity.routerSha256, sha256("ZZZZZZZZMiniAppApi.gs"));
assert.equal(
  identity.clientPortalSha256,
  sha256("ZZZZZZZZZZZClientPortal.gs"),
);
assert.equal(identity.clientPortalHandlerLoaded, true);

console.log("Apps Script runtime identity verified: client-portal-enrollment-measurements-r3");
