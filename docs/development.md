# Development

MazeCD is a Go backend (`cmd/`, `internal/`) and a React + Vite PWA (`web/`).
The PWA build is embedded into the binary from `internal/web/dist`, so a
release is one binary in one image.

- [Running from source](#running-from-source)
- [Tests and checks](#tests-and-checks)
- [The dev harness](#the-dev-harness)
- [Project layout](#project-layout)
- [Commits and releases](#commits-and-releases)

## Running from source

Requirements: Go (the version in `go.mod`) and Node.js.

```bash
# Backend — terminal 1
export MAZECD_CONFIG=$PWD/config.yaml
export MAZECD_PASSWORD_HASH="$(go run ./cmd/mazecd hash)"
export MAZECD_SESSION_KEY="$(openssl rand -base64 32)"
go run ./cmd/mazecd

# Frontend — terminal 2
cd web && npm install && npm run dev    # Vite on 5173, proxying /api to :8080
```

`npm run build` writes the PWA to `internal/web/dist`, which the next
`go build` embeds.

## Tests and checks

```bash
go test ./... -race            # backend
cd web && npm test             # frontend unit tests (Vitest)
cd web && npm run lint         # oxlint
cd web && npm run build        # typecheck and build
```

## The dev harness

`dev/harness.mjs` boots a stub ArgoCD (`dev/stubargo`, three instances with
made-up applications), the real `mazecd` binary against it and the Vite dev
server, then drives a phone-sized browser with Playwright. Three commands use
it, all from `web/`:

| Command | What it does |
| --- | --- |
| `npm run shoot` | Screenshots every screen in dark and light theme into `dev/shots/`, including loading, empty and error states |
| `npm run live` | Proves the app updates from the watch streams rather than by polling, and recovers when a stream dies |
| `npm run redeploy` | Builds two images, replaces one with the other under an open client and checks that it reloads onto the new build (needs Docker) |

The screenshots in the README come from `npm run shoot`.

## Project layout

```
cmd/mazecd/        the binary: serve, hash
internal/argocd/   instance registry, aggregated list, the reverse proxy
internal/auth/     password, sessions, login rate limiting
internal/config/   the instances file
internal/server/   the route table
internal/web/      the embedded PWA
web/               the PWA source (React, Vite, Tailwind)
dev/               the stub ArgoCD and the Playwright harness
docker/            Dockerfile and a compose file that builds from source
```

## Commits and releases

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/),
and the type decides the next version, **commit by commit**: every `feat:`
raises the minor number, every `type!:` the major one, anything else
(`fix:`, `docs:`, `chore:`, …) the patch.

**Every push to `main` is a release** (`.github/workflows/release.yml`, the
same pipeline as IPMaze's): the version is computed from the commits since the
last tag, and the image is published to GHCR under that version and `latest`:

```
ghcr.io/amaze-labs/mazecd:X.Y.Z
ghcr.io/amaze-labs/mazecd:latest
```

for `linux/amd64` and `linux/arm64`, cross-compiled in one build. An image
whose files didn't change since the previous release is retagged rather than
rebuilt. The git tag (`1.2.3`, no `v`) is pushed last, once the image is out,
followed by a GitHub Release listing the commits.
