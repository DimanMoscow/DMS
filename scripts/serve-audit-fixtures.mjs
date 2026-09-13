// Isolated static rendering of the actual components: no Telegram auth, API,
// production data or mutation handlers. Intended only for visual inspection.
import http from 'node:http';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {miniAppViews} from '../tests/helpers/miniapp-render.mjs';
const {TodayView}=miniAppViews();
const item={queueId:'Q-FIXTURE',time:'10:00',endTime:'11:00',dateLabel:'09.09.2026',
  client:'Тестовый клиент с очень длинным именем для проверки переноса текста',calendarTitle:'Тестовый клиент ПТ',blockId:'',matching:'Требует регистрации',
  decision:'',status:'Требует регистрации',processed:false,needsRegistration:true};
const data={today:{title:'14.09.2026',dateKey:'2026-09-14',waiting:[item]},
  registrationQueue:[{...item,queueId:'Q-OLDER',client:'Другой тестовый клиент'}]};
const body=renderToStaticMarkup(React.createElement(TodayView,{data,busyKey:'',onDecision(){},onOnboard(){},onConfirmDay(){}}));
const screen='<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style"><body><main class="app-shell">'+body+'</main></body></html>';
const index='<!doctype html><html lang="ru"><meta charset="utf-8"><body style="background:#151515;color:white;font:14px system-ui"><h1>Изолированные визуальные fixtures</h1><p>Реальные компоненты, вымышленные данные, кнопки не выполняют действий.</p><div style="display:flex;gap:20px">'+[320,390,428].map(w=>'<section><h2>'+w+' px</h2><iframe title="Mobile '+w+'" style="border:0;width:'+w+'px;height:900px" src="/screen"></iframe></section>').join('')+'</div></body></html>';
http.createServer((request,response)=>{response.setHeader('Cache-Control','no-store');
 if(request.url==='/style'){response.setHeader('Content-Type','text/css');response.end(fs.readFileSync('app/globals.css'));}
 else {response.setHeader('Content-Type','text/html; charset=utf-8');response.end(request.url==='/screen'?screen:index);}
}).listen(8765,'127.0.0.1',()=>console.log('Static audit fixtures available on loopback port 8765'));
