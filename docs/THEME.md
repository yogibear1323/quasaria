# Quasaria theme & brand guide

**Concept — "trade at the speed of light."** A quasar is the brightest object in
the universe: a supermassive black hole whose glowing accretion disk launches
relativistic jets across the cosmos. Quasaria borrows that image: liquidity
spirals in (the disk), trades shoot out (the jet). Every page is a different
cosmic scene; UI surfaces are dark glass lit by neon plasma.

## Logo (illustrative)

| Asset | Path | Use |
|---|---|---|
| Master mark (512 viewBox, layered gradients, nebula, starfield, planet, lens flare) | `frontend/public/brand/logo.svg` (copy in `frontend/src/assets/logo.svg`) | App header, splash screen, README, OG image |
| Small-size variant (64 viewBox, simplified but still illustrative) | `frontend/public/brand/favicon.svg` | Browser favicon |
| PNG favicon 32×32 | `frontend/public/favicon-32.png` | Legacy favicon |
| Apple touch icon 180×180 | `frontend/public/apple-touch-icon.png` | iOS home screen |
| App icon 512×512 | `frontend/public/icon-512.png` | PWA manifest |
| Social / OG image 1200×630 | `frontend/public/og-image.png` | `og:image`, `twitter:image` |
| README banner 1280×400 | `docs/brand/banner.png` | README header |
| Logo PNG preview | `docs/brand/logo-512.png`, `docs/brand/favicon-preview-128.png` | Docs / reviews |

The mark is a **Q made from a quasar**: the tilted accretion disk is the bowl of
the Q (back half drawn behind the white-hot core, front half in front for
depth), and the relativistic jet that punches out of the disk to the lower right
is the Q's tail. A ringed violet planet, sparkles, nebula clouds and a dust lane
fill the deep-space disc; a cyan→violet→magenta bezel frames it.

Regenerate all PNGs after editing the SVGs:

```bash
node scripts/render-brand.mjs      # uses Playwright + @fontsource fonts from frontend/
```

## Palette (`frontend/src/theme/tokens.css`)

| Token | Hex | Role |
|---|---|---|
| `--void` | `#05030f` | Page background — the dark between galaxies |
| `--deep` | `#0b0726` | Raised surfaces |
| `--indigo` | `#1a1147` | Borders, hovers, active tabs |
| `--dust` | `#2a2160` | Hairlines, input borders |
| `--star` | `#eef1ff` | Primary text |
| `--haze` | `#a9a6d8` | Secondary text |
| `--quasar` | `#38f3ff` | Primary accent — quasar-core cyan |
| `--plasma` | `#ff3dcb` | Secondary accent — plasma magenta |
| `--nebula` | `#9b5cff` | Tertiary — nebula violet |
| `--solar` | `#ffd166` | Rewards, highlights |
| `--flare` | `#ff9a3d` | Accretion-disk orange |
| `--aurora` | `#3dffa8` | Positive / bids / buy |
| `--redshift` | `#ff4d6d` | Negative / asks / sell / danger |

Gradients: `--grad-brand` (cyan → lilac → magenta) for primary buttons, active
nav and the wordmark; `--grad-disk` (gold → orange → magenta → violet) for
reward counters and progress bars. Glows: `--glow-cyan`, `--glow-pink`,
`--glow-violet` box-shadows on buttons, cards and focus rings.

## Typography

Self-hosted via `@fontsource` (no external font CDN):

* **Orbitron** 700/900 — display: wordmark, headings, buttons.
* **Space Grotesk** 400/600/700 — body copy and UI labels.
* **JetBrains Mono** 400/700 — prices, balances, addresses (tabular numerals).

## Animated backgrounds (per-page cosmic scenes)

Implemented in `frontend/src/components/CosmicBackground.tsx` (one `<canvas>`,
shared parallax starfield) plus a CSS nebula layer per scene
(`.scene-*` in `frontend/src/theme/global.css`). All scenes respect
`prefers-reduced-motion` (single static frame).

| Page | Scene | What moves | Why |
|---|---|---|---|
| Trade | **Quasar Core** | Spinning particle accretion disk, pulsing twin jets | The brand's namesake — the engine of the exchange |
| Pools | **Nebula Drift** | Breathing, drifting magenta/violet/cyan gas clouds | Liquidity as a nebula that pools matter |
| Stake | **Orbital Rings** | Planets orbiting a golden star on tilted ellipses | Staked tokens "in orbit" |
| QFX Mint & Rewards | **Supernova** | Expanding shock rings + sparks spiralling outwards | Fully backed value (1 QFX = 1 XLM) radiating from a core |
| Referrals | **Constellations** | Drifting stars that link up when near | Your referral network as a constellation |
| Bots & Leverage | **Warp Speed** | Hyperspace streaks accelerating from the centre | Leverage = warp speed (and the danger that comes with it) |

## UI styling

* **Cards**: translucent "glass" (`--glass`) with blur, a gradient hairline
  border (cyan → magenta mask) and soft violet glow on featured cards.
* **Buttons**: brand gradient with cyan glow; buy = aurora gradient, sell =
  plasma→redshift gradient; ghost buttons glow cyan on hover.
* **Charts**: SVG with glowing cyan close line over an indigo area fill; green/red
  candles; rewards growth curve uses the disk gradient.
* **Risk UI**: red hazard-stripe banner (`.risk`) on the leverage page, gated
  acknowledgement checkbox before any bot/leverage action.
* **Splash**: `index.html` shows the pulsing logo on a deep-space radial gradient
  until React mounts.
