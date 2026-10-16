# Development

## Local commands

Use Node.js 22.14+, Git and `npm.cmd` on Windows (`npm` on Linux). CI runs
installation, type checking, simulated tests, frontend build and disposable native
T3 startup on Windows and Ubuntu, plus container integration on Linux. See
[Linux and containers](PORTABILITY.md).

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run t3:start
npm.cmd run burn:start
npm.cmd run burn:status
```

The backend serves the built frontend on `127.0.0.1:4317`; T3 uses port 3773.
Rebuild and reload after frontend changes. For backend changes, run
`npm.cmd run burn:stop` then `npm.cmd run burn:start`. `npm.cmd start` runs the
backend in the foreground. Linux launchers use the same npm commands.
The local T3 launcher uses port 3773; the backend accepts `QP_PORT`.

Tests use simulated inference/reset adapters and an isolated HTTP service. Never
run real model or reset tests without authorization for that specific operation.

## Code layout

| Module | Responsibility |
| --- | --- |
| `server/planner.mjs` | Quota capacity and start-time calculations |
| `server/engine.mjs` | Policies, campaigns and scheduling |
| `server/native-engine.mjs` | Native goal ownership, monitoring, Stop and resume |
| `server/t3.mjs`, `server/t3-compat.mjs` | T3 connection, protocol negotiation and normalization |
| `server/providers.mjs` | Provider defaults and extra quota windows |
| `server/codex.mjs`, `server/claude.mjs` | Quota/reset integrations |
| `server/store.mjs` | SQLite persistence |
| `server/index.mjs` | Local HTTP API and frontend serving |
| `server/watchdog.mjs` | Independent supervision of native work |
| `server/platform.mjs`, `server/http-config.mjs` | Platform paths, hosted authentication and origin policy |
| `src/main.tsx`, `src/*.css` | React UI and themes |
| `scripts/` | Windows/Linux process management, pairing, credentials and smoke checks |

The supervisor checks every five seconds. If scheduling or managed observations
are stale for over 45 seconds, it requests Stop for verified owned runs. The main
worker also checks watchdog availability. Stop intents are persisted and retried;
unreachable T3 or changed ownership can delay or prevent acknowledgement.
`QP_WATCHDOG_ENABLED=0` is reserved for isolated simulated tests.

## Data and backups

| Location | Contents |
| --- | --- |
| `.runtime/pilot/` | Quota Burn SQLite database and locks |
| `.runtime/t3/` | Local T3 configuration and conversations |
| `.runtime/*.log` | Private service logs |
| Codex home (`CODEX_HOME` or the user's `.codex`) | Existing Codex authentication |
| Claude instance home | Existing Claude configuration and authentication |

The internal `pilot` directory and `quota-pilot.sqlite` filename are retained for
existing installations. Renaming the application does not create a new database.
Existing browser theme preferences are also retained. No credentials are copied
into the repository.

For a consistent backup, stop Quota Burn, then copy `.runtime/pilot/` including any
SQLite `-wal` and `-shm` files. Stop T3 separately before backing up its state.
Restore only while stopped; start in Observation mode and check conversations
before enabling automation. Configuration export is private, has no import UI
and is not a conversation/history backup.

Never commit runtime data, provider homes, tokens or unredacted diagnostics.
Loopback remains the default. Hosted mode adds password authentication and an
explicit origin; see [deployment configuration](PORTABILITY.md). The Compose
deployment keeps the watchdog in a separate container from the worker.

## Configuration overrides

Backend overrides: `QP_DATA_DIR`, `QP_T3_HOME`, `QP_T3_ORIGIN`, `QP_T3_PUBLIC_ORIGIN`,
`QP_T3_BINARY`, `QP_CODEX_BINARY`, `QP_CLAUDE_BINARY`, `QP_PORT`, `QP_HOST`,
`QP_PUBLIC_ORIGIN`, `QP_ACCESS_PASSWORD_FILE`, `QP_ACCESS_USER`, `QP_T3_TOKEN_FILE`,
`QP_PROVIDER_ACCESS`, `QP_WATCHDOG_MODE` and `QP_WATCHDOG_ORIGIN`.
See `server/paths.mjs`, `server/http-config.mjs` and the deployment guide.

`smoke:local` requires a disposable CI checkout. `scripts/smoke-container.mjs`
creates isolated Docker resources, tests a real unauthenticated T3 server and
removes its own containers/volumes. Neither uses subscription credentials,
starts a model turn or redeems a reset. Container tests also check password
enforcement, remote folders, persistence and watchdog survival after worker loss.

## Dependencies and updates

Use `npm.cmd ci` for the versions recorded in `package-lock.json`. The current
validated combination is T3 0.1.0, Codex CLI 0.162.1 and Claude Code 2.1.301.
The T3 dependency tracks `latest`, but installing from the lockfile is reproducible.
No periodic software updater is installed by this project.

There is no exact-version allowlist. T3 protocol 1 retains the legacy managed-turn
adapter; protocol 2 enables native goals only when the provider advertises them.
New releases with the same required contract are accepted. Unsupported protocols
or missing capabilities stop submissions with an explicit error.

Review upstream changes, update dependencies deliberately, run the checks and
inspect connection behavior before enabling automation. Do not infer that a
passing simulated suite validates real provider execution or credit redemption.
