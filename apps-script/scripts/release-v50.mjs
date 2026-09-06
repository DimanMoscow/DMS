#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { googleJson, loadAuthorizationProfile, refreshGoogleAccessToken } from "./google-auth.mjs";
import {
  materializeCandidate,
  normalizeRemoteFiles,
  verifyRemoteBaseline,
} from "./apps-script-preflight.mjs";
import { canonicalSource, sha256, sourceTreeSha256 } from "./source-integrity.mjs";
import { verifyBackupManifest } from "./verify-backup-manifest.mjs";
import { assertPrivateRegularFile, isOutsidePath } from "../../scripts/path-policy.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appsScriptRoot = path.resolve(scriptDirectory, "..");
const repositoryRoot = path.resolve(appsScriptRoot, "..");
const SCRIPT_API = "https://script.googleapis.com/v1";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const SHEETS_API = "https://sheets.googleapis.com/v4";
const BASE_VERSION = 49;
const TARGET_VERSION = 50;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    assert.ok(["--target", "--backup", "--output", "--confirm"].includes(key), `unknown argument: ${key}`);
    assert.ok(value, `${key} requires a value`);
    result[key.slice(2)] = value;
  }
  for (const name of ["target", "backup", "output", "confirm"]) {
    assert.ok(result[name], `--${name} is required`);
  }
  assert.equal(result.confirm, "v50", "--confirm must be exactly v50");
  return result;
}

function assertPrivateOutput(filePath) {
  assert.equal(path.isAbsolute(filePath), true, "rollout output path must be absolute");
  assert.ok(isOutsidePath(repositoryRoot, filePath), "rollout output must be outside the repository");
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const parent = fs.lstatSync(path.dirname(filePath));
  assert.equal(parent.isDirectory(), true, "rollout output parent must be a directory");
  assert.equal(parent.isSymbolicLink(), false, "rollout output parent cannot be a symlink");
}

function loadTarget(targetPath) {
  assertPrivateRegularFile(targetPath, repositoryRoot, "Apps Script target");
  const target = readJson(targetPath);
  assert.deepEqual(Object.keys(target).sort(), ["script_id"]);
  assert.match(String(target.script_id || ""), /^[A-Za-z0-9_-]{20,}$/);
  return target;
}

function localSources(root) {
  const result = new Map();
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    assert.equal(entry.isFile(), true, `${entry.name}: only files are allowed`);
    result.set(entry.name, canonicalSource(fs.readFileSync(path.join(root, entry.name)), entry.name));
  }
  return result;
}

function apiFiles(files) {
  return [...files].sort(([left], [right]) => left.localeCompare(right)).map(([fileName, source]) => {
    if (fileName === "appsscript.json") return { name: "appsscript", type: "JSON", source };
    assert.ok(fileName.endsWith(".gs"), `${fileName}: unsupported candidate file type`);
    return { name: fileName.slice(0, -3), type: "SERVER_JS", source };
  });
}

