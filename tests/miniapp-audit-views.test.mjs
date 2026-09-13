import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {miniAppViews} from './helpers/miniapp-render.mjs';
const {TodayView,LoadedClientCard}=miniAppViews();
const training={queueId:'Q-TEST',time:'10:00',endTime:'11:00',client:'Fixture <Long Name>',
  blockId:'',matching:'Требует регистрации',decision:'',status:'Требует регистрации',processed:false,needsRegistration:true};
const renderDay=data=>renderToStaticMarkup(React.createElement(TodayView,{data,busyKey:'',onDecision(){},onOnboard(){},onConfirmDay(){}}));

for (const [label,price,expected] of [
  ['active block',{blockId:'BL-TEST',blockPrice:30000,singlePrice:3500},'30 000 ₽'],
  ['confirmed one-off',{blockId:'',blockPrice:30000,singlePrice:3500},'3 500 ₽'],
  ['unknown price',{blockId:'',blockPrice:30000,singlePrice:0},'—'],
]) test('client price: '+label,()=>{
  const detail={id:'CL-TEST',name:'Fixture',completed:0,paid:0,debt:0,conditions:'',
    upcoming:[],trainingDates:[],clientPortal:{status:'unlinked',activeInvite:null},
    measurements:{active:[],auditCount:0},...price};
  const html=renderToStaticMarkup(React.createElement(LoadedClientCard,{detail,initData:'fixture',onBack(){}}));
  const value=html.match(/Стоимость<\/span><strong>(.*?)<\/strong>/)?.[1]?.replace(/\s/g,' ');
  assert.equal(value,expected);
});
test('unknown-only day does not claim completion or label unknown client as one-off',()=>{
  const html=renderDay({today:{title:'14.09.2026',dateKey:'2026-09-14',waiting:[training]}});
  assert.match(html,/Требуется регистрация: 1/);assert.doesNotMatch(html,/День обработан|Разовая/);
  assert.match(html,/Fixture &lt;Long Name&gt;/);assert.match(html,/disabled=""/);
});
test('older registration is actionable independently of the current day',()=>{
  const html=renderDay({today:{title:'14.09.2026',dateKey:'2026-09-14',waiting:[]},registrationQueue:[{...training,dateLabel:'09.09.2026'}]});
  for(const text of ['Регистрация · другие дни','09.09.2026','Новый клиент','Связать','Игнорировать','Нет событий'])assert.ok(html.includes(text));
  assert.doesNotMatch(html,/День обработан/);
});
test('one-off card renders actual training count and history without an invented block payment total',()=>{
  const detail={id:'CL-A',name:'Fixture',blockId:'',singlePrice:3500,completed:0,paid:0,debt:0,conditions:'',
    upcoming:[],trainingDates:[],clientPortal:{status:'unlinked',activeInvite:null},measurements:{active:[],auditCount:0},
    trainingHistory:[{id:'TR-1',date:'10.09.2026',type:'Фактически проведена',status:'Проведена',blockId:''},
      {id:'TR-2',date:'Дата не указана',type:'Списание без проведения',status:'Проведена',blockId:'BL-OLD'}]};
  const html=renderToStaticMarkup(React.createElement(LoadedClientCard,{detail,initData:'fixture',onBack(){}}));
  assert.match(html,/<strong>1<\/strong><span>проведено/);assert.match(html,/История тренировок/);
  assert.match(html,/Дата не указана/);assert.doesNotMatch(html,/История текущего блока|Оплачено/);
});
