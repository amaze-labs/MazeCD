import { useSyncExternalStore } from 'react'

/**
 * Which theme, and who decided.
 *
 * The system's own preference is the default, because that is the setting the
 * operator has already made once — for the phone, at the hour they made it.
 * MazeCD only has to obey it. But a preference that is right for a phone is
 * not always right for the one job this app exists for: the same operator on
 * the same phone is indoors at a desk one hour and on a platform in the sun
 * the next, and the phone's own switch is three taps away under Settings.
 * So the choice can be overridden here, and the override is remembered.
 *
 * Three states, not a boolean. "Light" and "Dark" are decisions; "System" is
 * the absence of one, and it has to be reachable again once a decision has
 * been made — a two-way switch can only be un-decided by clearing storage.
 *
 * The attribute is stamped on <html> at import time, before React paints, so
 * there is no frame of the wrong theme. The stylesheet carries a matching
 * `prefers-color-scheme` rule for the frames before this module has run at
 * all, which is the only thing it can do about a cold start.
 */
export type ThemeChoice = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

const KEY = 'mazecd.theme'
const CHOICES: ThemeChoice[] = ['system', 'light', 'dark']

/** What the two inputs add up to. Pure, so it can be checked. */
export const resolveTheme = (choice: ThemeChoice, systemPrefersLight: boolean): Theme =>
  choice === 'system' ? (systemPrefersLight ? 'light' : 'dark') : choice

// Storage is not guaranteed: Safari in private browsing throws on both ends.
// A theme is a preference, never data, so a failure here is silence.
function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return CHOICES.includes(v as ThemeChoice) ? (v as ThemeChoice) : 'system'
  } catch {
    return 'system'
  }
}

// Nothing here runs on import: `resolveTheme` is the part worth testing and
// the test runner has no DOM to touch.
let media: MediaQueryList | undefined
let choice: ThemeChoice | undefined
const listeners = new Set<() => void>()

function apply() {
  media ??= window.matchMedia('(prefers-color-scheme: light)')
  choice ??= read()
  document.documentElement.dataset.theme = resolveTheme(choice, media.matches)
  for (const l of listeners) l()
}

/** Called once from main.tsx, before the first render. */
export function initTheme() {
  apply()
  // Only matters while the choice is "system", but re-applying an explicit
  // choice is a no-op, so there is nothing to guard.
  media?.addEventListener('change', apply)
}

export function setTheme(next: ThemeChoice) {
  choice = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    /* the choice still applies to this session */
  }
  apply()
}

/** The current choice, re-rendering the caller when it changes. */
export const useThemeChoice = (): ThemeChoice =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => choice ?? 'system',
  )