async function listDriveSpreadsheets(accessToken, fetchImpl) {
  const files = [];
  let pageToken = "";
  do {
    const url = new URL(`${DRIVE_API}/files`);
    url.searchParams.set("q", "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
    url.searchParams.set("fields", "nextPageToken,files(id)");
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await googleJson(accessToken, url, {}, fetchImpl);
    files.push(...(page.files || []));
    pageToken = page.nextPageToken || "";
  } while (pageToken);
  return files;
}

async function spreadsheetMetadata(accessToken, spreadsheetId, fetchImpl) {
  const fields = "properties(title),sheets.properties(title,sheetId,gridProperties(rowCount,columnCount,frozenRowCount))";
  return googleJson(
    accessToken,
    `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}?includeGridData=false&fields=${encodeURIComponent(fields)}`,
    {},
    fetchImpl,
  );
}

async function ledgerValues(accessToken, spreadsheetId, sheetName, fetchImpl) {
  const range = `'${sheetName.replaceAll("'", "''")}'!1:2`;
  return googleJson(
    accessToken,
    `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
    {},
    fetchImpl,
  );
}

export async function ensureEmptyLedger({ accessToken, spreadsheetId, schema, fetchImpl = fetch }) {
  let metadata = await spreadsheetMetadata(accessToken, spreadsheetId, fetchImpl);
  let ledger = (metadata.sheets || []).filter((sheet) => sheet.properties?.title === schema.sheet.name);
  assert.ok(ledger.length <= 1, "Telegram operation ledger is duplicated");
  let created = false;
  if (ledger.length === 0) {
    const usedIds = new Set((metadata.sheets || []).map((sheet) => Number(sheet.properties?.sheetId)));
    let sheetId = 1_700_000_000;
    while (usedIds.has(sheetId)) sheetId += 1;
    const requests = [
      {
        addSheet: {
          properties: {
            sheetId,
            title: schema.sheet.name,
            gridProperties: {
              rowCount: 1000,
              columnCount: schema.sheet.columns.length,
              frozenRowCount: schema.sheet.frozenRows,
            },
          },
        },
      },
      {
        updateCells: {
          start: { sheetId, rowIndex: 0, columnIndex: 0 },
          rows: [{
            values: schema.sheet.columns.map((column) => ({
              userEnteredValue: { stringValue: column.name },
              userEnteredFormat: { textFormat: { bold: true } },
            })),
          }],
          fields: "userEnteredValue,userEnteredFormat.textFormat.bold",
        },
      },
    ];
    await googleJson(
      accessToken,
      `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      { method: "POST", body: JSON.stringify({ requests }) },
      fetchImpl,
    );
    created = true;
    metadata = await spreadsheetMetadata(accessToken, spreadsheetId, fetchImpl);
    ledger = (metadata.sheets || []).filter((sheet) => sheet.properties?.title === schema.sheet.name);
  }
  assert.equal(ledger.length, 1, "Telegram operation ledger was not created exactly once");
  const properties = ledger[0].properties;
  assert.equal(properties.gridProperties?.columnCount, schema.sheet.columns.length);
  assert.equal(properties.gridProperties?.frozenRowCount, schema.sheet.frozenRows);
  const values = await ledgerValues(accessToken, spreadsheetId, schema.sheet.name, fetchImpl);
  assert.deepEqual(values.values?.[0] || [], schema.sheet.columns.map((column) => column.name));
  assert.equal((values.values || []).slice(1).flat().some((value) => String(value).trim()), false,
    "Telegram operation ledger contains data before rollout");
  return { created, sheetCount: metadata.sheets.length, ledgerRows: 0 };
}

async function createPostMigrationBackup({ accessToken, sourceSpreadsheetId, expectedSheetCount, fetchImpl }) {
  const createdAt = new Date();
  const name = `DMS Fitness v50 pre-deploy ${createdAt.toISOString().slice(0, 16).replace(/[T:]/g, "-")}`;
  const copy = await googleJson(
    accessToken,
    `${DRIVE_API}/files/${encodeURIComponent(sourceSpreadsheetId)}/copy?supportsAllDrives=true&fields=id`,
    { method: "POST", body: JSON.stringify({ name }) },
    fetchImpl,
  );
  assert.match(String(copy.id || ""), /^[A-Za-z0-9_-]{20,}$/);
  const metadata = await spreadsheetMetadata(accessToken, copy.id, fetchImpl);
  assert.equal(metadata.sheets?.length, expectedSheetCount, "post-migration backup sheet count differs");
  return { createdAt: createdAt.toISOString(), backupRefSha256: sha256(copy.id) };
}

