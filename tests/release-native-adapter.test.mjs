import test from 'node:test';
import assert from 'node:assert/strict';
import {validateNativeReceipt} from '../apps-script/scripts/native-ui-channel.mjs';
const at='2026-09-14T14:50:00.000Z';
function fixture(){return {nonce:'challenge',projectId:'fixture',owner:'fixture-owner',checkedAt:at,
  properties:{DMS_P1_RELEASE_READY:'emergency-semantic-recovery-2026-09',
    DMS_CALENDAR_BOUNDED_SCAN_V1:JSON.stringify({version:1,calendarFingerprint:'x'.repeat(22),lastSuccessfulAt:at,lastWideVerificationAt:at}),
    DMS_CALENDAR_SYNC_GENERATION_V1:JSON.stringify({version:1,syncGeneration:117,status:'succeeded',lastSyncStarted:at,lastSyncCompleted:at,postSync:{checkedAt:at}})},
  inspector:{checkedAt:at,originalDocumentContext:true,mutationReady:true,scriptLockAvailable:true,documentLockAvailable:true,
    scheduledAutomation:{ownerVerified:true,configOk:true,settingsOk:true},legacyStates:{pending:0,consumed:0,revoked:0,expired:0,unknown:0,malformed:0},
    durableOperations:{pending:0,stale:0,manualReview:0},usage:{script:{failSafe:false},document:{failSafe:false}}}};}
const validate=r=>validateNativeReceipt(r,{nonce:'challenge',requestedAt:at},{scriptId:'fixture',owner:'fixture-owner'},Date.parse(at));
test('native adapter accepts a fresh owner/project challenge and retains exact cursor/generation',()=>{
  const r=validate(fixture());assert.equal(r.generation.syncGeneration,117);assert.equal(r.scan.lastSuccessfulAt,at);
});
test('native adapter rejects wrong identity, stale/missing cursor, replay and unresolved safety',()=>{
  for(const patch of [{nonce:'old'},{owner:'other'},{projectId:'other'},{checkedAt:'2026-09-14T14:49:59.999Z'}])assert.throws(()=>validate({...fixture(),...patch}));
  const missing=fixture();delete missing.properties.DMS_CALENDAR_BOUNDED_SCAN_V1;assert.throws(()=>validate(missing));
  const dirty=fixture();dirty.inspector.durableOperations.pending=1;assert.throws(()=>validate(dirty));
  const absent=fixture();absent.inspector.legacyStates={};assert.throws(()=>validate(absent));
  const started=fixture();started.properties.DMS_CALENDAR_SYNC_GENERATION_V1=JSON.stringify({version:1,syncGeneration:117,status:'running'});assert.throws(()=>validate(started));
});
