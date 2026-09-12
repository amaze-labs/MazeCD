# MazeCD — visual rework brief

Restyle only. No logic changes: the proxy, the guardrails, the sync mapping, the
update watcher and every test stay exactly as they are.

## What this thing is

A triage instrument, used one-handed, usually while something is broken. Not a
dashboard to browse. The reference vernacular is instrumentation — a panel you
read at a glance in bad light under time pressure — not an admin console.

The real fleet has **99 applications, almost all healthy**. The list's job is to
make the two that are broken impossible to miss, and to let the other 97 recede.

## What is wrong today, from screenshots of the running app

1. **The instance colour bar is noise wearing the costume of signal.** A healthy
   app carries a thick red bar on its left edge because its instance is themed
   red. The most alarming colour in the most alarming position, for information
   that is not a state. This is the single worst thing in the UI.
2. **Two identical green dots** for health and sync — two orthogonal states
   rendered indistinguishable.
3. **~150px of row for three facts**, times 99 rows.
4. **Selection checkboxes dominate the resource tree** — large empty squares that
   read as failed images, for a feature used rarely, while the resource names they
   crowd out get truncated.
5. Everything is system-font grey. No hierarchy, no character.

## The three moves that carry this design

### 1. The fleet bar is the hero

Under the "Applications" title, a single full-bleed horizontal bar, 6px tall,
segmented by proportion: degraded, out-of-sync, progressing, healthy. Before
reading a single row you see the shape of the fleet. Tapping a segment filters
to it. This is the most characteristic thing in this product's world, so it opens
the screen — it is not decoration, it is the summary and the control at once.

### 2. State is carried by the surface, not by a dot

Kill the dots and the instance bar. A row's **own surface** expresses its state:

- Healthy: flat, sitting at the background's own value, almost no separation
  from its neighbours. It should be restful and nearly invisible.
- OutOfSync: a faint amber-shifted surface and a left edge in amber.
- Degraded or Missing: a distinctly lifted, red-shifted surface with real
  contrast against the background, a red left edge, and the failure reason
  carried inline on a third line.
- Progressing: the left edge animates — a slow indeterminate sweep, not a
  static colour. An application mid-operation should visibly breathe. This is
  the one piece of non-interactive motion in the app; respect
  `prefers-reduced-motion` by falling back to a steady colour.

Elevation encodes urgency. Broken things come toward the reader; healthy things
lie flat. Do not give every row the same card treatment and the same shadow —
that is the look this rework exists to escape.

Status colours stay ArgoCD's own, because they are muscle memory:
`#18be94` healthy, `#0daeeb` progressing, `#e96d76` degraded, `#f4c030`
out-of-sync, `#766f94` suspended, `#ccd6dd` unknown.

### 3. Typography does the work

Set **Archivo** (variable, weight and width axes) as the interface face, and
**IBM Plex Mono** for machine identifiers only — revisions, hashes. Install both
through `@fontsource-variable/archivo` and `@fontsource/ibm-plex-mono` so Vite
bundles them and the service worker precaches them; no third-party font request
from a tool that must work on a bad hotel connection.

- Application name: ~22px, weight 600, tracking tightened, **width axis narrowed
  to about 90** — the functional reason being that `platform-ingress-controller-prod`
  and `inventory-db-f4f8899` must fit a 390px screen without truncating. Let
  the name be the loudest thing on the row by a wide margin.
- Everything else recedes: 13px, muted, regular weight.
- Never truncate a name where the layout could have given it the width.

## Kill list

These are in the current build and must not survive:

- The middle-dot meta string (`home · default · inventory-web · a8f3acc`). Replace
  it with structured micro-layout: the instance as a small tinted pill, the
  namespace as plain text, the revision in mono pushed to the right edge.
- The selection checkboxes in the resource tree. They appear only after the user
  taps "Select" in the action bar; until then the resource name owns the width
  and the Kind is a small muted label above it, not a fixed column beside it.
- 1px hairline dividers between list rows. Separation comes from the surfaces
  themselves and the gap between them.
- The two-item text-only bottom navigation. Give it icons with labels and a
  clear active state.

## Palette

```
ink       #0A0F14   page
panel     #121A22   resting surface
raised    #18222D   a surface that has come forward
inset     #1B2630   fields, code, log output
rule      #263240   borders where a border is genuinely needed
text      #E8EEF4
muted     #7E8C9A
```

Degraded and out-of-sync surfaces are these values shifted toward their status
hue, not flat status colour — keep them dark enough that white text stays
comfortably readable.

## Geometry

Radii by role, not one radius everywhere: 14px on sheets and buttons, 10px on
pills and chips, 0 on full-bleed list rows. Tap targets stay at 44px minimum,
which six earlier tasks had to be corrected for — do not regress it.

## Quality floor, not negotiable

Responsive to 390px and below, visible keyboard focus, `prefers-reduced-motion`
respected, contrast sufficient for white-on-surface at every state tint, and the
dark palette applied through the existing Tailwind theme tokens rather than
scattered literals.

## Out of scope

No new screens, no new navigation, no new features. The missing project filter,
the resource events tab and the log container picker are separate decisions and
stay untouched here.
