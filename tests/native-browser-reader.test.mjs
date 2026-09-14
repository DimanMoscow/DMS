import test from 'node:test';
import assert from 'node:assert/strict';
import {readNativeBrowser} from '../apps-script/scripts/native-browser-reader.mjs';

function fixture(option) {
  let clicks=0;
  const checkedAt=new Date().toISOString();
  const inspector={checkedAt,originalDocumentContext:true};
  const tab={url:async()=> 'https://script.google.com/home/projects/fixture/edit',reload:async()=>{},
    playwright:{domSnapshot:async()=>['Аккаунт Google: fixture-owner',option,
      ...(clicks?['generic: '+JSON.stringify(JSON.stringify(inspector)),'Выполнение завершено']:[])].join('\n'),
      getByRole:(_role,{name})=>({isEnabled:async()=>false,click:async()=>{assert.equal(name,'Выполнить выбранную функцию');clicks++;},
        first:()=>({waitFor:async()=>{}})}),
      evaluate:async()=>({DMS_CALENDAR_BOUNDED_SCAN_V1:'fixture-scan',DMS_CALENDAR_SYNC_GENERATION_V1:'fixture-generation',DMS_P1_RELEASE_READY:'fixture-ready'})}};
  return {args:{settings:tab,editor:tab,challenge:{requestedAt:checkedAt,nonce:'fixture'},scriptId:'fixture',owner:'fixture-owner'},clicks:()=>clicks};
}
test('native inspector permits the selected option with an additional active marker',async()=>{
  for(const option of ['option "inspectDmsP1ReleaseState" [selected]','option "inspectDmsP1ReleaseState" [active] [selected]']) {
    const f=fixture(option);const result=await readNativeBrowser(f.args);
    assert.equal(result.inspector.originalDocumentContext,true);assert.equal(f.clicks(),1);
  }
});
test('native inspector rejects an unselected inspector or a different selected function before execution',async()=>{
  for(const option of ['option "inspectDmsP1ReleaseState" [active]','option "inspectDmsP1ReleaseState"\noption "activateDmsP1Release" [selected]']) {
    const f=fixture(option);await assert.rejects(readNativeBrowser(f.args),/Inspector not selected/);assert.equal(f.clicks(),0);
  }
});
