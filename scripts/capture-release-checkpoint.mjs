#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { verifyMigrationRepository } from "../apps-script/scripts/migration-integrity.mjs";
import { verifyRuntimeIdentity } from "../apps-script/scripts/runtime-identity.mjs";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const VERSION_PATTERN = /^v\d+$/;
const VERCEL_DEPLOYMENT_PATTERN = /^dpl_[A-Za-z0-9]+$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productionPointer = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, "apps-script", "production.json"), "utf8"),
);

export function buildReleaseCheckpoint({
  health,
  appsScriptRuntime,
  capturedAt = new Date().toISOString(),
  vercelDeployment,
  appsScriptVersion,
  appsScriptDeployment,
  schemaVersion,
  migrationLedgerSha256,
  expectedProduction = productionPointer,
}) {
  if (health?.ok !== true || health.dataMode !== "connected") {
    throw new Error("MiniApp health is not connected");
  }
  if (!SHA_PATTERN.test(String(health.sourceRevision || ""))) {
    throw new Error("MiniApp source revision is unavailable");
  }
  try {
    verifyRuntimeIdentity(appsScriptRuntime, expectedProduction.runtimeIdentity);
  } catch {
    throw new Error("Apps Script runtime identity is not verified");
  }
  if (!VERCEL_DEPLOYMENT_PATTERN.test(String(vercelDeployment || ""))) {
    throw new Error("DMS_VERCEL_DEPLOYMENT_ID is required for a rollback checkpoint");
  }
  if (!VERSION_PATTERN.test(String(appsScriptVersion || ""))) {
    throw new Error("DMS_APPS_SCRIPT_VERSION must look like v49");
  }
  if (appsScriptVersion !== `v${expectedProduction.numberedVersion}`) {
    throw new Error("Apps Script version differs from the verified production pointer");
  }
  if (!/^[A-Za-z0-9_-]{20,}$/.test(String(appsScriptDeployment || ""))) {
    throw new Error("DMS_APPS_SCRIPT_DEPLOYMENT_ID is required for a rollback checkpoint");
  }
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(String(schemaVersion || ""))) {
    throw new Error("DMS_SCHEMA_VERSION is required for a rollback checkpoint");
  }
  if (!DIGEST_PATTERN.test(String(migrationLedgerSha256 || ""))) {
    throw new Error("migration ledger SHA-256 is required for a rollback checkpoint");
  }

  return {
    formatVersion: 1,
    capturedAt,
    miniApp: {
      release: String(health.release || ""),
      runtimeFingerprint: String(health.runtimeFingerprint || ""),
      sourceRevision: health.sourceRevision.toLowerCase(),
      vercelDeployment: String(vercelDeployment),
      dataMode: "connected",
    },
    appsScript: {
      numberedVersion: appsScriptVersion,
      deploymentReference: appsScriptDeployment,
      release: String(appsScriptRuntime.release || ""),
      routerSha256: String(appsScriptRuntime.routerSha256 || ""),
      clientPortalSha256: String(appsScriptRuntime.clientPortalSha256 || ""),
      clientPortalHandlerLoaded: true,
      telegramConfirmationsSha256: String(appsScriptRuntime.telegramConfirmationsSha256 || ""),
      telegramConfirmationsHandlerLoaded: true,
    },
    sheets: {
      schemaVersion,
      migrationLedgerSha256,
      productionDataIncluded: false,
    },
    rollbackReferencesRecorded: true,
    remoteStateVerified: false,
    rollbackReady: false,
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
  const migrationState = verifyMigrationRepository({
    repositoryRoot,
    migrationsRoot: path.join(repositoryRoot, "apps-script", "migrations"),
  });
  const checkpoint = buildReleaseCheckpoint({
    health,
    appsScriptRuntime,
    vercelDeployment: process.env.DMS_VERCEL_DEPLOYMENT_ID,
    appsScriptVersion: process.env.DMS_APPS_SCRIPT_VERSION,
    appsScriptDeployment: process.env.DMS_APPS_SCRIPT_DEPLOYMENT_ID,
    schemaVersion: process.env.DMS_SCHEMA_VERSION,
    migrationLedgerSha256: migrationState.ledgerSha256,
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
