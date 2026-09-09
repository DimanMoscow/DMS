#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

import {googleJson, loadAuthorizationProfile, refreshGoogleAccessToken} from './google-auth.mjs';
import {normalizeRemoteFiles, verifyRemoteBaseline, materializeCandidate}
  from './apps-script-preflight.mjs';
import {readCanonicalSource, sha256, sourceTreeSha256} from './source-integrity.mjs';
import {verifyOfflineReleasePlan} from './release-plan.mjs';
import {verifyBackupManifest} from './verify-backup-manifest.mjs';
import {createP1PrivateRecovery} from './p1-private-backup.mjs';
import {assertPrivateRegularFile} from '../../scripts/path-policy.mjs';

const SCRIPT_API = 'https://script.googleapis.com/v1';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sourceMap = directory => new Map(fs.readdirSync(directory).sort().map(name =>
  [name, readCanonicalSource(path.join(directory, name))]));

export function verifyScheduledReleaseInventory(inventory, {now = Date.now()} = {}) {
  assert.equal(inventory.originalDocumentContext, true);
  assert.equal(inventory.mutationReady, false, 'v53 must remain paused before activation');
  assert.equal(inventory.scriptLockAvailable, true);
  assert.equal(inventory.documentLockAvailable, true);
  assert.equal(inventory.scheduledAutomation?.configOk, true,
    'scheduled trigger configuration is not verified');
  assert.equal(inventory.scheduledAutomation?.settingsOk, true,
    'morning/evening settings are not enabled');
  assert.equal(inventory.scheduledAutomation?.ownerVerified, true,
    'scheduled trigger owner is not verified');
  assert.equal(inventory.scheduledAutomation?.handlers?.length, 5,
    'scheduled trigger inventory must contain five handlers');
  assert.equal(inventory.scheduledAutomation.handlers.every(item =>
    item.configOk === true &&
    item.state !== 'trigger_missing' &&
    item.state !== 'trigger_misconfigured'), true,
  'scheduled trigger inventory contains a missing or misconfigured handler');
  assert.equal(inventory.legacyStates?.malformed, 0,
    'malformed legacy evidence requires private recovery');
  assert.ok(now - Date.parse(inventory.checkedAt) >= 0 &&
    now - Date.parse(inventory.checkedAt) < 600000,
  'original-context inventory must be fresh');
  assert.ok(Number.isFinite(Date.parse(inventory.drainStartedAt)) &&
    now - Date.parse(inventory.drainStartedAt) >= 420000,
  'old execution drain is incomplete');
  return true;
}

