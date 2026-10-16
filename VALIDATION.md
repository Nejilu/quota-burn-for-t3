# Validation status

Reference versions: T3 0.1.0, Codex CLI 0.162.1 and Claude Code 2.1.301.
Checks cover Windows x64, Ubuntu x64 and a Debian-based Linux container.

## Automated checks

The current checks pass: TypeScript validation, 96 automated tests and the
production build. Run `npm.cmd run typecheck`, `npm.cmd test` and `npm.cmd run build`.
The suite covers planner boundaries and partial windows, policies and campaign
caps, provider normalization, protocol compatibility, native ownership and Stop,
watchdog behavior, and HTTP session/origin/CSRF checks.

Inference and reset adapters are simulated. The HTTP tests use an isolated data
directory and do not dispatch to a real provider.
CI runs these checks on Windows and Ubuntu. Additional integration checks start
real T3 without a subscription login or model request.

## Platform integration

The [Windows/Linux/container workflow](https://github.com/Nejilu/quota-burn-for-t3/actions/runs/38851766628)
passed on 16 October 2026:

| Environment | Checked |
| --- | --- |
| Native Windows and Ubuntu | Bundled CLI version probes, real T3 discovery, provider catalog, Observation startup, owned-process Stop. |
| Separate Linux containers | Real T3 connection through a scoped credential file, password enforcement, remote folder validation/registration, persistent settings, worker kill/restart and graceful Stop. |
| External Docker watchdog | Heartbeat continues after the worker is killed; owned-run interruption logic is covered by simulated tests. |

Container smoke tests use disposable data and no authenticated provider account.
They do not validate actual model execution or credit redemption in containers.

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

The Windows installation's real remote-session connection and folder-metadata
lookup have also been checked without inference.

The Claude credit bridge uses version-dependent provider endpoints. Simulated
contract tests do not establish compatibility with all live accounts or releases.
Usage estimates, provider reporting delays and interruption latency can cause
forecast errors and threshold overshoot.
