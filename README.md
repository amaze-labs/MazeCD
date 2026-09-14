# MazeCD

A mobile-first PWA for watching several ArgoCD instances from one screen: one
aggregated application list, the resource tree, pod logs, what differs from
git, the manifests git asks for, and a login you only do once.

It can also act: synchronize an application, and run a resource's own ArgoCD
actions (restart a Deployment, create a Job from a CronJob). Those two are the
only things in MazeCD that change a cluster, they are the only two that need
anything beyond a read-only token, and **the token decides**: give it `get`
alone and MazeCD is the observation instrument it started as. There is still
no rollback, no delete and no editing of anything.

## How it works

A single Go binary serves the API and the embedded PWA from the same origin.
It reads its instances from a mounted YAML file and reverse-proxies your
browser's requests to each ArgoCD API server with that instance's token
injected, so the tokens never reach the device and no CORS configuration is
needed on the ArgoCD side.

## Setup

### 1. Create an ArgoCD API token per instance

On each instance, add a local account:

```yaml
# argocd-cm
data:
  accounts.mazecd: apiKey
```

**The read-only policy.** Everything MazeCD *shows* — the list, the detail,
the resource tree, the diff, the manifests, the refresh button, and the list
of actions a resource offers — is `applications, get`, plus `logs, get` for
pod logs:

```yaml
# argocd-rbac-cm
data:
  policy.csv: |
    p, role:mazecd, applications, get, */*, allow
    p, role:mazecd, logs, get, */*, allow
    g, mazecd, role:mazecd
```

This is a legitimate way to run MazeCD, and it is the safe one: nothing on
your phone can be made to change a cluster with this token. What you give up
is Synchronize and the resource actions. Both are still *drawn* — the sheet
cannot know what your token may do until it tries, and the action list itself
is a `get` — so pressing either returns a 403 that MazeCD shows you as it
arrived. If that is the trade you want, stop here.

**To allow what MazeCD can write**, add whichever of these you actually want:

```yaml
    # Synchronize
    p, role:mazecd, applications, sync, */*, allow
    # ...at a revision other than the application's target (the revision box
    # in the sync sheet, when you type something else into it)
    p, role:mazecd, applications, override, */*, allow
    # Resource actions: one line per group/kind/action, or a wildcard
    p, role:mazecd, applications, action/apps/Deployment/restart, */*, allow
    p, role:mazecd, applications, action/*, */*, allow
```

The `*/*` is `project/application`, so `*/*` means the whole instance. Scoping
the write lines to one project — `p, role:mazecd, applications, sync,
platform/*, allow` — while leaving `get` on `*/*` gives a phone that can see
everything and sync one project, which is usually the policy worth writing.

Then generate the token:

```bash
argocd account generate-token --account mazecd
```

`applications, get` also covers the refresh button: ArgoCD implements
`?refresh=` as a query parameter on the application GET. A sync's prune, force,
replace and dry-run flags need nothing beyond `sync`; a dry run is an ordinary
sync request that ArgoCD is told not to apply.

### 2. Write the configuration

Copy `config.example.yaml` to `config.yaml` and list your instances.

### 3. Generate the secrets

`mazecd hash` prompts for the password on the terminal and prints the bcrypt
hash, so the password never lands in your shell history:

```bash
export MAZECD_PASSWORD_HASH="$(go run ./cmd/mazecd hash)"
export MAZECD_SESSION_KEY="$(openssl rand -base64 32)"
export ARGOCD_TOKEN_PROD=...
```

Once the image is built, `docker run --rm -it mazecd:dev hash` does the same
without a Go toolchain.

### 4. Run

```bash
cd docker && docker compose up --build
```

Open http://localhost:8080 and sign in.

## Environment

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `MAZECD_CONFIG` | no | `/etc/mazecd/config.yaml` | configuration file |
| `MAZECD_PASSWORD_HASH` | yes | — | bcrypt hash from `mazecd hash` |
| `MAZECD_SESSION_KEY` | yes | — | base64, ≥32 bytes, signs session cookies |
| `ARGOCD_TOKEN_*` | per instance | — | referenced from the config as `${VAR}` |

Rotating a token or adding an instance means updating the config or secret and
restarting the process: configuration is read once at startup.

## Releases

Every push to `main` builds and publishes a multi-architecture image to GHCR:

```
ghcr.io/amaze-labs/mazecd:X.Y.Z      # immutable
ghcr.io/amaze-labs/mazecd:latest
```

for `linux/amd64` and `linux/arm64`.

The version comes from the conventional commits since the last tag: a breaking
change (`feat!:`, or `BREAKING CHANGE` in the body) bumps the major, a `feat:`
bumps the minor, and everything else — fixes, chores, docs, refactors, commits
with no prefix — bumps the patch. The git tag is pushed only after the image
has been published.

The PWA updates itself. A client that is already open sees the new build
within seconds of the container being replaced and reloads itself onto it --
measured at 3.8-3.9s end to end, the deploy included; a client that was
closed during the deployment serves the shell it had and heals at once. The
version poll behind it runs every minute and on every return to the
foreground, and `npm run redeploy` from `web/` is what proves all of it
against two real images rather than a mock.

## Serve it over HTTPS

The session cookie is `Secure` and the service worker requires a secure
context. `http://localhost` counts as secure for development; anywhere else,
put MazeCD behind TLS.

Do not expose MazeCD to the internet behind a proxy that hides the client
address without first adding trusted-proxy handling: login rate limiting keys
on the connecting address, so every client would share one bucket of five
attempts per fifteen minutes.

## Development

```bash
go test ./... -race            # backend
cd web && npm test             # frontend
cd web && npm run dev          # Vite on 5173, proxying /api to :8080
```

Run the backend with `MAZECD_CONFIG`, `MAZECD_PASSWORD_HASH` and
`MAZECD_SESSION_KEY` set; the PWA build is embedded from
`internal/web/dist`, which `npm run build` populates.

## What it deliberately does not do

No push notifications, no rollback or delete, no editing an application's
spec, no ApplicationSet/Project/Repository administration, no multi-user
support, no terminal into pods, and no passkeys — the session lasts 90 days and
renews itself, so a login is a twice-a-year event.

State arrives on ArgoCD's own watch streams, one per instance, closed while
the tab is hidden; the 30-second poll behind them is the fallback for an
instance whose stream cannot be held open.
