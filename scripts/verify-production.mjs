#!/usr/bin/env node

const baseUrl = process.argv[2]?.replace(/\/$/, "");
const expectedRelease = process.env.DMS_EXPECTED_RELEASE || "0.2.7";
const expectedFingerprint = process.env.DMS_EXPECTED_FINGERPRINT ||
  "miniapp-r8-apps-script-runtime-probe";
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

const [root, client, healthResponse, appsScriptRuntimeResponse] = await Promise.all([
  fetchChecked("/"),
  fetchChecked("/client"),
  fetchChecked("/api/health"),
  fetchChecked("/api/apps-script-runtime"),
]);

const apiProbe = await fetch(`${baseUrl}/api/dms`, {
  method: "POST",
  cache: "no-store",
  redirect: "error",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({}),
  signal: AbortSignal.timeout(15_000),
});
const apiProbeBody = await apiProbe.json();
if (apiProbe.status !== 400 || apiProbeBody.error !== "invalid_request") {
  throw new Error(`/api/dms fail-closed probe returned HTTP ${apiProbe.status}`);
}
if (!/no-store/i.test(apiProbe.headers.get("cache-control") || "")) {
  throw new Error("/api/dms error response is cacheable");
}

const methodProbe = await fetch(`${baseUrl}/api/dms`, {
  method: "GET",
  cache: "no-store",
  redirect: "error",
  signal: AbortSignal.timeout(15_000),
});
const methodProbeBody = await methodProbe.json();
if (methodProbe.status !== 405 || methodProbeBody.error !== "method_not_allowed") {
  throw new Error(`/api/dms method probe returned HTTP ${methodProbe.status}`);
}
if (!/no-store/i.test(methodProbe.headers.get("cache-control") || "")) {
  throw new Error("/api/dms method response is cacheable");
}

const health = await healthResponse.json();
const appsScriptRuntime = await appsScriptRuntimeResponse.json();
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
if (!/no-store/i.test(appsScriptRuntimeResponse.headers.get("cache-control") || "")) {
  throw new Error("/api/apps-script-runtime is cacheable");
}
if (appsScriptRuntime.ok !== true ||
    appsScriptRuntime.service !== "dms-fitness-apps-script" ||
    appsScriptRuntime.clientPortalHandlerLoaded !== true) {
  throw new Error("Apps Script runtime identity mismatch");
}

console.log(JSON.stringify({
  ok: true,
  routes: {
    root: root.status,
    client: client.status,
    health: healthResponse.status,
    appsScriptRuntime: appsScriptRuntimeResponse.status,
  },
  release: health.release,
  runtimeFingerprint: health.runtimeFingerprint,
  sourceRevision: health.sourceRevision,
  dataMode: health.dataMode,
  appsScriptRuntime: {
    release: appsScriptRuntime.release,
    clientPortalHandlerLoaded: appsScriptRuntime.clientPortalHandlerLoaded,
  },
  apiProbe: { status: apiProbe.status, error: apiProbeBody.error, cacheControl: "no-store" },
  methodProbe: {
    status: methodProbe.status,
    error: methodProbeBody.error,
    cacheControl: "no-store",
  },
}));
