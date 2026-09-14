// Complete Apps Script bundle with service-boundary emulators only. No Google
// credentials, external network or business-function replacements are used.
import crypto from 'node:crypto';
import vm from 'node:vm';
import {loadBundle} from './apps-script-bundle.mjs';
import {memoryWorkbook} from './memory-workbook.mjs';

export function isolatedCandidateBackend(candidate='v57') {
  const token='isolated-fixture-token-never-valid-in-telegram';
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow'}).format(new Date());
  const date=(offset,time='00:10')=>new Date(new Date(day+'T'+time+':00+03:00').getTime()+offset*86400000);
  const client=(id,name,block='',price=0)=>[id,name,'Активен',block,block?'Блок 10':'',block?1:0,block?9:0,
    block?30000:0,block?30000:0,0,price?'Разовые — '+price+' ₽':'','',name+' ПТ',''];
  const queue=(id,offset,owner,name,event)=>[id,date(offset),'fixture-calendar',event,name+' ПТ',date(offset),date(offset,'00:20'),
    name+' ПТ',owner,name,'',owner?'Распознано':'Требует регистрации',owner?'Проведена':'',owner?'Ожидает':'Требует регистрации','','',''];
  const rows={
    'Клиенты':[[],[],[],['ID'],client('CL-BLOCK','Тестовый блок','BL-FIXTURE'),
      client('CL-SINGLE','Тестовая разовая','',3500),client('CL-NOPRICE','Тестовый без цены')],
    'Блоки':[[],[],['ID'],['BL-FIXTURE','CL-BLOCK','Блок 10','Активен',date(-10),'','',10,1,9,30000,3000,0,30000,0,'',false]],
    'Оплаты':[[],[],['ID'],['OP-FIXTURE',date(-10),'CL-BLOCK','BL-FIXTURE','Оплата','Перевод',30000,'Подтверждён'],
      ['OP-SINGLE',date(-2),'CL-SINGLE','','Оплата','Перевод',3500,'Подтверждён']],
    'Журнал тренировок':[[],[],['ID'],['TR-BLOCK',date(-3),'CL-BLOCK','BL-FIXTURE','Блок 10','Фактически проведена','Проведена',3000],
      ['TR-SINGLE',date(-2),'CL-SINGLE','','Разовая','Фактически проведена','Проведена',3500]],
    'Очередь подтверждения':[[],[],['ID'],queue('Q-TODAY',0,'CL-SINGLE','Тестовая разовая','evt-today'),
      queue('Q-UNKNOWN',0,'','Новый тестовый клиент','evt-unknown'),
      queue('Q-OLDER',-5,'','Прошлая тестовая регистрация','evt-older')],
    'Настройки':Array.from({length:10},()=>[]).concat([
      ['Календарь для учёта','fixture-calendar'],['Начало автоматического учёта',date(-20)],['Часовой пояс учёта','Europe/Moscow']]),
    'Отчёт':[[],[],['Выбранный месяц',new Date('2026-08-01T00:00:00+03:00')],[],[],
      ['Проведено тренировок',2],['Всего заработано работой',6500],['Получено денег',33500],
      ['Оплаченные рабочие расходы',0],['Денежный результат',33500],['Дебиторская задолженность',0]],
    'Журнал действий бота':[['ID']],
  };
  const book=memoryWorkbook(rows);
  const events=rows['Очередь подтверждения'].slice(3).map(r=>({id:r[3],summary:r[4],status:'confirmed',
    updated:date(-10).toISOString(),start:{dateTime:r[5].toISOString()},end:{dateTime:r[6].toISOString()}}));
  const logs=[];const calls=[];
  const f=loadBundle(candidate,{SpreadsheetApp:book.service,
    ScriptApp:{getProjectTriggers:()=>[],getScriptId:()=> 'fixture-script'},
    DriveApp:{getFileById:()=>{throw new Error('Isolated fixture has no production backup');}},
    UrlFetchApp:{fetch:()=>{throw new Error('External network forbidden in fixture backend');}},
    Calendar:{Events:{list:(id,params)=>{
      if(id!=='fixture-calendar')throw new Error('Calendar target outside fixture');
      return {items:events.filter(e=>(!params.timeMin||new Date(e.end.dateTime)>new Date(params.timeMin))&&
        (!params.timeMax||new Date(e.start.dateTime)<new Date(params.timeMax)))};
    },get:(id,event)=>{if(id!=='fixture-calendar')throw new Error('Calendar target outside fixture');
      const found=events.find(e=>e.id===event);if(!found)throw new Error('Not Found');return found;}}},
    console:{log:v=>logs.push(v),error:v=>logs.push(v)},
  });
  const c=f.context;
  const hmacBytes=value=>Array.isArray(value)?Buffer.from(value.map(b=>b&255)):String(value);
  c.Utilities.computeHmacSha256Signature=(value,key)=>Array.from(crypto.createHmac('sha256',
    hmacBytes(key)).update(hmacBytes(value)).digest());
  f.properties.set('DMS_TG_BOT_TOKEN',token);
  const portal=vm.runInContext('DMS_CLIENT_PORTAL',c);
  for(const [name,headers] of [[portal.ACCESS_SHEET,portal.ACCESS_HEADERS],
    [portal.INVITES_SHEET,portal.INVITE_HEADERS],[portal.MEASUREMENTS_SHEET,portal.MEASUREMENT_HEADERS]]) {
    book.workbook.insertSheet(name).appendRow(headers);
  }
  book.writes.length=0;
  function signedInitData(age=0) {
    const values={auth_date:String(Math.floor(Date.now()/1000)-age),user:JSON.stringify({id:1001,first_name:'Fixture'})};
    const check=Object.keys(values).sort().map(k=>k+'='+values[k]).join('\n');
    const secret=crypto.createHmac('sha256','WebAppData').update(token).digest();
    const hash=crypto.createHmac('sha256',secret).update(check).digest('hex');
    return new URLSearchParams({...values,hash}).toString();
  }
  return {book,context:c,logs,calls,day,signedInitData,
    get:()=>JSON.parse(c.doGet({parameter:{dms_runtime_identity:'1'}}).text),
    post:(body)=>{
      calls.push({action:body.action,payload:body.payload||{}});
      if(!['bootstrap','resolve_miniapp_entry','client','health','preview_calendar_onboarding'].includes(body.action))
        return {ok:false,status:409,error:'fixture_mutation_blocked'};
      const result=JSON.parse(c.doPost({postData:{contents:JSON.stringify(body),type:'application/json'}}).text);
      if(book.writes.length)throw new Error('Read-only fixture unexpectedly wrote business data');
      return result;
    }};
}
