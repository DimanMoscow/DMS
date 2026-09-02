#!/usr/bin/env node

const baseUrl = process.argv[2]?.replace(/\/$/, "");
const expectedRelease = process.env.DMS_EXPECTED_RELEASE || "0.2.2";
const expectedFingerprint = process.env.DMS_EXPECTED_FINGERPRINT ||
  "miniapp-r3-start-param-measurement-guard";
const expectedSource = process.env.DMS_EXPECTED_SOURCE?.toLowerCase() || "";

if (!baseUrl || !/^https:\/\//.test(baseUrl)) {
  throw new Error("Usage: npm run smoke:miniapp-production -- https://production.example");
}

async function fetchChecked(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== 200) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  return response;
}

const [root, client, healthResponse] = await Promise.all([
  fetchChecked("/"),
  fetchChecked("/client"),
  fetchChecked("/api/health"),
]);

const health = await healthResponse.json();
const cacheControl = healthResponse.headers.get("cache-control") || "";
if (!/no-store/i.test(cacheControl)) throw new Error("/api/health is cacheable");
if (health.ok !== true) throw new Error("health.ok is not true");
if (health.dataMode !== "connected") throw new Error("backend is not connected");
if (health.release !== expectedRelease) {
  throw new Error(`release mismatch: expected ${expectedRelease}, got ${health.release}`);
}
if (health.runtimeFingerprint !== expectedFingerprint) {
  throw new Error("runtime fingerprint mismatch");
}
if (expectedSource && health.sourceRevision !== expectedSource) {
  throw new Error(`source mismatch: expected ${expectedSource}, got ${health.sourceRevision}`);
}

console.log(JSON.stringify({
  ok: true,
  routes: { root: root.status, client: client.status, health: healthResponse.status },
  release: health.release,
  runtimeFingerprint: health.runtimeFingerprint,
  sourceRevision: health.sourceRevision,
  dataMode: health.dataMode,
}));
