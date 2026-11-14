# ArgoCD access

MazeCD talks to each ArgoCD instance with one API token, and **the token
decides what MazeCD may do**. Synchronize and resource actions are the only
things in MazeCD that change a cluster; give the token `get` alone and MazeCD
is a read-only instrument.

- [The account](#the-account)
- [The read-only policy](#the-read-only-policy)
- [Allowing writes](#allowing-writes)
- [The token](#the-token)

## The account

On each instance, add a local account that can only use API keys:

```yaml
# argocd-cm
data:
  accounts.mazecd: apiKey
```

## The read-only policy

Everything MazeCD *shows* — the list, the detail, the resource tree, the
diff, the manifests, the refresh button, and the list of actions a resource
offers — is `applications, get`, plus `logs, get` for pod logs:

```yaml
# argocd-rbac-cm
data:
  policy.csv: |
    p, role:mazecd, applications, get, */*, allow
    p, role:mazecd, logs, get, */*, allow
    g, mazecd, role:mazecd
```

This is a legitimate way to run MazeCD, and the safe one: nothing on your
phone can be made to change a cluster with this token. What you give up is
Synchronize and the resource actions. Both are still *drawn* — the app cannot
know what the token may do until it tries, and the action list itself is a
`get` — so pressing either returns a 403, which MazeCD shows as it arrived.

`applications, get` also covers the refresh button: ArgoCD implements
`?refresh=` as a query parameter on the application GET.

## Allowing writes

Add whichever of these you actually want:

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

The `*/*` is `project/application`, so `*/*` means the whole instance.
Scoping the write lines to one project —
`p, role:mazecd, applications, sync, platform/*, allow` — while leaving `get`
on `*/*` gives a phone that can see everything and sync one project, which is
usually the policy worth writing.

A sync's prune, force, replace and dry-run flags need nothing beyond `sync`;
a dry run is an ordinary sync request that ArgoCD is told not to apply.

## The token

```bash
argocd account generate-token --account mazecd
```

Put it in an environment variable and reference it from the instances file —
[Configuration](configuration.md#the-instances-file). The token stays on the
server: MazeCD injects it into the requests it proxies, and the phone never
sees it.
