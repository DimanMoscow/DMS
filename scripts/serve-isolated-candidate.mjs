// Loopback-only test backend. Auth and business readers are the real candidate.
import http from 'node:http';
import {isolatedCandidateBackend} from '../tests/helpers/isolated-candidate-backend.mjs';
const f=isolatedCandidateBackend(process.env.DMS_FIXTURE_CANDIDATE||'v57');
const json=(res,body)=>{res.writeHead(body.status||200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
http.createServer(async(req,res)=>{
  try {
    if(req.url==='/fixture-evidence')return json(res,{calls:f.calls,writes:f.book.writes.length,
      phaseTimings:f.logs.filter(x=>String(x).includes('dms_health_phase')).map(x=>JSON.parse(x))});
    if(req.url==='/fixture-launch')return json(res,{url:'http://127.0.0.1:3017/#'+new URLSearchParams({
      tgWebAppData:f.signedInitData(),tgWebAppVersion:'8.0',tgWebAppPlatform:'tdesktop'})});
    if(req.method==='GET')return json(res,f.get());
    let body='';for await(const part of req){body+=part;if(body.length>20000)throw new Error('Fixture request too large');}
    return json(res,f.post(JSON.parse(body)));
  }catch(error){console.error(error.stack);json(res,{ok:false,status:500,error:'fixture_backend_failure'});}
}).listen(18857,'127.0.0.1',()=>console.log('Isolated candidate backend on loopback 18857; all mutations rejected'));
