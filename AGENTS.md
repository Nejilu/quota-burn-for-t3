# Quota Burn development

Quota Burn supports native Windows/Linux and a separate Linux container.
Read README.md, docs/DEVELOPMENT.md and docs/PORTABILITY.md first.

- Develop against local T3 at http://127.0.0.1:3773. VPS deployment is a later step.
- Use npm.cmd on Windows. package-lock.json records reproducible installed versions.
  Runtime compatibility must follow protocols/capabilities, never an exact T3 or CLI release.
- Use the scripts in package.json to start, stop and inspect this instance.
- Preserve .runtime, T3 conversations and existing Codex authentication.
- Never publish .runtime, auth files, pairing tokens or private diagnostic logs.
- The intended continuous-work behavior refers to Codex /goal, not /go.
- Native /goal receives the user's goal verbatim. Never append generic guidance
  or retired continuation instructions. Resume controls belong to the adapter.
- Goal turn-count and duration limits are optional, default unlimited (zero).
  Never expose the internal retry backoff as a goal parameter.
- Goal state is the sole per-goal scheduling control. Do not reintroduce enabled
  or repeat switches. Preserve old opt-outs as Paused during migration.
- Save goals inactive and allow only one active goal globally. Activation pauses
  the previous selection and stops its managed work before replacement dispatch.
  Goals have no priority or automatic fallback to another saved definition.
- Do not enable automatic quota consumption or redeem reset credits as an
  installation side effect. Implement those policies with explicit controls.

- Validate with npm.cmd run typecheck, npm.cmd test and npm.cmd run build.
  Tests must use simulated inference/reset adapters; real model tests require
  authorization for the specific quota-consuming test.
- Keep native defaults on loopback. Hosted binds require an access-password file
  and an explicit public origin. Preserve Host/Origin/CSRF checks behind proxies.
- Remote T3 uses a rotatable server credential file and remote folder validation.
  Never read local provider credentials or advertise reset support in remote mode
  unless local provider access was explicitly configured.
- Use the external watchdog service in containers. PID numbers are local to a
  namespace; do not use another container's PID as proof of ownership/liveness.
- CI smoke checks must use disposable data without subscription login, inference
  or reset redemption. Preserve the real Windows installation during testing.

- Supported providers: Codex and Claude Code. Protocol 2 uses native goals; protocol 1
  retains the legacy adapter. Accept newer releases with the same wire contract. Keep budgets
  namespaced by provider and use the matching credit adapter. Defaults (16/13)
  are estimates, not guarantees. Preserve saved per-account policies.
- Enforce additional Claude quota windows conservatively. Unsupported/missing
  subscription windows must never cause inference or paid-usage fallback.
- Claude reset compatibility validates the provider response contract; keep durable grant
  and request IDs on retries. Never log local credentials or API response bodies.

- Keep UI copy functional and concise: no slogans, promotional headings, or
  redundant subtitles. Keep hints only for non-obvious field behavior.

- Native work requires the independent watchdog in normal service use. Preserve
  native run/message ownership and durable Stop IDs; never steer a goal command
  into a busy run. Only an explicit single-turn action may run in Observation.
- Disable restart continuation only for the managed T3 project, preserving other
  project/global settings. Refuse managed starts while T3 auto-resume-at-limit is on.
