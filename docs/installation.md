# Installation

MazeCD ships as one Docker image: a single Go binary that serves the API and
the embedded PWA on port 8080. It reads its ArgoCD instances from a mounted
YAML file and its secrets from environment variables; both are described in
[Configuration](configuration.md). It keeps no state of its own — no
database, no volume to back up.

- [How it works](#how-it-works)
- [Docker Compose](#docker-compose)
- [Kubernetes](#kubernetes)
- [HTTPS and reverse proxies](#https-and-reverse-proxies)
- [Upgrading](#upgrading)
- [Health check and logs](#health-check-and-logs)
- [Installing as an app](#installing-as-an-app)

## How it works

The browser only ever talks to MazeCD. MazeCD reverse-proxies each request to
the right ArgoCD API server with that instance's token injected, so the
tokens never reach the device and ArgoCD needs no CORS configuration. The
list and the resource trees stay current through ArgoCD's watch streams, one
per instance, opened while the app is in the foreground.

## Docker Compose

Requirements: Docker with the Compose plugin. The image is built for
`linux/amd64` and `linux/arm64`, runs as a non-root user and needs no
writable filesystem.

1. Create an ArgoCD account and token on each instance —
   [ArgoCD access](argocd-access.md).
2. Write `config.yaml` with your instances —
   [Configuration](configuration.md#the-instances-file).
3. Generate the password hash. `mazecd hash` prompts for the password on the
   terminal and prints a bcrypt hash, so the password never lands in your
   shell history:

   ```bash
   docker run --rm -it ghcr.io/amaze-labs/mazecd:latest hash
   ```

4. Put the secrets in `.env` next to `docker-compose.yml`:

   ```bash
   MAZECD_PASSWORD_HASH='$2a$10$...'
   MAZECD_SESSION_KEY=...
   ARGOCD_TOKEN_PROD=...
   ```

   The hash goes in single quotes, because it contains `$`, which Compose
   would otherwise read as a variable. The session key is
   `openssl rand -base64 32`.

5. Start it with the `docker-compose.yml` from the [README](../README.md#quick-start):

   ```bash
   docker compose up -d
   ```

### Building from source

`docker/compose.yaml` builds the image from this repository instead of
pulling it, reading the secrets from your shell and `config.yaml` from the
repository root:

```bash
export MAZECD_PASSWORD_HASH="$(go run ./cmd/mazecd hash)"
export MAZECD_SESSION_KEY="$(openssl rand -base64 32)"
export ARGOCD_TOKEN_PROD=...
cd docker && docker compose up --build
```

## Kubernetes

The same three pieces: the image, `config.yaml` as a ConfigMap mounted at
`/etc/mazecd`, and the environment variables from a Secret.

```yaml
containers:
  - name: mazecd
    image: ghcr.io/amaze-labs/mazecd:1.11.0
    envFrom:
      - secretRef:
          name: mazecd        # MAZECD_PASSWORD_HASH, MAZECD_SESSION_KEY, ARGOCD_TOKEN_*
    ports:
      - name: http
        containerPort: 8080
    volumeMounts:
      - name: config
        mountPath: /etc/mazecd
        readOnly: true
    readinessProbe:
      httpGet: { path: /api/version, port: http }
    livenessProbe:
      httpGet: { path: /api/version, port: http }
    securityContext:
      runAsNonRoot: true
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities: { drop: ["ALL"] }
    resources:
      requests: { cpu: 10m, memory: 32Mi }
      limits: { memory: 128Mi }
```

The configuration is read once at start-up, so a changed ConfigMap or Secret
needs a restart of the pod — a tool such as Reloader does it for you. Keep
`MAZECD_SESSION_KEY` stable across restarts, or every phone is signed out.

## HTTPS and reverse proxies

The session cookie is `Secure` and the service worker requires a secure
context. `http://localhost` counts as secure; anywhere else, put MazeCD
behind TLS — an ingress, Traefik, Caddy, nginx. Pod logs and the watch
streams are long-lived responses: the proxy must not buffer them or cut them
after a short timeout.

Do not expose MazeCD to the internet behind a proxy that hides the client
address: login rate limiting keys on the connecting address (five attempts
per fifteen minutes), and behind such a proxy every client would share one
bucket.

## Upgrading

```bash
docker compose pull
docker compose up -d
```

Pin a release (`ghcr.io/amaze-labs/mazecd:1.11.0`) instead of `latest` to
choose when to upgrade. Versions follow the commits: a feature bumps the
minor number, a fix the patch, a breaking change the major one.

**The PWA updates itself.** A phone that has MazeCD open sees the new build
within seconds of the container being replaced and reloads onto it; one that
was closed during the deployment heals the next time it opens. The version
check runs every minute and every time the app returns to the foreground.

## Health check and logs

- `GET /api/version` answers `{"version":"1.11.0"}` without a session — the
  probe to point a load balancer or Kubernetes at.
- Logs go to the container's output, one line per record. Start-up prints the
  version, the listen address and the instance names; a request MazeCD
  cannot proxy to an instance is logged with the instance's name.

## Installing as an app

MazeCD is a PWA: on iOS, *Share → Add to Home Screen*; on Android, *Install
app* from the browser menu. It opens full screen, in portrait, and follows
the phone's light or dark theme unless one is chosen in *Settings*.
