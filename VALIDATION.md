# Validation status

Reference environment: Windows x64, T3 0.1.0, Codex CLI 0.162.1 and Claude Code
2.1.301. This is a development release, not a guarantee for other combinations.

## Automated checks

The current checks pass: TypeScript validation, 96 automated tests and the
production build. Run `npm.cmd run typecheck`, `npm.cmd test` and `npm.cmd run build`.
The suite covers planner boundaries and partial windows, policies and campaign
caps, provider normalization, protocol compatibility, native ownership and Stop,
watchdog behavior, and HTTP session/origin/CSRF checks.

Inference and reset adapters are simulated. The HTTP tests use an isolated data
directory and do not dispatch to a real provider.
CI runs these checks on Windows and Ubuntu; passing Linux checks validates the
tested core paths, not the Windows launchers or live provider integrations.

## Local checks performed

| Path | Evidence |
| --- | --- |
| Codex connection | Local authentication, model discovery and quota reads checked. |
| Codex single turn | One explicitly authorized real diagnostic completed. |
| Codex native goal | One explicitly authorized real goal completed through T3 protocol 2. |
| Supervision | Restart/Observation behavior and independent watchdog checked locally; failure cases also covered by simulated tests. |
| Interface | Dark/light themes and local configuration flows inspected. |

## Not validated end to end

- Long-running native goals stopped at real quota thresholds and resumed after
  multiple real session/weekly resets.
- Real Claude goal execution, pause/resume, or multi-account execution.
- Real Codex or Claude reset-credit redemption, including uncertain provider outcomes.
- Codex Pro accounts that report no session window; these are unsupported.
- Real quota-driven work over multiple sessions in a hosted deployment.
- ARM64 and macOS installations; platform binary selection alone is not validation.

Native startup and container smoke checks are defined in CI. They exercise a real
T3 server without provider sign-in, including remote authentication and folder
validation, hosted password enforcement, persistence and watchdog survival after
worker loss. Consult the corresponding workflow result before treating these
checks as passed. The Windows installation's real remote-session connection and
folder-metadata lookup have also been checked without inference.

The Claude credit bridge uses version-dependent provider endpoints. Simulated
contract tests do not establish compatibility with all live accounts or releases.
Usage estimates, provider reporting delays and interruption latency can cause
forecast errors and threshold overshoot.
