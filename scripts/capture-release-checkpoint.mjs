#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const VERSION_PATTERN = /^v\d+$/;

export function buildReleaseCheckpoint({
  health,
  appsScriptRuntime,
  capturedAt = new Date().toISOString(),
  vercelDeployment = "unavailable",
  appsScriptVersion = "unavailable",
  schemaVersion = "unavailable",
}) {
  if (health?.ok !== true || health.dataMode !== "connected") {
    throw new Error("MiniApp health is not connected");
  }
  if (!SHA_PATTERN.test(String(health.sourceRevision || ""))) {
    throw new Error("MiniApp source revision is unavailable");
  }
  if (appsScriptRuntime?.ok !== true ||
      appsScriptRuntime.service !== "dms-fitness-apps-script" ||
      appsScriptRuntime.clientPortalHandlerLoaded !== true) {
    throw new Error("Apps Script runtime identity is not verified");
  }
  if (appsScriptVersion !== "unavailable" && !VERSION_PATTERN.test(appsScriptVersion)) {
    throw new Error("DMS_APPS_SCRIPT_VERSION must look like v49");
  }

  return {
    formatVersion: 1,
    capturedAt,
    miniApp: {
      release: String(health.release || ""),
      runtimeFingerprint: String(health.runtimeFingerprint || ""),
      sourceRevision: health.sourceRevision.toLowerCase(),
      vercelDeployment: String(vercelDeployment || "unavailable"),
      dataMode: "connected",
    },
    appsScript: {
      numberedVersion: appsScriptVersion,
      release: String(appsScriptRuntime.release || ""),
      routerSha256: String(appsScriptRuntime.routerSha256 || ""),
      clientPortalSha256: String(appsScriptRuntime.clientPortalSha256 || ""),
      clientPortalHandlerLoaded: true,
    },
    sheets: {
      schemaVersion,
      productionDataIncluded: false,
    },
  };
}

async function fetchJson(baseUrl, route) {
  const response = await fetch(`${baseUrl}${route}`, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${route} returned HTTP ${response.status}`);
  if (!/no-store/i.test(response.headers.get("cache-control") || "")) {
    throw new Error(`${route} is cacheable`);
  }
  return response.json();
}

async function runCli() {
  const baseUrl = process.argv[2]?.replace(/\/$/, "");
  if (!baseUrl || !/^https:\/\//.test(baseUrl) || process.argv.length > 4) {
    throw new Error(
      "Usage: npm run release:checkpoint -- https://production.example [output.json]",
    );
  }
  const [health, appsScriptRuntime] = await Promise.all([
    fetchJson(baseUrl, "/api/health"),
    fetchJson(baseUrl, "/api/apps-script-runtime"),
  ]);
  const checkpoint = buildReleaseCheckpoint({
    health,
    appsScriptRuntime,
    vercelDeployment: process.env.DMS_VERCEL_DEPLOYMENT_ID || "unavailable",
    appsScriptVersion: process.env.DMS_APPS_SCRIPT_VERSION || "unavailable",
    schemaVersion: process.env.DMS_SCHEMA_VERSION || "unavailable",
  });
  const defaultName = `release-${checkpoint.capturedAt.replace(/[:.]/g, "-")}.json`;
  const outputPath = path.resolve(process.argv[3] || path.join(".local-checkpoints", defaultName));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(checkpoint, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${outputPath}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "checkpoint failed"}\n`);
    process.exitCode = 1;
  });
}
