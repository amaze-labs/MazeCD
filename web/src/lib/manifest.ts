import { stringify } from 'yaml'

/**
 * Manifests, printed as YAML — the form every operator reads and writes them in.
 *
 * ArgoCD hands every manifest over as a JSON string; the live one on a single
 * line, which on a phone is one row scrolled sideways forever.
 *
 * WHY NOT HAND-ROLLED. A YAML emitter that gets quoting subtly wrong prints a
 * manifest that is not the manifest — `"8080"` shown as `8080`, `"yes"` shown
 * as `yes` — and pasted back into a cluster it is a different object. The
 * `yaml` library does the quoting, and does it to YAML 1.1 rules: Kubernetes'
 * own parser reads 1.1, where `on`, `no` and `y` are booleans, so those
 * strings have to come out quoted. `lineWidth: 0` keeps a long string (an
 * annotation, a command line) on its line instead of folding it, which is
 * valid YAML but not what anyone wrote.
 */
export function toYaml(o: unknown): string {
  return stringify(o, { version: '1.1', lineWidth: 0 })
}

/**
 * The live object, readable. `metadata.managedFields` is dropped: it is
 * server-side-apply bookkeeping — often longer than the rest of the object put
 * together — and ArgoCD's own UI hides it by default. Everything else is left
 * exactly as the cluster has it.
 *
 * A string that does not parse is returned untouched: better the raw text
 * than nothing.
 */
export function prettyManifest(raw: string | undefined): string {
  if (!raw) return ''
  try {
    const o = JSON.parse(raw) as { metadata?: { managedFields?: unknown } }
    if (o?.metadata && typeof o.metadata === 'object') delete o.metadata.managedFields
    return toYaml(o)
  } catch {
    return raw
  }
}
