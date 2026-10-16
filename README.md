# Quota Burn for T3

A companion to [T3 Code](https://github.com/pingdotgg/t3code) that schedules
goals around subscription quota resets. Save goals, select one, and let the
scheduler decide when to run it. Campaigns can override the automatic schedule.

The interface is in English, with dark and light themes. The application uses
React, Node.js and SQLite. Native Windows/Linux launchers and a Linux Docker
deployment are included. Use T3 on the same machine or connect to a separate
T3 server. See [Linux and containers](docs/PORTABILITY.md) for installation.

## Provider support

| Account | Status |
| --- | --- |
| Codex with ChatGPT Plus | Primary target; local connection and native goal tested. |
| Codex with ChatGPT Pro | Not supported when only the weekly quota is reported. The scheduler currently requires both session and weekly windows. |
| Claude Code with Claude Pro / Max | Experimental. Quota mapping and scheduling have simulated tests; real execution and reset credits have not been validated end to end. Expect bugs. |
| API keys and other usage-based accounts | Not supported as subscription budgets. No paid-usage fallback. |

As of **16 October 2026**, OpenAI lists no five-hour limit for Codex Pro;
Claude Pro/Max has session and weekly limits. Plan rules can change: check the
actual windows reported by T3 and the official
[Codex pricing](https://developers.openai.com/codex/pricing/) and
[Claude subscription documentation](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan).

The defaults of **16 weekly points per Codex window** and **13 per Claude window**
are adjustable estimates, not provider guarantees. There is no verified universal
13% ratio for Claude.

## Install on Windows

Requirements: Windows x64/arm64, Git, Node.js **22.14+**, and a supported subscription.
T3, Codex CLI and Claude Code are installed as local dependencies; global CLI
installations are left alone.

```powershell
git clone https://github.com/Nejilu/quota-burn-for-t3.git
cd quota-burn-for-t3
npm.cmd ci
npm.cmd run build
```

Double-click **Start-Quota-Burn.cmd**. It starts local T3 if needed, starts
Quota Burn in the background and opens **http://127.0.0.1:4317**.
T3 is at **http://127.0.0.1:3773**.

A fresh installation starts in **Observation mode**: it reads quotas and computes
decisions without automatically starting goals or using reset credits.

## Install on Linux

Use a current Debian/Ubuntu environment (x64 or arm64), Node.js 22.14+ and Git.
The launcher selects the matching bundled T3/Codex binaries.

```sh
git clone https://github.com/Nejilu/quota-burn-for-t3.git
cd quota-burn-for-t3
npm ci
npm run build
npm exec -- codex login
npm run t3:start
npm run burn:start
```

Open `http://127.0.0.1:4317`. `npm run t3:open` prints a one-time local T3 pairing
link; on a headless server, use an SSH tunnel to the same loopback ports. Stop with
`npm run burn:stop` and, separately, `npm run t3:stop`.

## Docker / separate T3 server

The included Compose deployment runs Quota Burn and its independent watchdog,
with persistent SQLite storage. It connects to an existing T3 server using a
private credential file; no T3 database or project volume is required.

See [container setup](docs/PORTABILITY.md#docker-compose) for credentials,
networking and hosted access. Quota reads, campaigns and goals use T3 remotely.
Reset-credit operations additionally require configured local access to provider
credentials/binaries; they are disabled in the default remote-only image.

## Connect and configure

1. Sign in to Codex with your ChatGPT account. Existing authentication in your
   Codex home is reused; otherwise run `npm.cmd exec -- codex login`.
2. Open T3 with **Start-T3.cmd**, which generates a one-time browser pairing link.
   Opening port 3773 directly may show a pairing-token form. Pairing the browser
   and signing in to a provider are separate operations.
3. In T3, turn off automatic usage-limit recovery (`autoResumeLimitedThreads`).
   Quota Burn needs to control when managed work resumes.
4. In Quota Burn, refresh **Accounts & quotas**. Verify both quota windows and
   adjust the account policy to match your observed usage.
5. In **Goals**, add a T3 folder, save a goal with its account, model, effort and
   permissions, then **Activate** it. Only one saved goal can be active.
6. Review the forecast, then **Enable automation** when ready.

Approvals and model output remain in T3. Default permissions require approval.
Claude setup and troubleshooting are in [Configuration](docs/CONFIGURATION.md).

## Scheduling

| Mode | Behavior |
| --- | --- |
| Automatic | Estimates when work must begin to spend the usable weekly quota before reset. |
| Immediate campaign | Runs now until its reserve, optional cap, or reset is reached. |
| Scheduled campaign | Runs within optional start/end dates. Blank start means now; blank end means no end date. |
| Before planned reset | Uses a chosen deadline, for example before a manual reset credit expires. Applying the credit remains a separate opt-in rule. |
| Test one turn | Explicitly confirmed diagnostic in a separate conversation; consumes real quota. |

Account defaults:

| Setting | Default |
| --- | --- |
| Weekly quota to keep | 10% remaining |
| Session quota to keep | 5% remaining |
| Time to use one full window | 60 minutes |
| Start ahead of deadline | 60 minutes |
| Quota refresh | 60 seconds |
| Goal turn/duration limits | Unlimited |
| Campaign cumulative cap | Unlimited when blank |
| Automatic reset credit use | Off |

The scheduler accounts for partially used sessions and the usable portion of the
last session before the weekly reset. Forecasts depend on your usage estimates;
they are not a guarantee of exhausting a quota. Thresholds can be overshot between
quota refreshes and acknowledgement of Stop.

See [Configuration](docs/CONFIGURATION.md) for the decision loop, pause/resume
behavior, campaign caps and reset rules.

## Stop and restart

Closing the browser leaves the services running. Keep the PC awake; no Windows
startup task is installed.

- **Stop-Quota-Burn.cmd** pauses automation, requests Stop for managed work and
  stops Quota Burn. T3 stays available. Automation remains paused on restart.
- **Stop-T3.cmd** stops T3 and its agents, including manual work. Finish that work
  before using it.

Native local data lives in `.runtime/` and is excluded from Git. Native defaults
accept loopback access only. Hosted access requires a password file and an
explicit public origin; use HTTPS through your reverse proxy. See
[Linux and containers](docs/PORTABILITY.md).

## Development and validation

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

The lockfile currently records T3 **0.1.0**, Codex CLI **0.162.1**, and Claude Code
**2.1.301**. Compatibility is checked by protocol and capabilities, without an
exact-version allowlist. Breaking upstream API changes can still require updates.

- [Development, local data and backups](docs/DEVELOPMENT.md)
- [Validation status and untested paths](VALIDATION.md)

MIT licensed. Independent project; not affiliated with T3 Code, OpenAI or Anthropic.
