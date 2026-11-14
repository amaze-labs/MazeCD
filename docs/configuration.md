# Configuration

MazeCD has two inputs: a YAML file listing the ArgoCD instances, and a few
environment variables for the secrets. Both are read **once, at start-up**.

- [The instances file](#the-instances-file)
- [Environment variables](#environment-variables)
- [Changing the configuration](#changing-the-configuration)

## The instances file

Mounted read-only at `/etc/mazecd/config.yaml` (or wherever `MAZECD_CONFIG`
points). `config.example.yaml` in the repository is a complete example.

```yaml
listen: ":8080"

instances:
  - name: prod
    url: https://argocd.prod.internal
    token: ${ARGOCD_TOKEN_PROD}
    color: "#ef4444"
    production: true

  - name: dev
    url: https://argocd.dev.internal
    token: ${ARGOCD_TOKEN_DEV}
```

`${VAR}` anywhere in the file is replaced by that environment variable, so the
tokens can come from a Kubernetes Secret and never sit in the file. A
reference to a variable that is not set stops start-up.

| Key | Required | Default | Purpose |
| --- | --- | --- | --- |
| `listen` | no | `:8080` | address the server listens on |
| `instances[].name` | yes | — | short name shown in the app; `[a-z0-9-]+`, unique |
| `instances[].url` | yes | — | the ArgoCD API server, `http://` or `https://` |
| `instances[].token` | yes | — | the ArgoCD API token — see [ArgoCD access](argocd-access.md) |
| `instances[].color` | no | `#8b93a7` | the colour of the instance's label in the app |
| `instances[].production` | no | `false` | adds an extra confirmation to synchronize and to every resource action |
| `instances[].caCert` | no | — | path to a PEM file to trust for this instance's TLS certificate |
| `instances[].insecureSkipVerify` | no | `false` | skip TLS verification — for testing only |

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MAZECD_CONFIG` | no | `/etc/mazecd/config.yaml` | path of the instances file |
| `MAZECD_PASSWORD_HASH` | yes | — | bcrypt hash of the sign-in password, from `mazecd hash` |
| `MAZECD_SESSION_KEY` | yes | — | base64, at least 32 bytes: signs the session cookies (`openssl rand -base64 32`) |
| `ARGOCD_TOKEN_*` | per instance | — | any name you like, referenced from the file as `${VAR}` |

There is one password and one user: MazeCD is a personal instrument, not a
multi-user service. A session lasts 90 days and renews itself while in use.

## Changing the configuration

Adding an instance, rotating a token or changing the password means updating
the file or the secret and **restarting the process**. Changing
`MAZECD_SESSION_KEY` signs out every device; changing the password does not
end sessions already open.
