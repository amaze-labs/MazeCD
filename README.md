# MazeCD

A mobile-first PWA for operating several ArgoCD instances from one screen:
one aggregated application list, full sync control, rollback, pod logs, and a
login you only do once.

## How it works

A single Go binary serves the API and the embedded PWA from the same origin.
It reads its instances from a mounted YAML file and reverse-proxies your
browser's requests to each ArgoCD API server with that instance's token
injected, so the tokens never reach the device and no CORS configuration is
needed on the ArgoCD side.

## Setup

### 1. Create an ArgoCD API token per instance

On each instance, add a local account and give it the permissions you want
MazeCD to have:

```yaml
# argocd-cm
data:
  accounts.mazecd: apiKey
```

```yaml
# argocd-rbac-cm
data:
  policy.csv: |
    p, role:mazecd, applications, get, */*, allow
    p, role:mazecd, applications, sync, */*, allow
    p, role:mazecd, applications, action/*, */*, allow
    p, role:mazecd, applications, delete, */*, allow
    p, role:mazecd, applications, override, */*, allow
    p, role:mazecd, logs, get, */*, allow
    g, mazecd, role:mazecd
```

Then generate the token:

```bash
argocd account generate-token --account mazecd
```

Grant only what you want to be able to do from your phone. Dropping
`delete` and `override` from the policy makes MazeCD read-plus-sync only —
the UI surfaces ArgoCD's own 403 for anything the token cannot do.

### 2. Write the configuration

Copy `config.example.yaml` to `config.yaml` and list your instances.

### 3. Generate the secrets

```bash
export MAZECD_PASSWORD_HASH="$(docker run --rm -i mazecd:dev hash <<< 'your-password')"
export MAZECD_SESSION_KEY="$(openssl rand -base64 32)"
export ARGOCD_TOKEN_PROD=...
```

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

The PWA updates itself: a running client notices the new build within a minute
of the deployment, or immediately when it next comes to the foreground.

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

No push notifications, no watch streams (it polls every 8 seconds in the
foreground), no ApplicationSet/Project/Repository administration, no
multi-user support, no terminal into pods, and no passkeys — the session lasts
90 days and renews itself, so a login is a twice-a-year event.
