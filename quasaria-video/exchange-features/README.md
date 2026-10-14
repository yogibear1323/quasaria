# Quasaria Exchange: feature sizzle videos

One video per exchange feature, in the style of the Exchange sizzle (`../sizzle/`): near-black + violet/cyan, Singularity Q end card, 128 BPM self-synthesized bed, Kokoro `af_heart` VO, -14 LUFS.

Masters are 1920×1080 / 1080×1920, 30 fps, H.264 + AAC 48 kHz. `web/` holds the 720p copies (video 11's are named `11-perps-funding-bots-*` so browsers fetch the new file instead of a cached one) (1280×720 / 720×1280, faststart, 2.1–3.2 MB) and posters that ship on the landing page (`frontend/public/media/features/`, PR #15).

| # | Feature | 16:9 | 9:16 | Runtime |
|---|---|---|---|---|
| 01 | Swaps: SDEX order book + Soroban AMM routing, path payments with auto-trustline, slippage/deadline guard, non-custodial signing | `01-swaps-16x9.mp4` | `01-swaps-9x16.mp4` | 27.2 s |
| 02 | Liquidity pools: x·y=k pools + QLP shares, 0.30% fee to LPs (referrer share), curated XLM pairs with testnet stand-ins (stablecoins, SHX, AQUA, yXLM), IL calculator | `02-liquidity-pools-16x9.mp4` | `02-liquidity-pools-9x16.mp4` | 29.5 s |
| 03 | Lending market: supply/borrow, two-slope utilization rates, health factor & 50% close factor, repay never paused, oracle-freshness gate | `03-lending-market-16x9.mp4` | `03-lending-market-9x16.mp4` | 27.2 s |
| 04 | Warp leverage vault: isolated-margin long/short, oracle-priced PnL, delegated operator (bot) key that can't withdraw; leverage/liquidation risk card | `04-warp-leverage-vault-16x9.mp4` | `04-warp-leverage-vault-9x16.mp4` | 28.6 s |
| 05 | Stop-loss/take-profit triggers + liquidations (keeper execute_trigger, HF<1.0 liquidation with bonus); leverage risk card | `05-stop-loss-take-profit-liquidations-16x9.mp4` | `05-stop-loss-take-profit-liquidations-9x16.mp4` | 28.6 s |
| 06 | Oracle pricing: Reflector-compatible lastprice, 5-min testnet feed of 42 prices, max-age/future-timestamp rejection, stale mark blocks new risk | `06-oracle-pricing-16x9.mp4` | `06-oracle-pricing-9x16.mp4` | 29.5 s |
| 07 | QFX (1:1 XLM-backed), holder yield & staking from pre-funded reserves, referral fee share, reward calculators (illustrative/variable) | `07-qfx-staking-referrals-16x9.mp4` | `07-qfx-staking-referrals-9x16.mp4` | 29.1 s |
| 08 | XP ranks (Stardust→Comet→Nova→Pulsar→Quasar), Quests, badges & streaks; XP has no cash value | `08-xp-ranks-quests-16x9.mp4` | `08-xp-ranks-quests-9x16.mp4` | 28.6 s |
| 09 | Markets page (live Stellar mainnet data via Horizon, read-only; Trade opens testnet pairs) + Stellar news feed | `09-markets-news-16x9.mp4` | `09-markets-news-9x16.mp4` | 27.7 s |
| 10 | Governance & security: timelocked admin, two-step admin handover (multisig not live), withdraw-safe pause, unaudited status | `10-governance-security-16x9.mp4` | `10-governance-security-9x16.mp4` | 28.1 s |
| 11 | Perps funding + bots: LIVE ON TESTNET (since 2026-10-04, testnet Warp vault CCLI4VU7PD7VKS3NWILJQXI445A2W6L2JQCMM3MOGTHLFBKNTUSUCJX2; hourly rate, capped 0.05%/h): funding rates, then the six Back Office bots (Vega, Regal, Lyra, Nova, Echo, Halo), the $500 demo flow, per-bot timeframes and risk limits from real live-demo captures; leverage risk card | `11-perps-funding-16x9.mp4` | `11-perps-funding-9x16.mp4` | 44.5 s |

Contact sheets: `contact-sheets/<file>.jpg` (12 frames per video). Live gallery screenshots: `live-gallery-{desktop,mobile}[-modal].png`.

Compliance: every frame carries a TESTNET · BETA pill (video 11 was updated on 2026-10-04 to say 'Live on testnet'; it now uses the standard pill). The end card says testnet beta, unaudited, not financial advice. Leverage videos (04, 05, 11) have a 'Leverage amplifies losses' card and an end-card liquidation-risk line. Rates, rewards and APY are labelled illustrative/variable. No gradient text. Third-party asset logos were replaced with neutral discs and news thumbnails hidden at capture time; names appear as plain text only. Captures were read-only browsing of the local preview (no transactions).

Rebuild: `work/` (`specs.py` scenes, `xf.py` renderer, `diagrams.py`, `xaudio.py` music+VO, `tts_x.py` Kokoro VO, `shoot2.mjs` captures).

## QA (2026-10-04)
- ffprobe: all 22 masters are complete and playable (h264 + aac, 30 fps, frame counts match their durations). Three 9:16 files (06, 07, 09) were re-rendered after a 6 px hook-title safe-area fix. Renderer safe-area log (`work/txt_err_*.json`): 0 violations in all 22.
- Loudness: -14.0/-14.1 LUFS integrated on every file. True peak is -0.7 dBTP on 07 and -1.2 to -1.5 dBTP on the rest.
- STT (faster-whisper small.en): the VO is fully intelligible. Word error rate is 0–6%, except 02 and 07 (16–19%), where the only differences are spelled-out letters like "Q L P" and "X L M". No "bank" in any transcript.
- OCR (RapidOCR, 1 fps): "Testnet" is on screen in all 22. "Leverage amplifies losses" appears in 04, 05 and 11. "In development" appears in 11 (and in 10, for the multisig). No "bank". The only "guarantee" hits are negations ("not guaranteed fills", "not guaranteed").
- Visual review: contact sheets in `contact-sheets/`.

## Update 2026-10-04 14:15: video 11 marked live
- Hook now reads "Perpetuals. Live on testnet." Scene 1 reads "Live on testnet." with the checklist: funding module merged ✓, live on the testnet vault ✓, external audit not yet. The funding diagram notes the 0.05%/h cap, and its footer reads "Live on testnet · hourly · unaudited".
- The risk card is kept, with "Live on testnet · unaudited · not financial advice". The end card is the standard one.
- VO: only `11_h` and `11_s1` were regenerated (same Kokoro voice and speed). The end line uses the standard `end.wav`. Shot timing, music and the 29.06 s runtime are unchanged.
- The previous video-11 masters and VO are kept in `work/old11/`.
- QA: -14.0 LUFS, true peak -1.3 dBTP. STT matches the script word for word. OCR finds "Live on testnet", "Testnet" and "Leverage amplifies losses", and no "not deployed", "in development", "not live", "draft", "Rigel" or "bank".

## Update 2026-10-04 15:30: video 11 now features the bots

- Runtime 29.1 s -> 44.5 s. Hook, 'Live on testnet' checklist, funding-rates diagram, risk card, end card and music style unchanged; the 'settled into margin' scene was dropped to make room.
- New scenes, from real captures of the live site's Demo account (Active profile, started with $500 in a fresh browser; browser-only simulation, nothing signs or touches a wallet):
  1. 'Six bots on the trading floor': robot floor with all six desks, timeframe badges, trade bubbles and desk P&L counters, badge DEMO · SIMULATED, chip 'Real demo capture · not real money'.
  2. 'Try a $500 demo': screen-by-screen capture of picking $500 and pressing Start demo, then the running demo panel with the live market feed. Chip 'Simulated · not real money'.
  3. 'Timeframes & limits': the demo's bot/frame table, then the desk detail panel (risk per trade, daily loss vs limit, drawdown vs limit). Copy: Echo 15s · Halo 30s · Lyra 1m · Vega 5m · Regal 15m · Nova 30m; up to 1% risk per trade (hard cap 2%), daily loss and drawdown limits. Badge DEMO · SIMULATED RESULTS, chip 'Automated trading carries risk · no guaranteed results'.
- No profit is shown or implied: the captured demo was net negative (floor P&L -$2.05 after ~9 min). The one positive desk figure (Lyra's single closed trade, its +$0.41/+0.36 counters and 100% win cell) was blurred in the captures (`work/mask_profit.py`, OCR-driven).
- Risk figures are from the config: per-trade risk is 0.75-1.0% (hard cap 2%), desk daily loss 3%, desk drawdown halt 10%. The brief's '1-2%' was not used literally because no desk risks more than 1%.
- Timeframes are the demo's Active profile (bot/src + frontend/src/lib/demo/profiles.ts). The live testnet fleet runs longer frames (15m-4h).
- New VO lines (same Kokoro voice): 11_b1, 11_b2, 11_b3 in `work/vo.txt`; 'Regal' is pronounced REE-gul.
- QA: -14.0 LUFS, -1.3 dBTP for both cuts; full decode OK; per-scene transcription matches the script (the only differences are numbers written as digits and 'Viga' for Vega). OCR: 'Live on testnet', Testnet, simulated, all six names, all six frames, $500, the automated-trading risk line and 'Leverage amplifies losses' are on screen. No 'bank', 'Rigel', 'not deployed' or 'in development'. No positive P&L figures appear.
- Web copies: `web/11-perps-funding-bots-{16x9,9x16}.mp4` (3.75 / 3.90 MB) and posters. The previous masters are in `work/old11_live2/`.
