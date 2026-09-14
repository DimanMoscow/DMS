import assert from 'node:assert/strict';
import test from 'node:test';
import {isolatedCandidateBackend} from './helpers/isolated-candidate-backend.mjs';
import {execFileSync} from 'node:child_process';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {miniAppViews} from './helpers/miniapp-render.mjs';
test('isolated candidate uses signed auth, real bootstrap/client readers and no writes',()=>{
  const f=isolatedCandidateBackend();
  const request=(action,payload={})=>f.post({dmsMiniApp:'dms-fitness-miniapp',version:1,initData:f.signedInitData(),action,payload});
  const bootstrap=request('bootstrap');assert.equal(bootstrap.ok,true,JSON.stringify(bootstrap));
  assert.equal(bootstrap.data.clients.length,3);
  assert.equal(bootstrap.data.registrationQueue.find(r=>r.queueId==='Q-OLDER').needsRegistration,true);
  assert.equal(bootstrap.data.today.waiting.some(r=>r.queueId==='Q-OLDER'),false);
  for(const id of ['CL-BLOCK','CL-SINGLE','CL-NOPRICE']) {
    const r=request('client',{clientId:id});assert.equal(r.ok,true,JSON.stringify(r));
  }
  assert.equal(f.get().release,'post-burn-in-audit');
  const expired=f.post({dmsMiniApp:'dms-fitness-miniapp',version:1,initData:f.signedInitData(21601),action:'bootstrap'});
  assert.equal(expired.error,'expired_init_data');
  assert.equal(f.book.writes.length,0);
});

test('current and older onboarding previews stay read-only; health exposes missing fixture dependencies',()=>{
  const f=isolatedCandidateBackend();
  const request=(action,payload={})=>f.post({dmsMiniApp:'dms-fitness-miniapp',version:1,initData:f.signedInitData(),action,payload});
  for(const queueId of ['Q-UNKNOWN','Q-OLDER']) for(const mode of ['ignore','link']) {
    const r=request('preview_calendar_onboarding',{queueId,mode,clientId:'CL-SINGLE'});
    assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.data.createsJournal,false);assert.equal(r.data.changesCalendar,false);
  }
  const health=request('health');assert.equal(health.ok,true);assert.equal(health.data.ok,false);
  assert.ok(health.data.failures.some(f=>f.name==='latest-backup-integrity'));
  const phases=f.logs.filter(x=>String(x).includes('dms_health_phase')).map(x=>JSON.parse(x));
  assert.ok(phases.some(p=>p.phase==='calendar_reconciliation'));
  assert.ok(phases.every(p=>p.durationMs>=0));
  assert.equal(request('confirm_day').error,'fixture_mutation_blocked');
  assert.equal(f.book.writes.length,0);
});

for(const [web,backend] of [['current','v56'],['baseline','v57']]) {
  test(`${web} Web renders real ${backend} read contracts without optional fields becoming mandatory`,()=>{
    const f=isolatedCandidateBackend(backend);
    const request=(action,payload={})=>f.post({dmsMiniApp:'dms-fitness-miniapp',version:1,initData:f.signedInitData(),action,payload});
    const views=web==='current'?miniAppViews():miniAppViews(execFileSync('git',[
      'show','4ab73e2103e85c3e0dd199ac220db51d2ccd61d3:app/_components/mini-app-shell.tsx'],{encoding:'utf8'}));
    const data=request('bootstrap').data;
    const html=renderToStaticMarkup(React.createElement(views.TodayView,{data,busyKey:'',onDecision(){},onOnboard(){},onConfirmDay(){}}));
    assert.match(html,/Тестовая разовая/);
    assert.equal(data.today.waiting.some(r=>r.queueId==='Q-OLDER'),false);
    for(const clientId of ['CL-BLOCK','CL-SINGLE','CL-NOPRICE']) {
      const detail=request('client',{clientId}).data;
      assert.ok(renderToStaticMarkup(React.createElement(views.LoadedClientCard,{detail,initData:'fixture',onBack(){}})).includes(detail.name));
    }
    assert.equal(f.book.writes.length,0);
  });
}
