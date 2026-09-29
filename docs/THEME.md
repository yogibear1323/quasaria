# Quasaria theme & brand guide (v2 · "event horizon")

**Concept: "trade at the speed of light."** A quasar is the brightest object in
the universe: a black hole whose accretion ring launches relativistic jets.
v2 keeps that story but presents it as a premium, quiet, dark exchange UI:
near-black navy, glass surfaces with hairline borders, and **one** signature
accent, cosmic violet → cyan. Color is used to mean something (accent, up/down,
warnings), not as decoration.

## Logo

Three concepts live in `frontend/public/brand/` (all font-independent SVG; the
wordmark is outlined Space Grotesk):

| Concept | Idea | Files |
|---|---|---|
| **A · Singularity Q** (default) | The accretion ring is the bowl of a Q; the jet from the bright core is its tail. A faint counter-jet and a glint finish the quasar. | `concept-a-mark.svg`, `concept-a-icon.svg`, `concept-a-lockup-dark.svg`, `concept-a-lockup-light.svg` |
| B · Beacon | Star-bright core inside a tilted accretion disk, bipolar jets. The most "cosmic". | `concept-b-*.svg` |
| C · Orbit Badge | Bold white geometric Q with a sparkle core on a violet→cyan squircle. Best on light backgrounds / app stores. | `concept-c-*.svg` |

The active concept is copied to `logo.svg` (mark), `favicon.svg` (app icon),
`logo-lockup-dark.svg` / `logo-lockup-light.svg` and `frontend/src/assets/logo.svg`.
`brand/ACTIVE` records which one. **To swap:**

```bash
node scripts/render-brand.mjs b   # or a / c — copies the SVGs and re-renders favicon-32,
                                  # apple-touch-icon, icon-512, og-image, docs/brand/*
```

To edit the concepts themselves, change `scripts/brand/gen-concepts.mjs` and run it
(`npm i --no-save opentype.js@1` inside `frontend/` first). The v1 illustrative
logo is kept in `brand/legacy/`.

Clear space: at least the core's diameter around the mark. Minimum size: 16 px
(icon), 20 px (mark). Don't recolor the ring, add outlines, or place the dark-bg
lockup on light backgrounds (use `logo-lockup-light.svg`).

## Color (see `frontend/src/theme/tokens.css`)

| Token | Value | Use |
|---|---|---|
| `--bg` / `--bg-elev` | `#06070d` / `#0b0d18` | page / raised solid |
| `--surface` | `rgba(16,19,35,.72)` | glass cards (blur 14px) |
| `--line` / `--line-2` | white 7% / 12% | hairline borders |
| `--text` / `--text-2` / `--text-3` | `#eef0fa` / `#a3a9c6` / `#7d84a6` | 15.1 / 8.3 / 5.3 : 1 on `--bg-elev` |
| `--grad-accent` | `#a78bfa → #7c5cff → #22d3ee` | signature: logo, active nav, progress, hero |
| `--grad-button` | `#6d4aff → #4f46e5` | primary buttons (white text ≥ 5.1 : 1) |
| `--green` / `--red` | `#34d399` / `#fb7185` | up, bids, buy / down, asks, danger |
| `--amber` | `#fbbf24` | rewards, estimates, TESTNET badge |

Legacy token names (`--quasar`, `--haze`, `--star`, `--solar`, …) are aliased to v2 values.

## Type & spacing

- **Space Grotesk** 500–700 for display (tight tracking, −0.02 to −0.045em).
- **Inter** (self-hosted variable woff2, OFL) for UI text.
- **JetBrains Mono** with tabular numerals for prices and amounts.
- 4 px spacing scale `--s-1 … --s-24`; radii 16 / 10 / 8 px.

## Motion & accessibility

- Micro-interactions 140–240 ms (`--ease`). Buttons lift 1 px and gain a cyan glow on hover.
- One focus ring everywhere (`:focus-visible` violet outline or `--ring`).
- The landing hero quasar is pure CSS; every animation (hero, canvas scenes,
  toasts, confetti, counters) stops under `prefers-reduced-motion`.
- Risk disclaimers, "testnet-only" and "unaudited" labels stay visible on every page.

## Game layer ("Mission control")

Purely cosmetic and frontend-only (`frontend/src/game/`): XP, levels and ranks
(Stardust → Comet → Nova → Pulsar → Quasar), quests, badges, a daily visit
streak, toasts with a light particle burst and an optional chime (off by
default). Progress is stored per wallet address in localStorage. XP has no
monetary value and is not a token. By design it rewards learning and safe,
one-time actions only; nothing rewards leverage, trade volume, trade count or
deposit size, and there are no leaderboards (enforced in `game/engine.ts` and
`test/game.test.ts`).
