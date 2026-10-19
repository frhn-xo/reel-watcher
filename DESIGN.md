# Reel Watcher — Design Language

> The single source of truth for how this app looks and feels. Every screen,
> component, and future feature follows it. It is a living document: you may break
> a rule, but the moment you do, **it becomes a new rule — write it here and apply
> it everywhere.** No silent one-offs. A magic number that isn't in this file is a
> bug against the system.

---

## 1. Principles

The product is a calm, personal "Netflix for one channel" — the antidote to the
infinite feed. The design has one job: **let someone watch, without being farmed
for attention.** Five principles, in priority order:

1. **Calm over capture.** No autoplaying feed, no red-dot nags, no engagement
   bait. The UI should feel like a quiet library, not a slot machine. When in
   doubt, do less.
2. **Content is the interface.** The thumbnails and the video are the brightest,
   largest, most saturated things on screen. Everything else is grayscale and
   quiet so the imagery carries the room.
3. **One accent, earned.** A single saturated color (playback red) carries
   meaning. Color is scarce on purpose — if everything is colored, nothing reads.
4. **Honest state.** Show real status plainly: which channel, how fresh the data
   is, what's seen vs. unseen. The data expires by design — surface that, don't
   hide it.
5. **Hierarchy by subtraction.** To make something stand out, take emphasis *away
   from everything else* rather than piling it onto the hero. Amplify the frequent;
   quiet the rare.

---

## 2. Visual hierarchy — the five levers

There are exactly five ways to move something up or down the attention ladder.
Reach for them in this order; stop as soon as the job is done.

| Lever | Louder → | Quieter → |
|---|---|---|
| **Size** | bigger | smaller |
| **Weight** | 600 | 400 |
| **Contrast** | `neutral-50` on `neutral-950` | `neutral-500` on `neutral-950` |
| **Color** | the accent | neutral |
| **Position** | top-left / center / its own row | edges / inline / tucked under |

Rules:
- **Never use more than two levers to make the same point.** A primary button is
  size + position, not size + position + color + weight.
- **Spend `Color` last and least.** It's the loudest lever and the easiest to
  overuse. See §4.

---

## 3. Feature priority map

What the app is *for* decides what gets emphasis. Watching is the point; everything
else is support or maintenance.

| Tier | What | Treatment |
|---|---|---|
| **Loud** | Reel tiles · the playing video | Largest elements, full-color imagery, center/grid. The only things allowed to be visually "big." |
| **Medium** | Filter pills · Continue-watching · transport controls · scrubber | Visible but neutral: ghost/outline, medium weight, standard size. |
| **Quiet** | Channel metadata · freshness · Refresh · speed/rotate/fullscreen · counts · keyboard hints | Muted ink, small size, tucked to edges. Present when wanted, invisible until then. |

Concretely: **Refresh is maintenance, not a feature** → it stays a ghost button at
the edge. **Watching a reel is the feature** → the tiles dominate by size and are
the only saturated things in the grid.

---

## 4. Color

**Dark-only.** This is a viewing app; a bright chrome fights the content. There is
no light theme and we don't pretend to support one.

Chromatic color is a scarce resource. The palette is **neutrals + exactly two
meaningful colors.**

### Surfaces (background → foreground)
| Token | Tailwind | Hex | Use |
|---|---|---|---|
| bg | `neutral-950` | `#0a0a0a` | app background |
| surface | `neutral-900` | `#171717` | raised: tiles, menus, pills |
| surface-2 | `neutral-800` | `#262626` | hover / second raise |
| hairline | `white/10` | — | default divider / border |
| hairline-faint | `white/5` | — | subtle ring on cards |

### Ink (text)
| Token | Tailwind | Use |
|---|---|---|
| ink | `neutral-50` / `neutral-100` | primary text, titles |
| ink-muted | `neutral-400` | secondary text, metadata |
| ink-faint | `neutral-500` | tertiary, disabled, counts |

### The two meaningful colors (tokens in `globals.css`)
| Token | Utility | Hex | Means — and ONLY this |
|---|---|---|---|
| accent | `bg-accent` `text-accent` `ring-accent` | `#dc2626` (red-600) | **playback**: progress bars, scrubber, resume. Also the focus ring. Nothing decorative. |
| accent-hover | — | `#ef4444` (red-500) | hover of accent surfaces |
| seen | `text-seen` | `#34d399` (emerald-400) | **finished/seen** status. Nothing else is ever emerald. |

**Selected ≠ accent.** A selected UI control (active filter pill) uses an *inverse*
fill — `bg-white text-neutral-900` — not red. Rationale: red is reserved for
playback, so "which thing is selected" and "where the video is" never get confused.
These are two distinct meanings and must stay visually distinct.

**Rule:** if you're about to introduce a third chromatic color, don't. Solve it
with a neutral + one of the two levers above. If it genuinely can't be solved,
that's a new rule — add the token here with its one meaning, then use it.

---

## 5. Typography

- **One family: Geist Sans** (loaded via `next/font`), everywhere. `tabular-nums`
  for any changing numbers (timecodes, counts) so they don't jitter.