export async function runScheduledReleasePhase({
  phase,
  privateRoot,
  planPath,
  backupPath,
  inventoryPath,
  fetchImpl = fetch,
}) {
  assert.ok(['backup', 'refresh-backup', 'stage', 'publish'].includes(phase),
    'unknown v53 release phase');
  assertPrivateRegularFile(path.join(privateRoot, 'target.json'), process.cwd(), 'private target');
  const sourceRevision = execFileSync('git', [
    '-c', 'safe.directory=' + process.cwd().replaceAll('\\', '/'), 'rev-parse', 'HEAD',
  ], {encoding: 'utf8'}).trim();
  const plan = read(planPath);
  verifyOfflineReleasePlan(plan, {sourceRevision});
  assert.equal(plan.candidate, 'v53');
  assert.equal(plan.baseline, 'v52');

  loadAuthorizationProfile(path.join(privateRoot, 'reader-profile.json'), 'reader');
  const profile = loadAuthorizationProfile(path.join(privateRoot, 'writer-profile.json'), 'writer');
  const token = await refreshGoogleAccessToken(profile, fetchImpl);
  const target = read(path.join(privateRoot, 'target.json'));
  const spreadsheet = read(path.join(privateRoot, 'p1-isolated-target.json')).sourceSpreadsheetId;
  const verification = read('apps-script/verification.json');
  const candidateDirectory = 'apps-script/candidates/v53';
  const candidateFiles = sourceMap(candidateDirectory);
  const candidateTree = sourceTreeSha256(candidateDirectory, [...candidateFiles.keys()]);
  assert.equal(candidateTree, verification.candidates.v53.sourceTreeSha256);
  const base = SCRIPT_API + '/projects/' + encodeURIComponent(target.script_id);
  const [numbered, head, deployments] = await Promise.all([
    googleJson(token, base + '/content?versionNumber=52', {}, fetchImpl),
    googleJson(token, base + '/content', {}, fetchImpl),
    googleJson(token, base + '/deployments', {}, fetchImpl),
  ]);
  const substitutions = verifyRemoteBaseline({
    remoteFiles: normalizeRemoteFiles(numbered.files),
    baselineFiles: sourceMap('apps-script/versions/v52'),
    sanitizations: verification.repositorySanitizations,
  });
  const materialized = materializeCandidate(
    candidateFiles,
    verification.repositorySanitizations,
    substitutions,
  );
  const runtimeUrl = substitutions.appsScriptProductionUrl;
  const matching = (deployments.deployments || []).filter(deployment =>
    (deployment.entryPoints || []).some(entry => entry.webApp?.url === runtimeUrl));
  assert.equal(matching.length, 1, 'production web-app URL must resolve exactly once');
  const deployment = matching[0];
  const deployedVersion = Number(deployment.deploymentConfig.versionNumber);
  assert.ok(deployedVersion === 52 || deployedVersion === 53,
    'production deployment is not on v52/v53');
  const headFiles = normalizeRemoteFiles(head.files);
  const save = (name, result) => {
    const report = {
      phase,
      checkedAt: new Date().toISOString(),
      sourceRevision,
      candidateTreeSha256: candidateTree,
      ...result,
    };
    fs.writeFileSync(path.join(privateRoot, name), JSON.stringify(report, null, 2), {mode: 0o600});
    return report;
  };

  if (phase === 'backup' || phase === 'refresh-backup') {
    assert.equal(deployedVersion, 52, 'pre-v53 recovery requires production v52');
    if (phase === 'backup') {
      assert.deepEqual(headFiles, normalizeRemoteFiles(numbered.files),
        'Apps Script HEAD changed since numbered v52');
    } else {
      assert.deepEqual(headFiles, materialized,
        'staged Apps Script HEAD must equal candidate v53');
      assertPrivateRegularFile(inventoryPath, process.cwd(), 'v53 original-context inventory');
      verifyScheduledReleaseInventory(read(inventoryPath));
    }
    const recovery = await createP1PrivateRecovery({
      accessToken: token,
      sourceSpreadsheetId: spreadsheet,
      privateRoot,
      label: 'pre-v53-scheduled-health',
      appsScriptVersion: 'v52',
      fetchImpl,
    });
    return save('v53-current-recovery.json', recovery);
  }

  assertPrivateRegularFile(backupPath, process.cwd(), 'fresh recovery manifest');
  const backup = read(backupPath);
  verifyBackupManifest(backup);
  assert.equal(sha256(spreadsheet), backup.sourceSpreadsheetRefSha256);
  assert.ok(Date.now() - Date.parse(backup.copyVerifiedAt) < 3600000,
    'v53 release requires a verified backup less than one hour old');
  if (phase === 'stage') {
    assert.equal(deployedVersion, 52, 'v53 is already deployed');
    assert.deepEqual(headFiles, normalizeRemoteFiles(numbered.files),
      'Apps Script HEAD changed since numbered v52');
    const files = [...materialized].map(([name, source]) => name === 'appsscript.json'
      ? {name: 'appsscript', type: 'JSON', source}
      : {name: name.slice(0, -3), type: 'SERVER_JS', source});
    await googleJson(token, base + '/content', {
      method: 'PUT',
      body: JSON.stringify({files}),
    }, fetchImpl);
    assert.deepEqual(
      normalizeRemoteFiles((await googleJson(token, base + '/content', {}, fetchImpl)).files),
      materialized,
      'v53 HEAD read-back differs',
    );
    return save('v53-staged-paused.json', {
      headVerified: true,
      productionVersion: 52,
      mutationsEnabled: false,
    });
  }

  assert.deepEqual(headFiles, materialized, 'Apps Script HEAD must equal candidate v53');
  assertPrivateRegularFile(inventoryPath, process.cwd(), 'v53 original-context inventory');
  const inventory = read(inventoryPath);
  verifyScheduledReleaseInventory(inventory);
  const staged = read(path.join(privateRoot, 'v53-staged-paused.json'));
  assert.equal(staged.candidateTreeSha256, candidateTree);
  assert.ok(Date.parse(inventory.drainStartedAt) >= Date.parse(staged.checkedAt),
    'drain must start after v53 HEAD staging');

  const versions = await googleJson(token, base + '/versions?pageSize=200', {}, fetchImpl);
  const maximum = Math.max(...versions.versions.map(version => Number(version.versionNumber)));
  assert.ok(maximum === 52 || maximum === 53, 'unexpected latest Apps Script version');
  if (maximum === 52) {
    const created = await googleJson(token, base + '/versions', {
      method: 'POST',
      body: JSON.stringify({description: 'DMS v53 scheduled automation stabilization'}),
    }, fetchImpl);
    assert.equal(Number(created.versionNumber), 53);
  }
  assert.deepEqual(
    normalizeRemoteFiles((await googleJson(
      token,
      base + '/content?versionNumber=53',
      {},
      fetchImpl,
    )).files),
    materialized,
    'numbered v53 read-back differs',
  );
  if (deployedVersion === 52) {
    await googleJson(token, base + '/deployments/' + encodeURIComponent(deployment.deploymentId), {
      method: 'PUT',
      body: JSON.stringify({deploymentConfig: {
        versionNumber: 53,
        manifestFileName: deployment.deploymentConfig.manifestFileName,
        description: deployment.deploymentConfig.description,
      }}),
    }, fetchImpl);
  }
  const deployed = await googleJson(
    token,
    base + '/deployments/' + encodeURIComponent(deployment.deploymentId),
    {},
    fetchImpl,
  );
  assert.equal(Number(deployed.deploymentConfig.versionNumber), 53);
  return save('v53-published-paused.json', {
    numberedSnapshotVerified: true,
    deploymentVerified: true,
    productionVersion: 53,
    mutationsEnabled: false,
    scheduledConfigurationVerified: true,
    scheduledFreshnessVerified: false,
  });
}

async function runCli() {
  const [phase, privateRoot, planPath, backupPath, inventoryPath, confirm] =
    process.argv.slice(2);
  assert.equal(confirm, 'v53', 'explicit final argument v53 required');
  const result = await runScheduledReleasePhase({
    phase,
    privateRoot: path.resolve(privateRoot),
    planPath: path.resolve(planPath),
    backupPath: backupPath ? path.resolve(backupPath) : '',
    inventoryPath: inventoryPath ? path.resolve(inventoryPath) : '',
  });
  process.stdout.write(JSON.stringify({
    phase: result.phase,
    checkedAt: result.checkedAt,
    candidateTreeSha256: result.candidateTreeSha256,
    productionVersion: result.productionVersion,
    mutationsEnabled: result.mutationsEnabled,
    sheetCount: result.sheetCount,
  }) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch(error => {
    process.stderr.write((error instanceof Error ? error.message : 'v53 release failed') + '\n');
    process.exitCode = 1;
  });
}
