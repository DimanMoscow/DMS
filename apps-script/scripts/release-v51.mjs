import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {googleJson, loadAuthorizationProfile, refreshGoogleAccessToken} from './google-auth.mjs';
import {normalizeRemoteFiles, verifyRemoteBaseline, materializeCandidate} from './apps-script-preflight.mjs';
import {readCanonicalSource, sha256, sourceTreeSha256} from './source-integrity.mjs';
import {runtimeSourceHashes} from './runtime-source-hashes.mjs';
import {verifyRuntimeIdentity} from './runtime-identity.mjs';
import {verifyOfflineReleasePlan} from './release-plan.mjs';
import {verifyBackupManifest, withBackupProductionPointer} from './verify-backup-manifest.mjs';
import {createP1PrivateRecovery} from './p1-private-backup.mjs';
import {applyConfirmationSchemaV2} from '../migrations/telegram-confirmations-v2/apply.mjs';
import {applyFinancialMigration} from '../migrations/financial-formulas-v1/apply.mjs';
import {assertPrivateRegularFile} from '../../scripts/path-policy.mjs';

const read = file => JSON.parse(fs.readFileSync(file));
const sourceMap = directory => new Map(fs.readdirSync(directory).sort().map(name =>
  [name, readCanonicalSource(path.join(directory, name))]));

export function verifyP1Inventory(inventory, {requireDrained = false, now = Date.now()} = {}) {
  assert.equal(inventory.originalDocumentContext, true);
  assert.equal(inventory.mutationReady, false, 'New writers must remain paused');
  assert.equal(inventory.scriptLockAvailable, true);
  assert.equal(inventory.documentLockAvailable, true, 'Inventory must use the original bound context');
  assert.equal(inventory.usage.document.available, true);
  assert.ok(now - Date.parse(inventory.checkedAt) >= 0 && now - Date.parse(inventory.checkedAt) < 600000,
    'Original-context inventory must be fresh');
  assert.equal(inventory.legacyStates.malformed, 0, 'Malformed legacy evidence requires private recovery');
  assert.ok(Object.values(inventory.legacyStates).every(n => Number.isInteger(n) && n >= 0));
  if (requireDrained) assert.ok(Number.isFinite(Date.parse(inventory.drainStartedAt)) &&
    now - Date.parse(inventory.drainStartedAt) >= 420000, 'Old execution drain is incomplete');
  return true;
}