- No decorative/display fonts. (We tried one for the wordmark; it cost more space
  and attention than it earned. If one ever returns, it's a documented rule here,
  used in exactly one place.)

### Scale
| Role | Size | Weight | Notes |
|---|---|---|---|
| Page title | `text-xl` (20) | 600 | e.g. the channel name — the one title per screen |
| Body | `text-sm` (14) | 400 | default |
| Interactive label | `text-sm` (14) | 500 | buttons, pills |
| Meta / caption | `text-xs` (12) | 400 | metadata, hints |
| Micro label | `text-xs` (12) | 600, `uppercase tracking-wider`, `ink-muted` | section headers ("Continue watching") |
| Badge | `text-[11px]` (11) | 600 | floor is 11px — never smaller |
| **Cinema title** (exception) | `text-3xl` (30) | 700 | player overlay only — big, over video, for a moment. The one place we go large. |

Letter-spacing: `tracking-tight` on the page title; `tracking-wider` on uppercase
micro labels; default elsewhere.

---

## 6. Spacing & layout

- **4px base.** Use the step scale only: `1`(4) `2`(8) `3`(12) `4`(16) `6`(24)
  `8`(32) `10`(40). No `5`, `7`, `9`, no arbitrary pixel gaps.
- **Container:** `max-w-7xl mx-auto px-6`. Header `py-4`, content sections `py-8`.
- **Grid:** `gap-4`, responsive `grid-cols-2 sm:3 md:4 lg:5`. Tiles are `aspect-[9/16]`.
- **Related things cluster** (small gaps `2`–`3`), **unrelated things separate**
  (large gaps `8`–`10`). Proximity is a free hierarchy lever — use it before color.

---

## 7. Radius & elevation

| Radius | Utility | Use |
|---|---|---|
| sm | `rounded` | thin bars (progress/scrubber) |
| md | `rounded-lg` | popovers / menus |
| lg | `rounded-xl` | content cards / tiles |
| full | `rounded-full` | all interactive controls: buttons, pills, chips, icon buttons |

**Elevation = hairlines, not shadows.** Surfaces are separated by `ring-1
ring-white/10`, not drop shadows. The *only* permitted shadow is on floating
popovers (`shadow-xl` + `ring-1 ring-white/10`), because they genuinely sit above
the page.

---

## 8. Iconography

- **Inline SVG only.** No unicode glyphs (`▶ ↻ ▸ ←`) in the UI — they render
  inconsistently across platforms and don't match stroke weight. (Plain text
  arrows in `title`/aria copy are fine.)
- `viewBox="0 0 24 24"`, `fill="currentColor"` (solid) so icons inherit ink/accent.
- Sizes: `22` transport controls · `18` inline/meta · `14` badge check.

---

## 9. Motion

- Default transition **150–200ms, ease**. Use it for hover, show/hide, fades.
- Show/hide chrome (player controls, scrims, title) is an **opacity** fade, never a
  layout shift.
- Tile hover: `scale-105` on the image, ring brightens `white/5 → white/20`.
- **Respect `prefers-reduced-motion`** — transitions/animations are neutralized
  globally in `globals.css`. Don't fight it.

---

## 10. Component patterns

**Buttons**
- *Primary* (rare): `bg-white text-neutral-900 rounded-full` — inverse fill.
- *Secondary / ghost* (default): `rounded-full border border-white/15 text-neutral-200 hover:border-white/40 hover:text-white`.
- *Icon*: `grid place-items-center rounded-full h-9 w-9 text-white/90 hover:bg-white/15`.

**Filter pill:** `rounded-full px-3.5 py-1.5 text-sm font-medium`. Selected =
inverse fill (`bg-white text-neutral-900`); idle = `border border-white/15
text-neutral-300 hover:bg-white/10`. Count rides inline in `ink-faint`.

**Tile:** `rounded-xl overflow-hidden bg-neutral-900 ring-1 ring-white/5
hover:ring-white/20`. Image `object-cover`, hover `scale-105`. A bottom gradient
scrim keeps overlay text legible. **Watched tiles recede** (`opacity-45
saturate-50`) and restore on hover — a calm signal, not a loud badge.

**Badges / chips:** `rounded-full bg-black/55 backdrop-blur text-[11px]
font-semibold`. Seen = `text-seen`; resume/time = `text-white`.

**Popover / menu:** `rounded-lg bg-neutral-900/95 backdrop-blur ring-1
ring-white/10 shadow-xl`.

**Focus (accessibility, non-negotiable):** every interactive element shows a
keyboard focus ring — `focus-visible:outline-none focus-visible:ring-2
focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950`.
Hover styling is never a substitute for focus.

---

## 11. Evolving this system

1. **A new need → a new token or pattern here first,** then use it. Never hardcode
   a value that should be a token.
2. **Breaking a rule is allowed; a silent exception is not.** Change the rule in
   this file and bring the whole app in line, or don't break it.
3. **Prune.** If a token/pattern is used in exactly one place and isn't load-bearing,
   it's probably not a system — inline it or justify it here.
4. **The test for every change:** does the app still feel like *one* thing? If a
   screen feels like it came from a different app, the system lost — fix it.
