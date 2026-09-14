/**
 * A revision, shortened only when shortening it is safe.
 *
 * `status.sync.revision` is a resolved git commit for a git application and a
 * *chart version* for a Helm one, and ArgoCD reports both in the same field.
 * Seven characters of a 40-character sha is the convention every git tool
 * uses and the whole app follows it; seven characters of `v1.2.3-hotfix` is
 * `v1.2.3` — a different revision that also exists, printed as if it were the
 * one that was compared. A name has to survive whole.
 */
export const shortRev = (revision: string | undefined) =>
  revision && /^[0-9a-f]{40}$/.test(revision) ? revision.slice(0, 7) : revision
