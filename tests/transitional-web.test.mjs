import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as runtime from '../lib/apps-script-runtime-identity.ts';
import {sourceTreeSha256} from '../apps-script/scripts/source-integrity.mjs';
import {isolatedCandidateBackend} from './helpers/isolated-candidate-backend.mjs';
import {miniAppViews} from './helpers/miniapp-render.mjs';

const views=miniAppViews();
const render=(name,props)=>renderToStaticMarkup(React.createElement(views[name],props));
// Compile each Web handler once; the same artifact and configuration are used
// across both real numbered backend bundles. Only the network boundary changes.
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const proxySource=compile('app/api/dms/route.ts');
const probeSource=compile('app/api/apps-script-runtime/route.ts');
function web(backend) {
  const env={exports:{},Response,URL,AbortSignal,Date,console:{log(){},error(){}},
    require:name=>{
      if(name==='@/lib/apps-script-runtime-identity')return runtime;
      if(name==='@/lib/dms-server-config')return {getDmsAppsScriptUrl:()=> 'https://fixture.invalid/exec'};
      if(name==='@/lib/release-identity')return {MINIAPP_RELEASE:'0.2.7',MINIAPP_RUNTIME_FINGERPRINT:'fixture'};
      if(name==='@/lib/request-id')return {getSafeRequestId:()=> 'fixture'};
      throw new Error('Unexpected Web dependency '+name);
    },fetch:async(_url,options)=>{
      assert.equal(options.cache,'no-store');
      return Response.json(options.method==='POST'?backend.post(JSON.parse(options.body)):backend.get());
    }};
  const proxy=vm.createContext({...env,exports:{}}),probe=vm.createContext({...env,exports:{}});
  vm.runInContext(proxySource,proxy);vm.runInContext(probeSource,probe);
  return {probe:probe.exports.GET,read:async(action,payload={},initData=backend.signedInitData())=>{
    const response=await proxy.exports.POST(new Request('https://fixture.invalid/api/dms',{
      method:'POST',body:JSON.stringify({action,payload,initData})}));
    assert.equal(response.headers.get('cache-control'),'no-store');
    return {status:response.status,body:await response.json()};
  }};
}

test('transition manifest binds exactly two immutable numbered trees; production pointer remains v56',()=>{
  assert.equal(runtime.RUNTIME_MIGRATION.phase,'v56-v57-transition');
  assert.deepEqual(runtime.RUNTIME_MIGRATION.identities.map(x=>x.version),[56,57]);
  for(const entry of runtime.RUNTIME_MIGRATION.identities){
    const directory='apps-script/versions/v'+entry.version;
    assert.equal(sourceTreeSha256(directory,fs.readdirSync(directory)),entry.sourceTreeSha256);
    assert.match(entry.sourceCommit,/^[a-f0-9]{40}$/);
  }
  assert.equal(JSON.parse(fs.readFileSync('apps-script/production.json')).candidate,'v56');
});

for(const version of ['v56','v57']) {
  test(version+' exact runtime accepted; unknown, altered, missing markers fail closed',async()=>{
    const backend=isolatedCandidateBackend(version), exact=backend.get();
    assert.equal(runtime.admittedAppsScriptRuntime(exact).version,Number(version.slice(1)));
    assert.equal((await web(backend).probe()).status,200);
    for(const patch of [{release:'unknown'},{routerSha256:'0'.repeat(64)},
      {clientPortalSha256:'0'.repeat(64)},{telegramConfirmationsSha256:'0'.repeat(64)},
      {clientPortalHandlerLoaded:undefined},{telegramConfirmationsHandlerLoaded:false},{ok:false}]) {
      const bad={...exact,...patch};
      assert.equal(runtime.matchesAppsScriptRuntime(bad),false);
      assert.equal((await web({...backend,get:()=>bad}).probe()).status,502);
    }
  });
  test(version+' same Web signed reads and optional capability rendering produce zero business writes',async()=>{
    const backend=isolatedCandidateBackend(version), client=web(backend);
    const snapshot=()=>JSON.stringify(backend.book.workbook.getSheets().map(sheet=>[sheet.getName(),sheet.getDataRange().getValues()]));
    const before=snapshot();
    const boot=await client.read('bootstrap');assert.equal(boot.status,200);assert.equal(boot.body.ok,true);
    const data=boot.body.data;
    assert.match(render('TodayView',{data,busyKey:'',onDecision(){},onOnboard(){},onConfirmDay(){}}),/Тестовая разовая/);
    assert.match(render('ClientsView',{clients:data.clients,onSelect(){}}),/Тестовый блок/);
    assert.match(render('ReportView',{report:data.report}),/Отчёт/);
    for(const id of ['CL-BLOCK','CL-SINGLE','CL-NOPRICE']) {
      const result=await client.read('client',{clientId:id});assert.equal(result.body.ok,true);
      const detail=result.body.data;
      const html=render('LoadedClientCard',{detail,initData:backend.signedInitData(),onBack(){}});
      assert.ok(html.includes(detail.name));
      if(id==='CL-SINGLE') {
        assert.match(html,/3\s500\s₽/);
        if(version==='v57'){assert.match(html,/История тренировок/);assert.equal(detail.trainingHistory.length,1);}
        else {assert.equal(detail.trainingHistory,undefined);assert.doesNotMatch(html,/История тренировок/);}
      }
    }
    for(const queueId of ['Q-UNKNOWN','Q-OLDER']) {
      const preview=await client.read('preview_calendar_onboarding',{queueId,mode:'ignore'});
      assert.equal(preview.body.ok,true);
    }
    if(version==='v57'){
      assert.ok(data.registrationQueue.some(r=>r.queueId==='Q-OLDER'));
      assert.ok(!data.today.waiting.some(r=>r.queueId==='Q-OLDER'));
    } else assert.equal(data.registrationQueue,undefined);
    const health=await client.read('health');assert.equal(health.body.ok,true);
    assert.match(render('SystemView',{health:health.body.data,service:null,appsScriptRuntime:backend.get(),onRefresh(){}}),/Состояние системы/);
    // The isolated fixture deliberately has no production trigger/backup: its
    // health verdict must remain red; transport success is not a fake green gate.
    assert.equal(health.body.data.ok,false);
    assert.equal((await client.read('bootstrap',{},backend.signedInitData(21601))).status,401);
    assert.equal((await client.read('bootstrap',{},'invalid')).status,401);
    assert.equal(backend.book.writes.length,0);assert.equal(snapshot(),before);
  });
}

test('unchanged transitional Web accepts backend rollback v57 to v56',async()=>{
  let active=isolatedCandidateBackend('v57');
  const backend={get:()=>active.get(),post:b=>active.post(b),signedInitData:()=>active.signedInitData()};
  const unchanged=web(backend);
  assert.equal((await unchanged.probe()).status,200);
  assert.equal((await unchanged.read('bootstrap')).body.ok,true);
  active=isolatedCandidateBackend('v56');
  assert.equal((await unchanged.probe()).status,200);
  assert.equal((await unchanged.read('bootstrap')).body.ok,true);
  assert.equal(active.book.writes.length,0);
});
