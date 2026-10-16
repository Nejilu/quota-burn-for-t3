const providerName = account => account.providerName || (account.driver === 'claudeAgent' ? 'Claude Code' : 'Codex');

function baseLabel(account) {
  const provider = providerName(account);
  const name = account.name?.trim() || provider;
  const identity = account.label?.trim();
  return identity && ![name, provider, `${provider} account`].includes(identity)
    ? `${name} · ${identity}` : name;
}

export function primaryInstance(account) {
  return account?.instances?.find(i => i.installed !== false && i.id === account.driver)
    || account?.instances?.find(i => i.installed !== false) || null;
}

export function accountLabel(account, accounts = []) {
  if (!account) return 'Account';
  const label = baseLabel(account);
  const generic = [providerName(account), account.driver, 'Claude'].includes(label);
  const duplicate = accounts.some(other => other.id !== account.id && baseLabel(other) === label);
  if (!generic && !duplicate) return label;
  const profile = primaryInstance(account)?.id || account.instances?.[0]?.id || account.id;
  return profile ? `${label} · ${profile}` : label;
}
