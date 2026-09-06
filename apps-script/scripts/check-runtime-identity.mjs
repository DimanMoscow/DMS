import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readCanonicalSource, sha256 } from "./source-integrity.mjs";
import { verifyRuntimeIdentity } from "./runtime-identity.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const candidateDirectory = path.resolve(scriptDirectory, "..", "candidates", "v50");
const runtimeUrl = String(process.env.DMS_APPS_SCRIPT_URL || "").trim();

assert.ok(runtimeUrl, "DMS_APPS_SCRIPT_URL is required");

function sourceSha256(fileName) {
  return sha256(readCanonicalSource(path.join(candidateDirectory, fileName)));
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
verifyRuntimeIdentity(identity, {
  routerSha256: sourceSha256("ZZZZZZZZMiniAppApi.gs"),
  clientPortalSha256: sourceSha256("ZZZZZZZZZZZClientPortal.gs"),
  telegramConfirmationsSha256: sourceSha256("ZZZZZZZZZZZZTelegramConfirmations.gs"),
});

console.log("Apps Script runtime identity verified: v50 Telegram confirmation hardening");
