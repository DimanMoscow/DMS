import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {assertPrivateRegularFile,isOutsidePath} from '../../scripts/path-policy.mjs';

// Agent-mediated supported browser transport. The caller reads the settings DOM
// and runs the EXISTING read-only inspector; never execute private browser RPCs.
// A saved old receipt cannot satisfy a new challenge or the second native read.
export function validateNativeReceipt(receipt,challenge,target,now=Date.now()) {
  assert.equal(receipt.nonce,challenge.nonce,'native challenge mismatch');
  assert.equal(receipt.projectId,target.scriptId,'native project mismatch');
  assert.equal(receipt.owner,target.owner,'native owner mismatch');
  for(const date of [receipt.checkedAt,receipt.inspector?.checkedAt]) {
    assert.ok(Date.parse(date)>=Date.parse(challenge.requestedAt),'stale native evidence');
    assert.ok(Date.parse(date)<=now && now-Date.parse(date)<=90000,'native evidence expired');
  }
  const i=receipt.inspector;
  assert.equal(i.originalDocumentContext,true);assert.equal(i.mutationReady,true);
  assert.equal(i.scriptLockAvailable,true);assert.equal(i.documentLockAvailable,true);
  assert.equal(i.scheduledAutomation.ownerVerified,true);
  assert.equal(i.scheduledAutomation.configOk,true);assert.equal(i.scheduledAutomation.settingsOk,true);
  assert.equal(receipt.properties.DMS_P1_RELEASE_READY,'emergency-semantic-recovery-2026-09');
  const scan=JSON.parse(receipt.properties.DMS_CALENDAR_BOUNDED_SCAN_V1);
  const generation=JSON.parse(receipt.properties.DMS_CALENDAR_SYNC_GENERATION_V1);
  assert.equal(scan.version,1);assert.match(scan.calendarFingerprint,/^[A-Za-z0-9_-]{22}$/);
  assert.ok(Number.isFinite(Date.parse(scan.lastSuccessfulAt)),'cursor missing');
  assert.ok(Number.isFinite(Date.parse(scan.lastWideVerificationAt)),'wide cursor missing');
  assert.ok(Date.parse(scan.lastWideVerificationAt)<=Date.parse(scan.lastSuccessfulAt)&&
    Date.parse(scan.lastSuccessfulAt)<=Date.parse(receipt.checkedAt),'invalid cursor chronology');
  assert.equal(generation.version,1);assert.ok(Number.isSafeInteger(generation.syncGeneration));
  assert.equal(generation.status,'succeeded','native sync is not quiescent');
  assert.equal(generation.lastSyncStarted,scan.lastSuccessfulAt,'cursor/generation mismatch');
  assert.ok(Date.parse(generation.lastSyncCompleted)>=Date.parse(generation.lastSyncStarted)&&
    Date.parse(generation.lastSyncCompleted)<=Date.parse(receipt.checkedAt),'completion missing');
  assert.equal(generation.postSync?.checkedAt,generation.lastSyncCompleted,'post-sync completion missing');
  for(const key of ['pending','consumed','revoked','expired','unknown','malformed']) assert.equal(i.legacyStates[key],0,'legacy state '+key);
  for(const key of ['pending','stale','manualReview']) assert.equal(i.durableOperations[key],0,'durable '+key);
  assert.equal(i.usage.script.failSafe,false);assert.equal(i.usage.document.failSafe,false);
  return {checkedAt:receipt.checkedAt,scan,generation,inspector:i,ready:receipt.properties.DMS_P1_RELEASE_READY,adapter:'native-ui-challenge-v1'};
}

export function nativeUiChannel({directory,target,repo,timeoutMs=90000,notify=console.log}) {
  assert.ok(path.isAbsolute(directory)&&isOutsidePath(repo,fs.realpathSync(directory)));
  assert.ok(target.owner && target.scriptId);
  return async()=>{
    const challenge={nonce:crypto.randomUUID(),requestedAt:new Date().toISOString()};
    const response=path.join(directory,challenge.nonce+'.response.json');
    fs.writeFileSync(path.join(directory,challenge.nonce+'.request.json'),JSON.stringify(challenge),{flag:'wx',mode:0o600});
    notify(JSON.stringify({nativeReadRequired:challenge,response}));
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline) {
      if(fs.existsSync(response)) {
        assertPrivateRegularFile(response,repo,'native response');
        return validateNativeReceipt(JSON.parse(fs.readFileSync(response)),challenge,target);
      }
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    throw new Error('native adapter timeout; no release acceptance');
  };
}