async function listVersions(accessToken, scriptId, fetchImpl) {
  const versions = [];
  let pageToken = "";
  do {
    const url = new URL(`${SCRIPT_API}/projects/${encodeURIComponent(scriptId)}/versions`);
    url.searchParams.set("pageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await googleJson(accessToken, url, {}, fetchImpl);
    versions.push(...(page.versions || []));
    pageToken = page.nextPageToken || "";
  } while (pageToken);
  return versions;
}

async function waitForRuntimeIdentity(runtimeUrl, expected, fetchImpl) {
  const url = new URL(runtimeUrl);
  url.searchParams.set("dms_runtime_identity", "1");
  let lastReason = "runtime identity unavailable";
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      url.searchParams.set("probe", `${Date.now()}-${attempt}`);
      const response = await fetchImpl(url, {
        method: "GET",
        redirect: "follow",
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      const identity = await response.json();
      assert.equal(response.ok, true, `runtime identity HTTP ${response.status}`);
      assert.deepEqual(Object.keys(identity).sort(), Object.keys(expected).sort());
      assert.deepEqual(identity, expected);
      return true;
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error);
      if (attempt < 11) await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
  throw new Error(`v50 runtime identity did not propagate: ${lastReason}`);
}

export async function runV50Rollout({ profile, target, backupManifest, fetchImpl = fetch }) {
  const production = readJson(path.join(appsScriptRoot, "production.json"));
  assert.equal(production.numberedVersion, BASE_VERSION, "production pointer must still be v49");
  verifyBackupManifest(backupManifest);
  const verification = readJson(path.join(appsScriptRoot, "verification.json"));
  const candidateRoot = path.join(appsScriptRoot, "candidates", "v50");
  const candidateFiles = localSources(candidateRoot);
  assert.equal(sourceTreeSha256(candidateRoot, [...candidateFiles.keys()]),
    verification.candidates.v50.sourceTreeSha256, "candidate v50 source tree differs");
  const accessToken = await refreshGoogleAccessToken(profile, fetchImpl);
  const projectBase = `${SCRIPT_API}/projects/${encodeURIComponent(target.script_id)}`;

  const [headBefore, versionBefore, deploymentsBefore, versionsBefore, driveFiles] = await Promise.all([
    googleJson(accessToken, `${projectBase}/content`, {}, fetchImpl),
    googleJson(accessToken, `${projectBase}/content?versionNumber=${BASE_VERSION}`, {}, fetchImpl),
    googleJson(accessToken, `${projectBase}/deployments`, {}, fetchImpl),
    listVersions(accessToken, target.script_id, fetchImpl),
    listDriveSpreadsheets(accessToken, fetchImpl),
  ]);
  const baselineFiles = localSources(path.join(appsScriptRoot, "versions", "v49"));
  const numberedBefore = normalizeRemoteFiles(versionBefore.files);
  const substitutions = verifyRemoteBaseline({
    remoteFiles: numberedBefore,
    baselineFiles,
    sanitizations: verification.repositorySanitizations,
  });
  assert.deepEqual(normalizeRemoteFiles(headBefore.files), numberedBefore,
    "Apps Script HEAD changed after preflight");
  assert.equal(Math.max(...versionsBefore.map((version) => Number(version.versionNumber))), BASE_VERSION,
    "numbered version 50 or later already exists");
  const productionDeployments = (deploymentsBefore.deployments || []).filter((deployment) =>
    Number(deployment?.deploymentConfig?.versionNumber) === BASE_VERSION &&
    (deployment.entryPoints || []).some((entry) => entry.entryPointType === "WEB_APP"));
  assert.equal(productionDeployments.length, 1, "expected exactly one v49 production web deployment");
  const deployment = productionDeployments[0];
  assert.match(String(deployment.deploymentId || ""), /^[A-Za-z0-9_-]{20,}$/);

  const sourceMatches = driveFiles.filter((file) => sha256(file.id) === backupManifest.sourceSpreadsheetRefSha256);
  assert.equal(sourceMatches.length, 1, "production spreadsheet reference was not found exactly once");
  const sourceSpreadsheetId = sourceMatches[0].id;
  const schema = readJson(path.join(appsScriptRoot, "migrations", "telegram-confirmations-v1", "schema.json"));
  const ledger = await ensureEmptyLedger({ accessToken, spreadsheetId: sourceSpreadsheetId, schema, fetchImpl });
  assert.equal(ledger.sheetCount, backupManifest.sheets.length + 1,
    "migration must add exactly one production sheet");
  const postMigrationBackup = await createPostMigrationBackup({
    accessToken,
    sourceSpreadsheetId,
    expectedSheetCount: ledger.sheetCount,
    fetchImpl,
  });

  const materialized = materializeCandidate(candidateFiles, verification.repositorySanitizations, substitutions);
  const updateResponse = await googleJson(
    accessToken,
    `${projectBase}/content`,
    { method: "PUT", body: JSON.stringify({ files: apiFiles(materialized) }) },
    fetchImpl,
  );
  assert.equal(String(updateResponse.scriptId || ""), target.script_id, "updateContent returned another script");
  const headAfter = await googleJson(accessToken, `${projectBase}/content`, {}, fetchImpl);
  assert.deepEqual(normalizeRemoteFiles(headAfter.files), materialized, "Apps Script HEAD read-back differs from v50");

  const createdVersion = await googleJson(
    accessToken,
    `${projectBase}/versions`,
    { method: "POST", body: JSON.stringify({ description: "DMS Fitness v50 Telegram confirmation hardening" }) },
    fetchImpl,
  );
  assert.equal(Number(createdVersion.versionNumber), TARGET_VERSION,
    "Google did not create numbered version 50");
  const numberedAfter = await googleJson(
    accessToken,
    `${projectBase}/content?versionNumber=${TARGET_VERSION}`,
    {},
    fetchImpl,
  );
  assert.deepEqual(normalizeRemoteFiles(numberedAfter.files), materialized,
    "numbered v50 read-back differs from candidate");

  let deploymentUpdated = false;
  try {
    const deploymentConfig = {
      versionNumber: TARGET_VERSION,
      manifestFileName: deployment.deploymentConfig?.manifestFileName || "appsscript",
      description: deployment.deploymentConfig?.description || "DMS Fitness production",
    };
    await googleJson(
      accessToken,
      `${projectBase}/deployments/${encodeURIComponent(deployment.deploymentId)}`,
      { method: "PUT", body: JSON.stringify({ deploymentConfig }) },
      fetchImpl,
    );
    deploymentUpdated = true;
    const deploymentAfter = await googleJson(
      accessToken,
      `${projectBase}/deployments/${encodeURIComponent(deployment.deploymentId)}`,
      {},
      fetchImpl,
    );
    assert.equal(Number(deploymentAfter.deploymentConfig?.versionNumber), TARGET_VERSION,
      "production deployment read-back is not v50");
    const moduleName = "ZZZZZZZZZZZZTelegramConfirmations.gs";
    await waitForRuntimeIdentity(substitutions.appsScriptProductionUrl, {
      ok: true,
      service: "dms-fitness-apps-script",
      release: "calendar-onboarding-r8-production-guards",
      routerSha256: sha256(candidateFiles.get("ZZZZZZZZMiniAppApi.gs")),
      clientPortalSha256: sha256(candidateFiles.get("ZZZZZZZZZZZClientPortal.gs")),
      clientPortalHandlerLoaded: true,
      telegramConfirmationsSha256: sha256(candidateFiles.get(moduleName)),
      telegramConfirmationsHandlerLoaded: true,
    }, fetchImpl);
  } catch (error) {
    if (deploymentUpdated) {
      const rollbackConfig = {
        versionNumber: BASE_VERSION,
        manifestFileName: deployment.deploymentConfig?.manifestFileName || "appsscript",
        description: deployment.deploymentConfig?.description || "DMS Fitness production",
      };
      await googleJson(
        accessToken,
        `${projectBase}/deployments/${encodeURIComponent(deployment.deploymentId)}`,
        { method: "PUT", body: JSON.stringify({ deploymentConfig: rollbackConfig }) },
        fetchImpl,
      );
    }
    throw error;
  }

  return {
    formatVersion: 1,
    releasedAt: new Date().toISOString(),
    authenticatedWriter: true,
    previousVersion: `v${BASE_VERSION}`,
    numberedVersion: `v${TARGET_VERSION}`,
    headReadBackVerified: true,
    numberedSnapshotVerified: true,
    deploymentReadBackVerified: true,
    deploymentRefSha256: sha256(deployment.deploymentId),
    runtimeIdentityVerified: true,
    ledgerCreated: ledger.created,
    ledgerRows: ledger.ledgerRows,
    productionSheetCount: ledger.sheetCount,
    postMigrationBackup,
    paymentMutations: 0,
    calendarMutations: 0,
  };
}

async function runCli() {
  const args = parseArguments(process.argv.slice(2));
  const profilePath = path.resolve(String(process.env.DMS_APPS_SCRIPT_AUTH_FILE || ""));
  assert.ok(process.env.DMS_APPS_SCRIPT_AUTH_FILE, "DMS_APPS_SCRIPT_AUTH_FILE is required");
  assertPrivateRegularFile(profilePath, repositoryRoot, "authorization profile");
  const targetPath = path.resolve(args.target);
  const backupPath = path.resolve(args.backup);
  assertPrivateRegularFile(backupPath, repositoryRoot, "private backup manifest");
  const outputPath = path.resolve(args.output);
  assertPrivateOutput(outputPath);
  assert.equal(fs.existsSync(outputPath), false, "rollout output already exists");
  const result = await runV50Rollout({
    profile: loadAuthorizationProfile(profilePath, "writer"),
    target: loadTarget(targetPath),
    backupManifest: readJson(backupPath),
  });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  process.stdout.write("Apps Script v50 rollout completed; runtime identity verified.\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Apps Script v50 rollout failed"}\n`);
    process.exitCode = 1;
  });
}
