import {
  Box,
  CalendarClock,
  CircleCheck,
  CircleHelp,
  CircleOff,
  CirclePause,
  Component,
  Copy,
  Cpu,
  Database,
  FileText,
  GitCompareArrows,
  Globe,
  KeyRound,
  KeySquare,
  Layers,
  Network,
  Play,
  RefreshCw,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import type { Health } from '../api/types'

/**
 * One table for every state MazeCD can report, health and sync together,
 * because they are read the same way: an icon, a word, and ArgoCD's own
 * colour. Nothing in the interface picks a status colour without coming
 * through here.
 *
 * The colours are ArgoCD's, unchanged, except Suspended: ArgoCD's `#766f94`
 * lands at 4.1:1 as text on this app's darkest surface, so it is lightened to
 * the nearest hue that clears 4.5:1. Colour is muscle memory; illegible
 * colour is not.
 */
export type StateStyle = { label: string; icon: LucideIcon; color: string; spin?: boolean }

const STATE: Record<string, StateStyle> = {
  Healthy: { label: 'Healthy', icon: CircleCheck, color: 'var(--color-healthy)' },
  Progressing: {
    label: 'Progressing',
    icon: RefreshCw,
    color: 'var(--color-progressing)',
    spin: true,
  },
  Degraded: { label: 'Degraded', icon: TriangleAlert, color: 'var(--color-degraded)' },
  Missing: { label: 'Missing', icon: CircleOff, color: 'var(--color-degraded)' },
  Suspended: { label: 'Suspended', icon: CirclePause, color: 'var(--color-suspended)' },
  Synced: { label: 'Synced', icon: CircleCheck, color: 'var(--color-healthy)' },
  OutOfSync: { label: 'Out of sync', icon: GitCompareArrows, color: 'var(--color-outofsync)' },
}

const UNKNOWN: StateStyle = { label: 'Unknown', icon: CircleHelp, color: 'var(--color-unknown)' }

/** Anything ArgoCD did not name — including the empty string — is Unknown. */
export const stateStyle = (state: string): StateStyle => STATE[state] ?? UNKNOWN

/**
 * A glyph per Kubernetes kind, so a resource tree is scanned by shape rather
 * than read as a column of grey words. Unmapped kinds — CRDs, Rollouts,
 * anything an operator installs — get the generic component mark instead of
 * nothing, so every row still has a left edge to scan down.
 */
const KIND: Record<string, LucideIcon> = {
  Pod: Box,
  Deployment: Layers,
  ReplicaSet: Copy,
  StatefulSet: Database,
  DaemonSet: Cpu,
  CronJob: CalendarClock,
  Job: Play,
  Service: Network,
  Ingress: Globe,
  ConfigMap: FileText,
  Secret: KeyRound,
  ExternalSecret: KeySquare,
}

export const kindIcon = (kind: string): LucideIcon => KIND[kind] ?? Component

/** Sort key for triage: what is broken comes first. */
const HEALTH_RANK: Record<string, number> = {
  Degraded: 0,
  Missing: 1,
  Progressing: 2,
  Unknown: 3,
  Suspended: 4,
  Healthy: 5,
}
export const healthRank = (h: Health) => HEALTH_RANK[h] ?? 3
