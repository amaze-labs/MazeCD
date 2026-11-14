# MazeCD documentation

New here? The [project README](../README.md) shows what MazeCD looks like and
gets it running. These guides cover the rest.

## Guides

| Guide | For | Covers |
| --- | --- | --- |
| [Installation](installation.md) | whoever runs it | Docker Compose, Kubernetes, HTTPS and reverse proxies, upgrades, health check and logs, installing as an app |
| [Configuration](configuration.md) | whoever runs it | The instances file, every environment variable, rotating a token |
| [ArgoCD access](argocd-access.md) | ArgoCD admins | The local account, the read-only policy, what synchronize and resource actions need |
| [Development](development.md) | contributors | Running from source, tests, the dev harness, project layout, releases |

## Common tasks

- [Create a read-only token](argocd-access.md#the-read-only-policy)
- [Let the phone synchronize one project only](argocd-access.md#allowing-writes)
- [Put MazeCD behind a reverse proxy with HTTPS](installation.md#https-and-reverse-proxies)
- [Run it on Kubernetes](installation.md#kubernetes)
- [Add an instance or rotate a token](configuration.md#changing-the-configuration)
- [Upgrade to a new release](installation.md#upgrading)

## What MazeCD deliberately does not do

No push notifications, no rollback or delete, no editing an application's
spec, no ApplicationSet / Project / Repository administration, no multi-user
support, no terminal into pods, and no passkeys — the session lasts 90 days
and renews itself, so a login is a twice-a-year event.

Synchronize and resource actions are the only things in MazeCD that change a
cluster, and the ArgoCD token decides whether they are allowed at all.