// Scoped v50 -> v51 release. Each explicit phase rechecks live sources and stores
// a private checkpoint. There is no automatic rollback across changed formulas.
export async function runP1Phase({phase, privateRoot, planPath, backupPath, inventoryPath, fetchImpl = fetch}) {
  assert.ok(['backup', 'stage', 'publish', 'migrate'].includes(phase));
  assertPrivateRegularFile(path.join(privateRoot, 'target.json'), process.cwd(), 'private target');
  const plan = read(planPath);
  const sourceRevision = execFileSync('git', ['-c', 'safe.directory=' + process.cwd().replaceAll('\\', '/'),
    'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  verifyOfflineReleasePlan(plan, {sourceRevision});
  // Format validation is separate from authentication, and both profiles are required.
  loadAuthorizationProfile(path.join(privateRoot, 'reader-profile.json'), 'reader');
  const profile = loadAuthorizationProfile(path.join(privateRoot, 'writer-profile.json'), 'writer');
  const token = await refreshGoogleAccessToken(profile, fetchImpl);
  const target = read(path.join(privateRoot, 'target.json'));
  const productionSource = read(path.join(privateRoot, 'p1-isolated-target.json')).sourceSpreadsheetId;
  const verification = read('apps-script/verification.json');
  const directory = 'apps-script/candidates/v51'; const files = sourceMap(directory);
  const tree = sourceTreeSha256(directory, [...files.keys()]);
  assert.equal(tree, verification.candidates.v51.sourceTreeSha256);
  const base = 'https://script.googleapis.com/v1/projects/' + encodeURIComponent(target.script_id);
  const [numbered, head, deployments] = await Promise.all([
    googleJson(token, base + '/content?versionNumber=50', {}, fetchImpl),
    googleJson(token, base + '/content', {}, fetchImpl),
    googleJson(token, base + '/deployments', {}, fetchImpl),
  ]);
  const substitutions = verifyRemoteBaseline({remoteFiles: normalizeRemoteFiles(numbered.files),
    baselineFiles: sourceMap('apps-script/versions/v50'), sanitizations: verification.repositorySanitizations});
  const runtimeUrl = substitutions.appsScriptProductionUrl;
  const matching = (deployments.deployments || []).filter(d => (d.entryPoints || [])
    .some(e => e.webApp?.url === runtimeUrl));
  assert.equal(matching.length, 1, 'Production deployment URL must resolve exactly once');
  const deployment = matching[0];
  const version = Number(deployment.deploymentConfig.versionNumber);
  assert.ok(version === 50 || version === 51, 'Unexpected production version');
  const materialized = materializeCandidate(files, verification.repositorySanitizations, substitutions);
  const save = (name, result) => {
    const report = {phase, checkedAt: new Date().toISOString(), sourceRevision,
      candidateTreeSha256: tree, ...result};
    fs.writeFileSync(path.join(privateRoot, name), JSON.stringify(report, null, 2), {mode: 0o600});
    return report;
  };
  if (phase === 'backup') {
    const recovery = await createP1PrivateRecovery({accessToken: token, sourceSpreadsheetId: productionSource,
      privateRoot, label: 'pre-release', appsScriptVersion: 'v' + version, fetchImpl});
    return save('p1-current-recovery.json', recovery);
  }
  assertPrivateRegularFile(backupPath, process.cwd(), 'fresh recovery manifest');
  const backup = read(backupPath); verifyBackupManifest(backup);
  assert.equal(sha256(productionSource), backup.sourceSpreadsheetRefSha256);
  assert.equal(backup.migrationLedgerSha256, sha256(fs.readFileSync('apps-script/migrations/ledger.json')));
  assert.ok(Date.now() - Date.parse(backup.copyVerifiedAt) < 3600000, 'Release requires backup less than one hour old');
  const headFiles = normalizeRemoteFiles(head.files);
  if (phase === 'stage') {
    assert.equal(version, 50);
    if (JSON.stringify([...headFiles]) === JSON.stringify([...materialized])) {
      return save('p1-staged.json', {headVerified: true, mutationsEnabled: false, productionVersion: 50, reusedHead: true});
    }
    assert.deepEqual(headFiles, normalizeRemoteFiles(numbered.files), 'HEAD changed since v50');
    const apiFiles = [...materialized].map(([name, source]) => name === 'appsscript.json'
      ? {name: 'appsscript', type: 'JSON', source} : {name: name.slice(0, -3), type: 'SERVER_JS', source});
    await googleJson(token, base + '/content', {method: 'PUT', body: JSON.stringify({files: apiFiles})}, fetchImpl);
    assert.deepEqual(normalizeRemoteFiles((await googleJson(token, base + '/content', {}, fetchImpl)).files), materialized);
    return save('p1-staged.json', {headVerified: true, mutationsEnabled: false, productionVersion: 50});
  }
  assert.deepEqual(headFiles, materialized, 'HEAD must equal the verified v51 candidate');
  assertPrivateRegularFile(inventoryPath, process.cwd(), 'original-context inventory');
  const inventory = read(inventoryPath);
  verifyP1Inventory(inventory, {requireDrained: phase === 'migrate'});
  if (phase === 'publish') {
    const versions = await googleJson(token, base + '/versions?pageSize=200', {}, fetchImpl);
    const maximum = Math.max(...versions.versions.map(v => Number(v.versionNumber)));
    assert.ok(maximum === 50 || maximum === 51, 'Unexpected numbered version');
    if (maximum === 50) {
      const created = await googleJson(token, base + '/versions', {method: 'POST',
        body: JSON.stringify({description: 'DMS P1 security and financial integrity; initially paused'})}, fetchImpl);
      assert.equal(Number(created.versionNumber), 51);
    }
    assert.deepEqual(normalizeRemoteFiles((await googleJson(token, base + '/content?versionNumber=51', {}, fetchImpl)).files), materialized);
    await googleJson(token, base + '/deployments/' + encodeURIComponent(deployment.deploymentId), {method: 'PUT',
      body: JSON.stringify({deploymentConfig: {versionNumber: 51,
        manifestFileName: deployment.deploymentConfig.manifestFileName,
        description: deployment.deploymentConfig.description}})}, fetchImpl);
    const after = await googleJson(token, base + '/deployments/' + encodeURIComponent(deployment.deploymentId), {}, fetchImpl);
    assert.equal(Number(after.deploymentConfig.versionNumber), 51);
    return save('p1-published-paused.json', {numberedSnapshotVerified: true, deploymentVerified: true,
      productionVersion: 51, mutationsEnabled: false, legacyInventory: inventory});
  }
  assert.equal(version, 51);
  const published = read(path.join(privateRoot, 'p1-published-paused.json'));
  assert.equal(published.candidateTreeSha256, tree);
  assert.ok(Date.parse(inventory.drainStartedAt) >= Date.parse(published.checkedAt));
  const probe = new URL(runtimeUrl); probe.searchParams.set('dms_runtime_identity', '1');
  probe.searchParams.set('probe', 'p1-migration-' + Date.now());
  const response = await fetchImpl(probe, {cache: 'no-store', signal: AbortSignal.timeout(30000)});
  assert.equal(response.ok, true); verifyRuntimeIdentity(await response.json(), runtimeSourceHashes(directory));
  // Copy again after the old writer drain; this is the migration recovery point.
  const recovery = await createP1PrivateRecovery({accessToken: token, sourceSpreadsheetId: productionSource,
    privateRoot, label: 'drained-pre-migration', appsScriptVersion: 'v51', fetchImpl});
  const ledger = read('apps-script/migrations/ledger.json');
  const legacyStates = Object.entries(inventory.legacyStates).flatMap(([status, count]) =>
    Array.from({length: count}, () => ({status, hasPendingOperation: status === 'pending' || status === 'unknown'})));
  const confirmation = await withBackupProductionPointer({numberedVersion: version}, () =>
    applyConfirmationSchemaV2({accessToken: token, spreadsheetId: productionSource,
      backupManifest: recovery.manifest, appliedLedger: ledger, legacyStates, dryRun: false, fetchImpl}));
  save('p1-confirmation-migrated-paused.json', {confirmation, recoveryManifestPath: recovery.manifestPath,
    mutationsEnabled: false, verifiedMigration: 'telegram-confirmations-v2'});
  ledger.applied.push({id: 'telegram-confirmations-v2', verifiedAt: new Date().toISOString()});
  const financial = await withBackupProductionPointer({numberedVersion: version}, () =>
    applyFinancialMigration({accessToken: token, spreadsheetId: productionSource,
      backupManifest: recovery.manifest, appliedLedger: ledger, dryRun: false, executionsDrained: true, fetchImpl}));
  return save('p1-migrated-paused.json', {confirmation, financial, recoveryManifestPath: recovery.manifestPath,
    mutationsEnabled: false, numericActivationGateRequired: true, productionPaymentCalendarWrites: 0});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [phase, privateRoot, planPath, backupPath, inventoryPath, confirm] = process.argv.slice(2);
  assert.equal(confirm, 'v51', 'Explicit final argument v51 required');
  try {
    const result = await runP1Phase({phase, privateRoot, planPath, backupPath, inventoryPath});
    console.log(JSON.stringify({phase: result.phase, checkedAt: result.checkedAt,
      candidateTreeSha256: result.candidateTreeSha256, productionVersion: result.productionVersion,
      mutationsEnabled: result.mutationsEnabled, sheetCount: result.sheetCount}));
  } catch (error) {
    // Assertions may include source or API payloads: keep diagnostics private.
    assertPrivateRegularFile(path.join(privateRoot, 'target.json'), process.cwd(), 'private target');
    fs.writeFileSync(path.join(privateRoot, 'p1-phase-error.json'), JSON.stringify({phase,
      at: new Date().toISOString(), error: error.message}), {mode: 0o600});
    console.error('P1 phase failed; diagnostic saved in private p1-phase-error.json.'); process.exitCode = 1;
  }
}
