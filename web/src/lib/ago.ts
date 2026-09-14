/**
 * "How long since", in the fewest characters that still say it.
 *
 * Two forms, because the same fact is read two ways. `short` is what sits in
 * the application row's leading column — the widest single thing on the row,
 * held to a fixed width so ninety-nine of them line up, which on a 393px
 * screen means three or four characters and no more. `long` is the sentence
 * a `title` and a screen reader get, where "2d" would be a riddle.
 *
 * Not `Intl.RelativeTimeFormat`: it formats a number you have already chosen
 * a unit for, and choosing the unit is the entire job here. Its narrow style
 * also still writes "2d ago", and the trailing word is exactly the width this
 * column does not have.
 *
 * Clamped at zero. Instances keep their own clocks, and one running a minute
 * ahead of the phone reports an operation that finished in the future; "-1m"
 * would read as a bug in MazeCD rather than as a skewed clock.
 *
 * Days do not roll up into weeks, months or years. An application last synced
 * "412d" ago says something a rounded "1y" does not, and the extra character
 * costs the column nothing it has not already reserved.
 */
const UNITS: [seconds: number, letter: string, word: string][] = [
  [86400, 'd', 'day'],
  [3600, 'h', 'hour'],
  [60, 'm', 'minute'],
]

export type Ago = { short: string; long: string }

/** `null` for a timestamp that is absent or unparseable — the caller draws
 * the unknown mark rather than inventing an age. */
export function ago(iso: string | undefined, now: number = Date.now()): Ago | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const seconds = Math.max(0, (now - t) / 1000)
  for (const [size, letter, word] of UNITS) {
    const n = Math.floor(seconds / size)
    if (n >= 1) return { short: `${n}${letter}`, long: `${n} ${word}${n === 1 ? '' : 's'} ago` }
  }
  return { short: 'now', long: 'less than a minute ago' }
}
