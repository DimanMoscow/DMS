// Run only in the authorized cua_repl browser runtime with its documented APIs.
// Handles are prepared before collection. No filesystem/network, hidden state,
// code edit, property edit, trigger edit or release action occurs here.
export async function readNativeBrowser({settings,editor,challenge,scriptId,owner}) {
  const started=Date.now();
  for(const tab of [settings,editor]) {
    const url=new URL(await tab.url());
    if(url.origin!=='https://script.google.com'||!url.pathname.includes('/projects/'+scriptId+'/'))
      throw new Error('Wrong native project');
    const dom=await tab.playwright.domSnapshot();
    if(!dom.includes('Аккаунт Google:')||!dom.includes(owner))throw new Error('Native account not proved');
  }
  let dom=await editor.playwright.domSnapshot();
  if(!dom.split('\n').some(line=>line.includes('option "inspectDmsP1ReleaseState"')&&line.includes('[selected]')))
    throw new Error('Inspector not selected');
  if(await editor.playwright.getByRole('button',{name:'Сохранить проект на Диск',exact:true}).isEnabled())
    throw new Error('Unsaved editor changes');
  await editor.playwright.getByRole('button',{name:'Выполнить выбранную функцию',exact:true}).click();
  let inspector;
  while(Date.now()-started<60000) {
    dom=await editor.playwright.domSnapshot();
    const line=dom.split('\n').find(l=>l.includes('generic: "{\\"checkedAt'));
    if(line){const found=JSON.parse(JSON.parse(line.split('generic: ')[1]));
      if(Date.parse(found.checkedAt)>=Date.parse(challenge.requestedAt)&&dom.includes('Выполнение завершено')){inspector=found;break;}}
  }
  if(!inspector)throw new Error('Fresh completed inspector unavailable');
  await settings.reload();
  await settings.playwright.getByRole('textbox',{name:'Свойство',exact:true}).first().waitFor({state:'visible',timeoutMs:15000});
  const properties=await settings.playwright.evaluate(()=>{
    const allowed=['DMS_CALENDAR_BOUNDED_SCAN_V1','DMS_CALENDAR_SYNC_GENERATION_V1','DMS_P1_RELEASE_READY'];
    return Object.fromEntries(Array.from(document.querySelectorAll('input[id^="propertyName"]'))
      .filter(e=>allowed.includes(e.value)).map(e=>[e.value,document.getElementById(e.id.replace('propertyName','propertyValue'))?.value]));
  });
  if(Object.keys(properties).length!==3)throw new Error('Native properties missing');
  return {...challenge,projectId:scriptId,owner,checkedAt:new Date().toISOString(),properties,inspector};
}
