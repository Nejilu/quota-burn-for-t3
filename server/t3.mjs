import { negotiateT3,normalizeV2ShellThread,normalizeV2Projection } from './t3-compat.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile,realpath } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash,randomUUID } from 'node:crypto';
import { T3_ORIGIN,T3_HOME,T3_BINARY,ROOT } from './paths.mjs';
import { providers } from './providers.mjs';
const execute=promisify(execFile);
const hash=s=>createHash('sha256').update(s).digest('hex').slice(0,20);

export class T3Adapter {
  constructor({origin=T3_ORIGIN,home=T3_HOME,binary=T3_BINARY}={}){this.origin=origin;this.home=home;this.binary=binary;this.session=null;this.rawConfig=null;this.shell=null;this.accounts=[];this.compatibility=null;this.descriptor=null;}
  async cli(args){try{return (await execute(this.binary,args,{cwd:ROOT,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:4e6})).stdout;}catch{throw new Error('Local T3 command unavailable. Make sure T3 is running.');}}
  async token(){if(this.session&&this.expires>Date.now())return this.session.token;const previous=this.session;this.session=JSON.parse(await this.cli(['auth','session','issue','--base-dir',this.home,'--ttl','10m','--label','Quota Burn local backend','--json']));this.expires=Date.now()+8*60000;if(previous)await this.cli(['auth','session','revoke',previous.sessionId,'--base-dir',this.home]).catch(()=>{});return this.session.token;}
  async http(path,body,anonymous=false){const r=await fetch(this.origin+path,{method:body===undefined?'GET':'POST',redirect:'error',headers:{'Content-Type':'application/json','x-t3-orchestration-protocol':String(this.compatibility?.protocol||2),...(!anonymous?{Authorization:`Bearer ${await this.token()}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});if(!r.ok){const error=new Error(`T3: request rejected (${r.status}).`);error.status=r.status;if(r.status===401)this.expires=0;throw error;}return r.json();}
  async rpc(tag,payload={}){const{ticket}=await this.http('/api/auth/websocket-ticket',{});const url=new URL('/ws',this.origin);url.protocol=url.protocol==='https:'?'wss:':'ws:';url.searchParams.set('wsTicket',ticket);url.searchParams.set('orchestrationProtocol',String(this.compatibility?.protocol||2));return new Promise((resolveResult,reject)=>{const ws=new WebSocket(url);let done=false;const finish=(v,e)=>{if(done)return;done=true;clearTimeout(timer);ws.close();e?reject(new Error(e)):resolveResult(v);};const timer=setTimeout(()=>finish(null,`T3: request timed out (${tag}).`),30000);ws.onopen=()=>ws.send(JSON.stringify({_tag:'Request',id:'1',tag,payload,headers:[]}));ws.onmessage=e=>{try{const f=JSON.parse(e.data);for(const frame of Array.isArray(f)?f:[f]){if(frame._tag==='Ping')ws.send(JSON.stringify({_tag:'Pong'}));if(frame._tag==='Exit'&&frame.requestId==='1')finish(frame.exit.value,frame.exit._tag==='Success'?null:`T3: operation rejected (${tag}).`);}}catch{finish(null,'T3: unreadable response.');}};ws.onerror=()=>finish(null,'T3: connection interrupted.');ws.onclose=()=>finish(null,'T3: connection closed.');});}
  async connect(refresh=true){const descriptor=await this.http('/.well-known/t3/environment',undefined,true);this.compatibility=negotiateT3(descriptor);this.descriptor=descriptor;let config=await this.rpc('server.getConfig');if(!Array.isArray(config?.providers)||!config.settings?.providerInstances)throw new Error('T3 provider catalog is incompatible.');if(refresh){for(const p of config.providers.filter(p=>providers[p.driver]&&p.enabled&&p.installed))await this.rpc('server.refreshProviders',{instanceId:p.instanceId,refreshModels:false});config=await this.rpc('server.getConfig');}this.rawConfig=config;await this.readShell();this.accounts=await this.normalize(config);return{descriptor,accounts:this.accounts,shell:this.shell};}
  async normalize(config) {
    const groups = new Map();
    for (const p of config.providers.filter(p => providers[p.driver] && p.enabled)) {
      const envelope = config.settings.providerInstances[p.instanceId] || {};
      const cfg = envelope.config || {};
      const environment = Object.fromEntries((envelope.environment || []).map(e => [e.name,e.value]));
      const explicit = p.driver === 'codex' ? cfg.shadowHomePath || cfg.homePath : cfg.homePath;
      const inherited = p.driver === 'codex' ? environment.CODEX_HOME || process.env.CODEX_HOME : environment.CLAUDE_CONFIG_DIR || process.env.CLAUDE_CONFIG_DIR;
      const chosen = explicit?.trim() || inherited || join(homedir(),p.driver === 'codex' ? '.codex' : '.claude');
      const home = resolve(chosen.startsWith('~') ? join(homedir(),chosen.slice(2)) : chosen);
      const accountConfigPath = p.driver === 'claudeAgent' ? explicit?.trim() || inherited ? join(home,'.claude.json') : join(homedir(),'.claude.json') : null;
      let identity = p.auth?.profileId || p.usageLimits?.credentialFingerprint || null;
      if (p.driver === 'codex') {
        try { const auth = JSON.parse(await readFile(join(home,'auth.json'),'utf8')); identity = auth.tokens?.account_id || auth.account_id || identity; } catch {}
        identity ||= p.auth?.email || await realpath(join(home,'auth.json')).catch(() => join(home,'auth.json'));
      } else {
        try { const account = JSON.parse(await readFile(accountConfigPath,'utf8')).oauthAccount;
          if (account?.organizationUuid && (account.accountUuid || account.emailAddress)) identity = account.organizationUuid + ':' + (account.accountUuid || account.emailAddress);
        } catch {}
        identity = 'claudeAgent:' + (identity || await realpath(home).catch(() => home));
      }
      const key = hash(String(identity));
      const windows = p.usageLimits?.windows || [];
      const session = windows.find(w => ['five_hour','primary'].includes(w.id) && w.kind === 'session') || windows.find(w => w.kind === 'session') || null;
      const weekly = windows.find(w => ['seven_day','secondary'].includes(w.id) && w.kind === 'weekly') || (windows.filter(w => w.kind === 'weekly').length === 1 ? windows.find(w => w.kind === 'weekly') : null) || null;
      const extraWindows = windows.filter(w => w !== session && w !== weekly);
      const resetAllowed = p.auth?.status === 'authenticated' && !p.usageLimits?.unavailable &&
        !['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX'].some(k => environment[k]);
      const instance = { id:p.instanceId,driver:p.driver,name:p.displayName || p.instanceId,
        models:(p.models || []).map(m => ({id:m.slug,name:m.name,options:m.capabilities?.optionDescriptors || []})),
        home,binary:cfg.binaryPath || null,accountConfigPath,version:p.version,resetAllowed,installed:p.installed,nativeGoals:this.compatibility?.nativeGoals===true&&(p.slashCommands||[]).some(c=>c.name==='goal') };
      const limits = {checkedAt:p.usageLimits?.checkedAt || p.checkedAt,session,weekly,extraWindows,
        resetCredits:p.usageLimits?.resetCredits || null,unavailable:p.usageLimits?.unavailable?.reason || null};
      const existing = groups.get(key);
      if (existing) {
        existing.instances.push(instance);
        if (p.auth?.status === 'authenticated') existing.authStatus = 'authenticated';
        if (Date.parse(limits.checkedAt) > Date.parse(existing.checkedAt)) Object.assign(existing,limits);
        continue;
      }
      groups.set(key,{id:key,driver:p.driver,providerName:providers[p.driver].name,
        name:p.displayName || p.auth?.label || p.instanceId,label:p.auth?.email || p.auth?.label || providers[p.driver].name + ' account',
        authStatus:p.auth?.status,installed:p.installed,instances:[instance],...limits,
        capabilities:{quotaWindows:true,resetCredits:p.driver === 'codex' || process.platform !== 'darwin' && resetAllowed,detailedCredits:true},
        defaultWindowWeeklyPoints:providers[p.driver].windowWeeklyPoints});
    }
    return [...groups.values()];
  }
  publicAccounts(){return this.accounts.map(a=>({...a,instances:a.instances.map(({home,binary,accountConfigPath,resetAllowed,...p})=>p)}));}
  async readThread(id){const result=await this.http('/api/orchestration/threads/'+encodeURIComponent(id));return this.compatibility?.protocol===2?normalizeV2Projection(result.projection):result.thread;}
  async readShell(){const result=await this.http('/api/orchestration/shell');if(!Array.isArray(result?.threads)||!Array.isArray(result.projects))throw new Error('T3 shell is incompatible.');return this.shell=this.compatibility?.protocol===2?{...result,threads:result.threads.map(normalizeV2ShellThread)}:result;}
  async dispatch(command){
    if(this.compatibility?.protocol!==2)return this.http('/api/orchestration/dispatch',command);
    if(command.type==='project.create')return this.rpc('projects.mutate',command);
    if(command.type==='thread.turn.start')return this.rpc('orchestration.dispatchCommand',{type:'message.dispatch',createdBy:'user',creationSource:'web',commandId:command.commandId,threadId:command.threadId,messageId:command.message.messageId,text:command.message.text,attachments:[],modelSelection:command.modelSelection,dispatchMode:{type:'start_immediately'}});
    return this.rpc('orchestration.dispatchCommand',['thread.create','message.dispatch'].includes(command.type)?{createdBy:'user',creationSource:'web',...command}:command);
  }
  async protectProject(projectId){
    if(this.compatibility?.protocol!==2)return;
    const {settings}=await this.rpc('server.getConfig');
    if(settings.autoResumeLimitedThreads)throw new Error('Turn off automatic usage-limit recovery in T3 before running managed goals. Quota Burn must control quota recovery.');
    const previous=settings.projectSettingsOverrides?.[projectId]||{};
    if(previous.continueThreadsAfterServerUpdate!==false)await this.rpc('server.updateSettings',{patch:{projectSettingsOverrides:{[projectId]:{...previous,continueThreadsAfterServerUpdate:false}}}});
  }
  async interrupt(threadId,turnId,{commandId=randomUUID()}={}){
    if(this.compatibility?.protocol===2){const thread=await this.readThread(threadId);if(turnId&&thread.activeRunId&&thread.activeRunId!==turnId)throw new Error('T3 run ownership changed; stop refused.');const runId=turnId||thread.activeRunId||thread.latestRunId;if(!runId)throw new Error('No native run to stop.');return this.dispatch({type:'run.interrupt',commandId,threadId,runId,holdQueue:true,reason:'Quota Burn stop'});}
    return this.dispatch({type:'thread.turn.interrupt',commandId:randomUUID(),threadId,...(turnId?{turnId}:{}),createdAt:new Date().toISOString()});
  }
  async close(){if(this.session){const s=this.session;this.session=null;await this.cli(['auth','session','revoke',s.sessionId,'--base-dir',this.home]).catch(()=>{});}}
}
