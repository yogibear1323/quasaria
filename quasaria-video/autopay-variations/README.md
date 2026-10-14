# Quasaria Autopay — sizzle variations (files only; not published)
Five cuts × 16:9 (1920x1080) and 9:16 (1080x1920). H.264 High 30 fps yuv420p + AAC-LC 192k 48 kHz stereo, -16 LUFS integrated (two-pass loudnorm + limiter), +faststart.
Every cut: Kokoro-82M af_heart voiceover + self-synthesized music (numpy, no samples), burned-in captions, persistent "TESTNET DEMO · ILLUSTRATIVE" tag,
end card (Singularity Q, "Quasaria Autopay", "Down payments that keep working.", yogibear1323.github.io/autopay, disclaimer). Solid-colour text only (no gradient text).
v1-idle-hook      15.0 s  140 BPM punch     pain-point hook: idle down payment -> vault -> extra principal
v2-buyer-savings  32.5 s  112 BPM warm      boat $80k/$16k: ~$67/mo simulated, ~13 months sooner, ~$3,700 less interest; car $50k/$10k ~3 months (illustrative)
v3-seller-lender  29.0 s  100 BPM confident seller-or-lender pitch: extra principal monthly, on-chain payout ledger, same lien/title, white-label (mock-up)
v4-walkthrough    38.5 s   84 BPM calm      real app footage: Overview->Portal, connect, create, deposit, sweep, early payoff, portal home
v5-anything       18.0 s  150 BPM energy    montage: motorcycle, car, boat, home, RV, equipment (illustrative prices)
Rebuild (work/): python tts.py; python music.py vN (one at a time); loudnorm -> vN_norm.wav; python vrender.py vN h|v out.mp4 - vN_norm.wav; python verify.py
Sources: work/clips (from quasaria-autopay/tutorials/raw), work/shots (fresh live-app captures, capture.mjs), work/icons (Lucide, ISC), ../autopay-sizzle/shots (logo, wordmark).
Checks: verify.json (ffprobe/loudness/faststart), stt.json (faster-whisper transcripts), contact-sheets/*.png, work/txt_err_*.json (text outside safe area: none).
v6-family-boat    45.0 s   92 BPM uplift    story: fictional family dreams at the lake -> sets up an $80k/$16k boat deal in the app (real footage in laptop/device)
                                            -> vault + extra principal -> app's live estimate (~$67/mo, ~13 mo sooner, ~$3,700 less; illustrative, not guaranteed)
                                            -> picking up the boat -> golden hour on the water -> end card
v6 visuals: code-drawn flat-vector SVG layers (work/gen_art.py -> work/art/<h|v>/*.png via Chromium, work/rast.mjs); no image-generation tool was available.
v7-precious-metals 44.5 s 100 BPM warm      tokenized gold/silver as the down payment: store of value -> tokenized on Stellar -> "Pay down payment with"
                                            USDC|Gold|Silver|Platinum selector with live $ value (illustrative mock, simulated prices; feature not yet live
                                            on the app at render time) -> converted to USDC at deposit -> vault -> extra principal -> benefits -> "prices can
                                            move up or down" + "Illustrative. Testnet demo. Not investment advice." -> end card (v7 disclaimer adds
                                            "Not investment advice"). Metals drawn in code (work/gen_metals.py -> work/metals/*.png), generic emboss, no brand marks.
v8-business-equipment 44.5 s 104 BPM confident  fictional small-business owner puts a DOWN PAYMENT on a compact excavator and finances the rest
                                            with the seller (not bought outright): yard + crew -> "Not bought outright." $90,000 split into $18,000 down
                                            payment (-> vault) + $72,000 financed (8% · 72 mo) -> real app capture (Create agreement, Other ->
                                            "Equipment: compact excavator", $90,000 / $18,000 down) -> "Instead of a down payment that just disappears,
                                            his keeps working" -> USDC vault -> lender, extra principal -> app's live estimate panel (~$75/mo, ~5 months
                                            sooner, ~$1,400 less interest; ILLUSTRATIVE · NOT GUARANTEED) -> excavator digging, bigger crew, truck arriving -> end card
v8 visuals: code-drawn flat-vector owner/crew/excavator/truck (work/gen_art8.py -> work/art8/), same style as v6; no text, logos or real people.
v9-car-dealership 50.5 s 116 BPM energy      dealer's POV, fictional "Vantora Motors" (invented name + logo): glossy showroom -> customer picks a car ->
                                            real Seller-or-lender portal + Agreements -> Create agreement, Car preset $42,000 / $8,400 down -> Invite a buyer
                                            -> buyer Connect wallet -> down payment into the USDC vault -> keeper sweeps the yield monthly to the dealer as
                                            extra principal -> Payout ledger -> app estimate (~$35/mo, ~3 months sooner, ~$387 less interest; ILLUSTRATIVE ·
                                            NOT GUARANTEED) -> completion: paid off -> dealer releases the lien -> plan complete, down payment principal back to
                                            the buyer's wallet, only the yield went to the dealer -> drive-off -> dealer dashboard "Built for dealers." -> end card
v9 visuals: code-drawn showroom/cars/people + invented logo (work/gen_art9.py -> work/art9/); "Vantora Motors" pill is an overlay on real app captures (work/shots9, clips9).
v10-stellar-assets 50.8 s 108 BPM uplift    CONCEPT: verified Stellar assets (XLM, AQUA, issuer-verified USDC) toward the down payment -> only verified assets
                                            (issuer confirmed via home domain / stellar.toml; look-alike token rejected) -> asset picker MOCK labelled
                                            "Concept · testnet · not live" (28,000 XLM ≈ $8,400 at a simulated price; price can move until converted) -> at
                                            deposit, Stellar path payment converts to USDC at the live rate; vault holds USDC only -> keeper sweeps yield to the
                                            lender as extra principal, buyer pays each installment -> app estimate panel (~$35/mo, ~3 months sooner; ILLUSTRATIVE ·
                                            NOT GUARANTEED) -> paid off -> lender releases the lien -> plan complete, "$8,400 down payment back (USDC)" to the
                                            buyer's wallet (+ any unswept yield, not the original XLM), only the yield went to the lender -> end card
v10 visuals: code-drawn buyer (work/gen_art10.py -> work/art10/, same character as v9's customer); generic token glyphs drawn in PIL (no third-party logos).
