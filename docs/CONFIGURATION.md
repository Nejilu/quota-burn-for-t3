# Configuration

## Accounts and connection

Quota Burn discovers enabled provider instances through T3, locally or remotely. Instances with
the same account identity are grouped within their provider. Codex and Claude
budgets remain separate. Other clients using the same subscription consume the
same quota, including clients on another machine.

Quota-driven work requires authenticated accounts with fresh **session and weekly**
windows. Missing or unsupported windows block starts. A provider being visible in
T3 does not establish that its subscription quotas are available.

Models, effort options and permissions come from T3's provider catalog. Save
separate goals for different providers. Only one goal is selected globally; there
is no priority queue or fallback to another saved goal when it finishes.

### Claude Code (experimental)

1. Enable the default Claude instance in T3. If T3 cannot locate Claude, configure
   its binary path to the local `node_modules/@anthropic-ai/claude-code-win32-x64/claude.exe`.
2. Run **Connect-Claude.cmd** and complete subscription sign-in in your browser.
   The launcher uses the default `claudeAgent` instance's configuration directory.
3. Refresh Quota Burn and verify both windows before enabling automation.

For custom instances, authenticate using the same CLI binary and configuration
directory as that instance. The launcher handles only the default instance.
Check for an inherited `ANTHROPIC_API_KEY`: Claude can use API billing instead of
your subscription when that variable is present. See
[Anthropic's subscription setup](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan).

Additional Claude quota windows reported by T3 are enforced conservatively,
including model-specific weekly limits even when another model is selected.
This may delay work unnecessarily. Real Claude turns and credit redemptions
have not been validated; see [Validation](../VALIDATION.md).

## Automatic decision loop

Quota windows come from the provider. Quota Burn does not start, reset or extend
the five-hour window itself.

The scheduler checks managed work every two seconds and refreshes provider quotas
every 60 seconds by default (configurable from 30 to 600). For each decision:

1. Check global mode, account policy, the selected goal, T3 occupancy and quota
   validity. Observation computes decisions without dispatching automatic work.
2. Subtract the weekly reserve from the remaining weekly quota. If a campaign has
   a cumulative cap, also restrict the budget to its unspent portion.
3. Project capacity from the current session through the relevant deadline
   (weekly reset, or an earlier campaign deadline). Use the current session's
   remaining quota and stop each projected window at that deadline.
4. Limit every projected session by its reserve and available time. Convert time
   to weekly points using `weekly points per window / time to use one full window`.
   A final 15-minute session is therefore not counted as a whole window.
5. Find the latest start that leaves enough projected capacity to spend the
   budget. Subtract **Start ahead of deadline** from that start. If capacity is
   already insufficient, start as soon as the other checks allow.
6. While work runs, monitor reserves, campaign limits, goal state and freshness.
   At the session reserve, request Stop and wait for fresh quota after reset.
   At the weekly reserve, stop until the next eligible budget or reset.

Future session boundaries are projections based on the reported session duration;
actual counters and resets remain authoritative. The calculation is repeated
using new readings. It does not learn a usage rate automatically.

**Time to use one full window** estimates consumption speed. **Start ahead of
deadline** adds scheduling margin; it is not an execution time limit. Both default
to 60 minutes. The 16/13 weekly-point defaults are initial estimates to calibrate
per account, not fixed subscription ratios.

New starts require readings less than three minutes old. Running work is stopped
after five minutes without fresh quota data; explicit provider unavailability or
invalid windows can stop it sooner. Quota reporting and Stop latency mean reserves
are monitored targets, not exact spending guarantees.

## Goals, Stop and resume

On supported T3 protocol 2 providers, the saved text is sent as `/goal <text>`.
No generic instruction or continuation paragraph is appended. Native providers
continue their own phases; Quota Burn does not send a prompt after every phase.

To stop managed work, the adapter sends T3 **`run.interrupt` with `holdQueue: true`**
for the owned run. Pausing goal metadata alone is insufficient. Codex resumes
through T3's native `/goal resume` handling; Claude currently uses a minimal
`Continue.` follow-up in the same goal conversation.

Activating a different goal pauses the previous selection and requests Stop before
replacement work starts. Completion or a block does not select another goal.
A human message in a managed conversation hands control back and pauses its goal;
activate it again to allow scheduling. Manual work on the same account or repository
takes priority. Unknown submissions are reconciled with T3 before retrying.

Optional goal limits default to unlimited. A duration limit applies to each native
root turn, not the entire goal. Child agents are excluded from the root-turn count.
Limits are monitored and may be overshot between checks. The internal retry backoff
is unrelated to the provider's five-hour window.

T3's global **`autoResumeLimitedThreads` must be off**. Before managed work starts,
Quota Burn also sets **`continueThreadsAfterServerUpdate: false` on the selected T3
project**. This affects restart recovery for manual chats in that project too.
Other projects and the global restart preference are preserved.

## Campaigns and reset credits

Campaign reserves override account reserves while the campaign applies. Immediate
mode has no dates. Scheduled mode accepts blank start/end dates. Before-reset mode
requires its chosen deadline. A campaign ends at the weekly reset unless continuation
after reset is explicitly enabled.

The **cumulative cap** is measured in weekly quota percentage points. Blank means
no cap. It counts observed account usage while the campaign runs, including work
from other clients, and does not reset when the provider quota resets. Duplicate
a completed campaign to start with a new campaign budget.

Reset credits are opt-in: either a confirmed manual action in Active mode, or an
explicit campaign rule. Rules can specify a time or approaching expiration,
remaining-quota threshold, maximum credits to use and credits to keep.
No reset is redeemed as an installation side effect.

If a reset outcome is unknown, retry **the same operation** from the activity log;
the persisted request ID is reused. Do not create a second redemption intent.
Claude's credit bridge relies on version-dependent endpoints rather than a stable
public API. Neither provider's real redemption path has been validated end to end.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| T3 asks for a pairing token | Run `Start-T3.cmd` or `npm.cmd run t3:open` for a fresh pairing link. |
| Account visible, no automatic work | Verify login, both quota windows, freshness, global mode, account policy and an active goal. Read the decision log. |
| Codex Pro has only weekly quota | Current scheduler cannot handle this account shape. |
| Goal waits for approval | Open its conversation in T3 and respond there. |
| Work does not resume after reset | Refresh quotas; check T3 occupancy, account reserve and the selected goal. |
| Port already in use | Use the existing instance or free the port; do not run two checkouts against the same data. |
| Need a connection diagnostic | `npm.cmd run t3:check` reads the API and may register this checkout as a T3 project. It performs no inference or reset. |

Private diagnostics are in `.runtime/*.log`. Review and redact logs before sharing
them; they can contain paths, conversation content or account information.

For native Linux, separate T3 servers and password-protected hosted access, see
[Windows, Linux and containers](PORTABILITY.md). Remote mode disables local reset
bridges unless provider access is explicitly configured.
