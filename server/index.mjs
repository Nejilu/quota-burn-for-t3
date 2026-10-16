import { httpConfig } from './http-config.mjs';
import { overlappingWorkspace } from './platform.mjs';
import {spawn} from 'node:child_process';
import {dataKey} from './watchdog.mjs';
import { createServer } from 'node:http';
import { readFile,mkdir,open,unlink,stat } from 'node:fs/promises';
import { resolve,join,extname,sep } from 'node:path';
import { randomBytes,randomUUID } from 'node:crypto';
import { Store } from './store.mjs';
import { T3Adapter } from './t3.mjs';
import { Engine } from './engine.mjs';
import { settingsSchema } from './schema.mjs';
import { plan,isBusy } from './planner.mjs';
import { DATA,ROOT } from './paths.mjs';

const access=await httpConfig(),{port,origin}=access;
await mkdir(DATA,{recursive:true});
const lockPath=join(DATA,'service.lock'),nonce=randomUUID();
async function lock(){try{const f=await open(lockPath,'wx');await f.writeFile(JSON.stringify({pid:process.pid,nonce}));await f.close();}catch(e){if(e.code!=='EEXIST')throw e;const previous=JSON.parse(await readFile(lockPath,'utf8'));try{if(process.env.QP_WATCHDOG_MODE==='external'){const h=await fetch(`http://127.0.0.1:${port}/healthz`,{signal:AbortSignal.timeout(1000)}).then(r=>r.json()).catch(()=>null);if(h?.service!=='quota-burn'||h.dataKey!==dataKey(DATA)){const missing=Error();missing.code='ESRCH';throw missing;}}else process.kill(previous.pid,0);throw new Error('Quota Burn is already running for this database.');}catch(error){if(error.code!=='ESRCH')throw error;}await unlink(lockPath);return lock();}}
await lock();
const store=new Store(join(DATA,'quota-pilot.sqlite')),t3=new T3Adapter(),engine=new Engine(store,t3,{requireWatchdog:process.env.QP_WATCHDOG_ENABLED!=='0'});
const browserSession=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const json=(res,status,value,extra={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra});res.end(JSON.stringify(value));};
async function body(req){if(!req.headers['content-type']?.startsWith('application/json'))throw new Error('JSON body required.');let b='';for await(const chunk of req){b+=chunk;if(Buffer.byteLength(b)>1000000)throw new Error('Request body too large.');}return b?JSON.parse(b):{};}
const server=createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if(req.url==='/healthz'&&req.method==='GET'){json(res,200,{service:'quota-burn',version:'0.2.0',dataKey:dataKey(DATA),schedulerAt:lastTickAt?new Date(lastTickAt).toISOString():null});return;}
  if(!access.hosts.has(req.headers.host)){json(res,403,{error:'Host rejected.'});return;}
  if(!access.authorized(req.headers.authorization)){json(res,401,{error:'Authentication required.'},{'WWW-Authenticate':'Basic realm="Quota Burn", charset="UTF-8"'});return;}
  const requestOrigin=req.headers.origin;if(requestOrigin&&!access.origins.has(requestOrigin)){json(res,403,{error:'Origin rejected.'});return;}
  if(req.url.startsWith('/api/')&&req.headers['sec-fetch-site']==='cross-site'){json(res,403,{error:'Cross-site access rejected.'});return;}
  const url=new URL(req.url,origin),path=url.pathname;
  try{
    if(path==='/api/bootstrap'&&req.method==='GET'){json(res,200,{csrf},{'Set-Cookie':`qp_session=${browserSession}; HttpOnly; SameSite=Strict; Path=/${access.secure?'; Secure':''}`});return;}
    if(path.startsWith('/api/')){
      if(!req.headers.cookie?.split(';').some(c=>c.trim()===`qp_session=${browserSession}`)){json(res,401,{error:'Reload Quota Burn to open a local session.'});return;}
      if(req.method!=='GET'&&req.headers['x-qp-csrf']!==csrf){json(res,403,{error:'Invalid command session. Reload the page.'});return;}
      if(path==='/api/state'&&req.method==='GET'){json(res,200,engine.snapshot());return;}
      if(path==='/api/export'&&req.method==='GET'){json(res,200,{version:1,exportedAt:new Date().toISOString(),settings:{...store.settings(),mode:'observe'},policies:store.list('policies'),projects:store.list('projects').map(({bindings,recentOutputs,...p})=>p),campaigns:store.list('campaigns')},{'Content-Disposition':'attachment; filename="quota-burn-config.json"'});return;}
      const data=await body(req);
      const result=await engine.serial(async()=>{
        if(path==='/api/refresh'&&req.method==='POST'){await engine.refresh();await engine.tick();return {ok:true};}
        if(path==='/api/settings'&&req.method==='PUT'){const settings=settingsSchema.parse(data);store.put('settings',{id:'global',...settings});store.log('mode',`Mode: ${settings.mode}.`);await engine.tick();return{ok:true};}
        if(path==='/api/stop'&&req.method==='POST'){await engine.stopAll();return{ok:true};}
        if(path==='/api/projects'&&req.method==='POST')return engine.saveProject(data);
        let m=path.match(/^\/api\/projects\/([^/]+)(?:\/(pause|resume|run|stop))?$/);
        if(m){const id=m[1],action=m[2];if(req.method==='PUT'&&!action)return engine.saveProject(data,id);
          if(req.method==='DELETE'&&!action){if(engine.runs().some(r=>r.projectId===id&&['prepared','running','waiting-approval','waiting-input','interrupting','unknown'].includes(r.status)))throw new Error('Stop the current turn before deleting this goal.');store.remove('projects',id);return{ok:true};}
          if(req.method==='POST'&&['pause','resume'].includes(action)){await engine.projectAction(id,action);return{ok:true};}
          if(req.method==='POST'&&action==='stop'){await engine.projectAction(id,'pause');for(const r of engine.runs().filter(r=>r.projectId===id&&['running','waiting-approval','waiting-input'].includes(r.status))){const th=await t3.readThread(r.threadId);const ownLast=th.messages.filter(m=>m.role==='user').at(-1)?.id===r.messageId;if(isBusy(th)&&ownLast){await t3.interrupt(r.threadId,r.turnId);store.put('runs',{...r,status:'interrupting',stopReason:'Project stop requested.'});}}return{ok:true};}
          if(req.method==='POST'&&action==='run'){
            if(store.settings().mode==='paused')throw new Error('Leave global pause before starting a turn.');await engine.refresh();if(engine.runs().some(r=>['prepared','running','waiting-approval','waiting-input','interrupting','unknown'].includes(r.status)))throw new Error('A managed turn is already active.');const p=store.get('projects',id);if(!p)throw new Error('Goal not found.');const a=t3.accounts.find(a=>a.instances.some(i=>p.instanceIds.includes(i.id)));if(!a)throw new Error('Account not found.');const d=plan(a,{...engine.policy(a.id),enabled:true});if(['paused','auth','unknown','stale','reserve','session'].includes(d.code))throw new Error(d.reason);const shell=await t3.readShell();if(shell.threads.some(t=>isBusy(t)&&(t3.remote||a.instances.some(i=>i.id===t.modelSelection?.instanceId)||shell.projects.some(s=>s.id===t.projectId&&overlappingWorkspace(s.workspaceRoot,p.repositoryRoot)))))throw new Error('T3 is already working on this account or repository.');return engine.launch(p,a,null,{single:true});
          }
        }
        if(path==='/api/campaigns'&&req.method==='POST')return engine.saveCampaign(data);
        m=path.match(/^\/api\/campaigns\/([^/]+)(?:\/(pause|resume))?$/);
        if(m){const id=m[1];if(req.method==='PUT'&&!m[2])return engine.saveCampaign(data,id);if(req.method==='DELETE'&&!m[2]){engine.assertCampaignIdle(id);store.remove('campaigns',id);return{ok:true};}if(req.method==='POST'&&m[2]){const c=store.get('campaigns',id);if(!c)throw new Error('Campaign not found.');if(c.status==='completed'&&m[2]==='resume')throw new Error('Duplicate the completed campaign to start again with a new budget.');store.put('campaigns',{...c,status:m[2]==='pause'?'paused':'ready',enabled:m[2]==='resume'});return{ok:true};}}
        m=path.match(/^\/api\/accounts\/([^/]+)\/(policy|credits|reset)$/);
        if(m){if(m[2]==='policy'&&req.method==='PUT')return engine.setPolicy(m[1],data);if(m[2]==='credits'&&req.method==='POST')return engine.readCredits(m[1]);if(m[2]==='reset'&&req.method==='POST'){if(typeof data.creditId!=='string')throw new Error('Credit required.');return engine.consumeCredit(m[1],data.creditId,{intentId:data.intentId||null});}}
        m=path.match(/^\/api\/runs\/([^/]+)\/resolve$/);if(m&&req.method==='POST'){await engine.resolveRun(m[1]);return{ok:true};}
        if(path==='/api/t3-projects'&&req.method==='POST'){
          if(typeof data.title!=='string'||!data.title.trim()||typeof data.path!=='string')throw new Error('Name and folder required.');const root=await t3.validateFolder(data.path);const command={type:'project.create',commandId:randomUUID(),projectId:randomUUID(),title:data.title.trim().slice(0,100),workspaceRoot:root,createdAt:new Date().toISOString()};await t3.dispatch(command);await t3.readShell();return{ok:true};
        }
        throw new Error('Unknown route.');
      });json(res,200,result);return;
    }
    if(req.method!=='GET'){json(res,405,{error:'Method not allowed.'});return;}
    const dist=join(ROOT,'dist');let file=resolve(dist,'.'+decodeURIComponent(path));if(file!==dist&&!file.startsWith(dist+sep)){json(res,403,{error:'Path rejected.'});return;}try{if(!(await stat(file)).isFile())file=join(dist,'index.html');}catch{file=join(dist,'index.html');}const content=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':extname(file)==='.html'?'no-cache':'public, max-age=3600'});res.end(content);
  }catch(e){const message=e.issues?.map(i=>`${i.path.join('.')} : ${i.message}`).join(' · ')||e.message||'Unexpected error.';json(res,400,{error:message});}
});
let timer,guardTimer,lastTickAt=0,ticking=false,closing=false;
async function scheduledTick(){if(ticking||closing)return;ticking=true;try{await engine.serial(()=>engine.tick());lastTickAt=Date.now();}catch(e){store.log('scheduler',e.message,{},'error');}finally{ticking=false;}}
function ensureWatchdog(){if(!engine.requireWatchdog||process.env.QP_WATCHDOG_MODE==='external')return;const guard=store.get('watchdog','global');if(guard){try{process.kill(guard.pid,0);return;}catch{}}const child=spawn(process.execPath,[join(ROOT,'server','watchdog.mjs')],{cwd:ROOT,env:process.env,detached:true,windowsHide:true,stdio:'ignore'});child.on('error',()=>store.log('watchdog','Could not start the watchdog.',{},'error'));child.unref();}
async function shutdown(){if(closing)return;closing=true;clearInterval(timer);clearInterval(guardTimer);server.close();await engine.shutdown();store.close();try{const own=JSON.parse(await readFile(lockPath,'utf8'));if(own.nonce===nonce)await unlink(lockPath);}catch{}process.exit(0);}
server.on('error',async()=>{await shutdown();});
server.listen(port,access.host,()=>{console.log(`Quota Burn V2 : ${origin}`);ensureWatchdog();guardTimer=setInterval(ensureWatchdog,10000);scheduledTick();timer=setInterval(scheduledTick,2000);});
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
