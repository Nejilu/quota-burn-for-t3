// Release numbers are informational. Wire contracts determine compatibility.
export function negotiateT3(descriptor) {
  const protocol = descriptor?.orchestrationProtocolVersion;
  if (![1, 2].includes(protocol)) throw new Error(`T3 protocol ${protocol ?? 'unknown'} is unsupported. Quota Burn is stopped; no work was submitted.`);
  return { protocol, serverVersion: descriptor.serverVersion || 'unknown', nativeGoals: protocol === 2 };
}

const running = new Set(['queued','preparing','starting','running','waiting']);
const terminal = new Set(['idle','completed','interrupted','failed','cancelled','limited','rolled_back']);
export function normalizeV2ShellThread(t) {
  if (!t?.id || !t.modelSelection?.instanceId || typeof t.status !== 'string') throw new Error('T3 returned an incompatible thread summary.');
  const busy = running.has(t.status) || !!t.activeRunId || !terminal.has(t.status);
  return {...t, wireProtocol:2, hasPendingApprovals:!!t.pendingRuntimeRequest&&!['question','user_input'].includes(t.pendingRuntimeRequest.kind),hasPendingUserInput:['question','user_input'].includes(t.pendingRuntimeRequest?.kind),
    session:{status:busy?'running':'ready',activeTurnId:t.activeRunId,lastError:t.lastError},
    latestTurn:t.latestRunId?{turnId:t.latestRunId,state:busy?'running':t.status==='failed'?'error':t.status}:null};
}

export function normalizeV2Projection(p) {
  if (!p?.thread?.id || !Array.isArray(p.runs) || !Array.isArray(p.messages) || !Array.isArray(p.providerThreads) || !Array.isArray(p.providerTurns)) throw new Error('T3 returned an incompatible conversation snapshot.');
  const latest = [...p.runs].sort((a,b)=>b.ordinal-a.ordinal)[0];
  const provider = p.providerThreads.find(t=>t.id===p.thread.activeProviderThreadId);
  const active = p.runs.find(r=>running.has(r.status));
  const pending = (p.runtimeRequests||[]).filter(r=>r.status==='pending');
  const base=normalizeV2ShellThread({...p.thread,status:active?.status||latest?.status||'idle',activeRunId:active?.id||null,latestRunId:latest?.id||null,
    pendingRuntimeRequest:pending[0]||null,goal:provider?.goal||null});
  return {...base,messages:p.messages.map(m=>({...m,turnId:m.runId,nativeTurnId:m.nativeTurnId||(p.turnItems||[]).find(i=>i.messageId===m.id)?.providerTurnId})),runs:p.runs,providerTurns:p.providerTurns,nodes:p.nodes||[],activities:[],
    runtimeRequests:pending,providerThreads:p.providerThreads,goal:provider?.goal||null,session:{...base.session,lastError:p.runs.find(r=>r.id===latest?.id)?.error||null}};
}
