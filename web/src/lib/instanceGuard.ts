import type { InstanceInfo } from '../api/types'

/**
 * Whether the sync guardrail must treat this instance as production.
 *
 * Unknown must mean "ask", never "don't ask": before the instances query
 * has resolved (`instances` is undefined), or once resolved if nothing in
 * it names the route's instance, this returns true rather than false.
 */
export function isProductionGuard(
  instances: InstanceInfo[] | undefined,
  instanceName: string,
): boolean {
  if (!instances) return true
  const meta = instances.find((i) => i.name === instanceName)
  return meta?.production ?? true
}
