// Provider-specific defaults are estimates, never guaranteed subscription ratios.
export const providers = Object.freeze({
  codex: { name: 'Codex', windowWeeklyPoints: 16, resetAdapter: 'codex' },
  claudeAgent: { name: 'Claude Code', windowWeeklyPoints: 13, resetAdapter: 'claude' },
});
export const driverOf = account => account?.driver || account?.instances?.[0]?.driver || 'codex';
export const providerOf = account => providers[driverOf(account)];
export function extraQuotaBlock(account, policy, now = Date.now()) {
  for (const window of account.extraWindows || []) {
    if (!Number.isFinite(window.usedPercent) || window.usedPercent < 0 || window.usedPercent > 100 || !Number.isFinite(Date.parse(window.resetsAt)) || Date.parse(window.resetsAt) <= now)
      return { code: 'stale', reason: `${window.label}: a fresh quota reading is required.` };
    const reserve = window.kind === 'session' ? policy.sessionReserve : policy.weeklyReserve;
    if (100 - window.usedPercent <= reserve)
      return { code: 'reserve', reason: `${window.label}: reserve reached.` };
  }
  return null;
}
