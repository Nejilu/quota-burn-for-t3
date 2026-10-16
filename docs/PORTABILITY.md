# Windows, Linux and containers

The same backend supports native Windows/Linux and a separate Linux container.
Binary selection follows the OS and architecture. Native launchers support x64
and arm64; automated integration targets x64. See [Validation](../VALIDATION.md)
for what has actually been exercised.

## Native installation

Install Node.js 22.14+ and Git, run `npm ci` and `npm run build`, then:

```sh
npm run t3:start
npm run burn:start
```

On Windows use `npm.cmd`, or the existing `.cmd` launchers. On Linux, launchers
use the installed platform binaries and SIGTERM for verified owned process groups.
They check executable, arguments and process start identity before stopping.
`burn:stop` requests Stop for managed work before terminating the service.

Defaults remain T3 on `127.0.0.1:3773` and Quota Burn on `127.0.0.1:4317`.
Native launchers start services in the background. For a system service use
`node server/index.mjs` in the foreground with a service manager.

Provider authentication stays in the existing provider homes. `CODEX_HOME`
selects the Codex home; the T3 instance configuration selects Claude's home.
Run `npm run claude:login` for the default enabled Claude instance.

`npm run t3:open` creates a local one-time browser link. On a headless machine,
access it through an SSH tunnel for the printed port, together with port 3773.
The command does not print a bearer credential. To avoid a transient pairing
port, use T3's own pairing controls on the T3 host.

## Connect to an existing T3 server

On the **T3 host**, issue a scoped server session into a private file:

```sh
# Set QP_T3_HOME and QP_T3_BINARY if this is not the bundled T3 installation.
npm run t3:session -- /private/quota-burn/t3-session.json 30d
```

The helper grants orchestration read/operate, settings write, provider management
and filesystem read. These allow goal control, quota refresh, managed-project
restart protection and folder validation. It does not grant a terminal or
filesystem-write scope. Protect the file: this is a credential with control over
T3 work, not a read-only dashboard token.

Securely copy the credential to the Quota Burn machine. Configure:

```sh
export QP_T3_ORIGIN=http://t3-private:3773
export QP_T3_PUBLIC_ORIGIN=https://t3.example.com
export QP_T3_TOKEN_FILE=/private/quota-burn/t3-session.json
npm start
```

`QP_T3_ORIGIN` is the backend connection; `QP_T3_PUBLIC_ORIGIN` supplies browser
links. Setting a token file selects remote mode automatically. No local T3 CLI,
T3 database or workspace mount is needed for scheduling, quota reads or goals.
Folders are validated on T3 through its filesystem API (protocol 2 required).
Project paths retain the T3 server's syntax, including Windows paths from Linux.

Credentials are reread on each request. Renew the file before expiry using the
helper on the T3 host, then securely replace the file in the mounted directory.
No restart is needed. Expired/revoked credentials block new starts; existing
supervision tries Stop but cannot acknowledge it without valid T3 access.
Renewal is an operator responsibility; no cross-machine renewal timer is installed.

Back up data before changing an existing installation's connection mode: provider
account identifiers may differ between local credential discovery and remote T3
metadata. Re-select the account/model if required. Local defaults retain existing
account policies and database paths.

## Docker Compose

Prerequisite: an existing T3 server reachable from Docker on a private address.
Its CLI must support scoped sessions and protocol 2 folder metadata. Prepare
`.runtime/secrets/t3-session.json` using the previous section, then:

```sh
npm run access:password -- .runtime/secrets/access-password
cp .env.example .env
# Edit .env: private T3 address, browser T3 address, Quota Burn public origin.
docker compose up -d --build
```

On Windows use `npm.cmd` and copy `.env.example` with Explorer or PowerShell.
`.env` is read by Compose; native npm scripts use their process environment.
The generated access password is stored only in its private file; sign in with
username **admin** and that password when the browser requests authentication.
Password changes take effect after restarting Quota Burn.

The image runs as UID/GID 1000. Private files/directories must be readable and
traversable by that user; preserve restrictive permissions rather than making
credentials public. The SQLite named volume is initialized for the same user.
The runtime image contains no provider homes or authenticated CLI installation.

Compose runs:

- `quota-burn`: UI/API and scheduler, with host port 4317 bound to loopback.
- `watchdog`: independent process in a separate container, sharing SQLite and
  the T3 credential. It stays available if the worker is killed or restarted.

`docker compose stop quota-burn` leaves the watchdog running. `docker compose down`
stops both: wait for managed Stop acknowledgement in T3 before shutting down the
whole stack. A total host outage also takes down both supervisors. No supervisor
can enforce Stop while T3 is unreachable or the credential is invalid.

SQLite and the credential directory must use local persistent storage, not NFS.
Run one worker and one watchdog against a data volume; do not scale replicas.
Use the same `QP_DATA_DIR` path in both containers. Back up while both are stopped;
do not remove the data volume when upgrading.

For a T3 service in another Compose stack, attach Quota Burn and its watchdog to
the same private Docker network and use T3's service name. `host.docker.internal`
is an alternative only when the host exposes a reachable T3 listener; a Linux
host's loopback-only listener is not reachable through its bridge gateway.

## Hosted browser access

For a reverse proxy, configure:

```sh
QP_HOST=0.0.0.0
QP_PUBLIC_ORIGIN=https://burn.example.com
QP_ACCESS_PASSWORD_FILE=/run/secrets/access-password
```

The backend refuses hosted binds without a password file (at least 16 characters).
It uses HTTP Basic authentication for the single administrator, with a separate
HttpOnly SameSite Strict session and CSRF token for commands. HTTPS origins also
use Secure cookies. Keep TLS at the proxy, preserve the public Host header, and
route the same origin for API and frontend. Arbitrary forwarded headers do not
bypass host/origin validation. The health endpoint is unauthenticated for supervision.

For Dokploy/Traefik, attach the service to the proxy network and route to port
4317. Port publishing is unnecessary when the proxy shares the Docker network.
This repository supplies deployment sources; it does not configure your VPS,
DNS, certificates or infrastructure management automatically.

## Provider operations in remote mode

Remote mode supports quota reads, automatic/manual campaigns, model discovery,
goal control and remote folder registration without copying provider credentials.
It pauses for any other busy T3 conversation, conservatively preserving manual
work even when Git repository identity is unavailable across machines.

Detailed reset credits/redemption still use provider-specific local bridges.
The default remote image disables these controls. They become available only
with `QP_PROVIDER_ACCESS=local`, matching provider-home paths and suitable local
binaries (`QP_CODEX_BINARY`, `QP_CLAUDE_BINARY` overrides are available). Codex may
refresh its own authentication, so its home needs the appropriate write access.
Claude uses its existing file-based credentials and account metadata.

Native co-located Windows/Linux installs retain these bridges. Do not enable
local provider access merely to make a button available without supplying the
required files and binaries. There is no fallback to an API key or paid usage.
Real credit redemption remains unvalidated for both providers.
