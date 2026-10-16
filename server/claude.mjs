// Compatibility bridge for the Claude banked-reset response contract; no release pin.
// Quotas and inference stay in T3. Only credit reads and explicitly authorized
// redemption use this bridge, so Quota Burn can persist its own idempotency key.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
const origin = 'https://api.anthropic.com';
const grantId = /^[a-z0-9_-]{1,40}$/;
const requestId = /^[A-Za-z0-9_-]{1,64}$/;
const futureExpiry = (value,now) => {if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return false;const [year,month,day]=value.slice(0,10).split('-').map(Number);return month>=1&&month<=12&&day>=1&&day<=new Date(Date.UTC(year,month,0)).getUTCDate()&&Date.parse(value)>now;};
export function claudeCreditsView(response, now = Date.now()) {
  const block = response?.cedar_ember;
  if (!block || typeof block.eligible !== 'boolean') return { availableCount: null, credits: null };
  if (!block.eligible) return { availableCount: 0, credits: [] };
  const credits = (Array.isArray(block.grants) ? block.grants : []).filter(g =>
    g && typeof g.id==='string' && grantId.test(g.id) && Number.isInteger(g.resets_left) && g.resets_left > 0 &&
    !g.paused && g.usable_now === true && (g.ends_at == null || futureExpiry(g.ends_at,now))
  ).map(g => ({ id: g.id, status: 'available', expiresAt: g.ends_at || null,
    remainingCount: g.resets_left, title: 'Claude reset credit' }));
  // Match T3: a grant must be designated by the provider as redeemable now.
  if (!credits.some(g => g.id === block.next_grant_id)) return { availableCount: 0, credits: [] };
  return { availableCount: credits.reduce((sum, g) => sum + g.remainingCount, 0), credits };
}
export async function withClaude(instance, action, { request = fetch, read = readFile } = {}) {
  if (process.platform === 'darwin') throw Error('Claude reset credits require file-based credentials on this platform.');
  if (instance.resetAllowed === false) throw Error('Reset credits require a Claude subscription login.');
  let credentials;
  try { credentials = JSON.parse(await read(join(instance.home, '.credentials.json'), 'utf8')); }
  catch { throw Error('Sign in to Claude Code on this machine to read reset credits.'); }
  const token = credentials.claudeAiOauth?.accessToken;
  if (!token) throw Error('A Claude subscription login is required for reset credits.');
  const headers = { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20',
    'User-Agent': `claude-cli/${instance.version} (external, cli)`, 'Content-Type': 'application/json' };
  const call = async (path, body) => {
    let response;
    try { response = await request(origin + path, { method: body ? 'POST' : 'GET', headers,
      redirect: 'error', signal: AbortSignal.timeout(25000), ...(body ? { body: JSON.stringify(body) } : {}) }); }
    catch { throw Error('Claude credit request timed out or disconnected. Retry the same reset intent if one exists.'); }
    if (!response.ok) throw Error(`Claude credit request rejected (${response.status}).`);
    let value; try { value = await response.json(); } catch { throw Error('Claude returned an unreadable credit response.'); }
    return value;
  };
  return action({
    read: async () => claudeCreditsView(await call('/api/oauth/usage?cedar_ember=1&skip_spend=1')),
    consume: async (creditId, idempotencyKey) => {
      if (typeof creditId!=='string' || typeof idempotencyKey!=='string' || !grantId.test(creditId) || !requestId.test(idempotencyKey)) throw Error('Invalid Claude reset identifiers.');
      let config; try { config = JSON.parse(await read(instance.accountConfigPath, 'utf8')); }
      catch { throw Error('Claude account metadata is unavailable. Sign in again.'); }
      const organization = config.oauthAccount?.organizationUuid;
      if (!organization) throw Error('Claude organization is unavailable. Sign in again.');
      const response = await call(`/api/organizations/${encodeURIComponent(organization)}/reset_rate_limits`,
        { program: 'cedar_ember', grant_id: creditId, request_id: idempotencyKey });
      const outcomes = { reset: 'reset', already_used: 'alreadyRedeemed', not_limited: 'nothingToReset', ineligible: 'noCredit' };
      if (!Object.hasOwn(outcomes, response.result)) throw Error('Claude reset result is uncertain. Retry the same intent.');
      return { outcome: outcomes[response.result] };
    },
  });
}
