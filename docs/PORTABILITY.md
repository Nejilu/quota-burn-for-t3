# Linux and containers

Quota Burn is a web application with a Node.js backend. Windows is the first
installation environment, not a requirement of the quota planner or UI.
There is no container image or supported Linux deployment recipe yet.

## Current boundaries

| Component | Linux/container status |
| --- | --- |
| React UI, quota planner, campaigns and SQLite store | No Windows dependency in their implementation; covered by cross-platform CI. |
| HTTP service and watchdog | Use Node APIs, including SIGTERM handling. Simulated tests cover selected paths; live container lifecycle remains unvalidated. |
| T3 HTTP/WebSocket transport | Platform-independent, but authentication currently issues sessions through the local T3 CLI and its base directory. |
| Windows bootstrap and browser launchers | Windows-only: executable paths, platform guard, PowerShell and process termination. |
| Workspace access | Saving a goal resolves T3 project paths on the Quota Burn filesystem and runs Git there. A separate container must see matching paths or the adapter must change. |
| Provider credit integrations | Codex launches its CLI with the account home; Claude reads local credential files. These paths and permissions must be provided deliberately. |
| Hosted access | Currently loopback-only, with local host/origin checks and a local browser session. Remote authentication and proxy configuration are not implemented. |

The backend already has overrides for T3 origin, home, binary and data directory.
Changing `QP_T3_ORIGIN` alone is insufficient for a remote installation: CLI-issued
sessions, workspace paths and credit integrations still assume local access.
Some workspace identity comparisons also lowercase paths and need review for
case-sensitive filesystems.

## Deployment options

**Alongside T3 in the same Linux container or host:** closest to the current
implementation. Both applications can see the same T3 base directory, provider
homes and workspaces. Start the backend with `node server/index.mjs` rather than
the Windows launchers. A service supervisor, suitable binaries, persistent data,
private HTTP access and lifecycle checks still need to be configured. This is
an integration path, not a tested installation procedure.

**A separate Quota Burn container:** keeps its releases and persistent data
independent from T3. It needs:

1. An explicit T3 server credential mechanism and renewal strategy that do not
   assume the T3 CLI and database are inside the Quota Burn container.
2. Shared workspace paths, or remote project validation through T3. Account and
   credit adapters must either receive the required scoped local access or use
   an appropriate remote contract.
3. Configurable listen address and allowed public origin, with authentication
   suitable for a hosted interface behind a reverse proxy.
4. A reproducible image, persistent SQLite storage, health checks and graceful
   shutdown behavior. The independent watchdog must remain effective when the
   container stops or restarts; its current detached process shares the container's
   lifetime and is not an external supervisor.
5. Linux integration checks for discovery, quota reads, project paths, ownership,
   Stop/resume and recovery. Real inference/reset tests require separate explicit
   authorization.

The separate-container option is the intended hosted architecture. It does not
require rewriting the planner or UI, but adding a Dockerfile alone would not make
the current local integration a working remote service.

## Validation

CI installs dependencies and runs TypeScript validation, simulated tests and the
frontend build on Windows and Ubuntu. Check the latest workflow result for the
actual status. It performs no live T3 connection, inference or reset redemption.
No Linux/Debian deployment or container lifecycle has been validated end to end.
