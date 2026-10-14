# Quasaria Autopay sizzle (49.5 s)
Outputs: quasaria-autopay-sizzle-16x9.mp4 (1920x1080), quasaria-autopay-sizzle-9x16.mp4 (1080x1920),
contact-sheet-16x9.png, contact-sheet-9x16.png, poster-16x9.jpg / poster-9x16.jpg (frame at 5 s).
Pipeline derived from ../sizzle (same look: PIL frames piped to ffmpeg, Kokoro VO, numpy-synth 128 BPM music).

Rebuild (app dev server must run on a port other than 4173, here 5190: `cd /workspace/quasaria-autopay/app && npx vite --port 5190`):
  node shoot.mjs; node shoot_scroll.mjs; node shoot_pan.mjs; node logo.mjs     # fresh app captures + logo rasters
  .venv/bin/python tts.py af_heart 1.08 vo                                      # VO lines (vo_lines.txt) -> vo/*.wav
  .venv/bin/python audio.py                                                     # music + ducked VO -> mix.wav
  two-pass ffmpeg loudnorm I=-14 TP=-1.5 -> mix_norm.wav
  .venv/bin/python render.py h quasaria-autopay-sizzle-16x9.mp4 - mix_norm.wav
  .venv/bin/python render.py v quasaria-autopay-sizzle-9x16.mp4 - mix_norm.wav
  stills: .venv/bin/python render.py h|v x 1.5,9,20
Verify: stt.py (faster-whisper small.en), ocr.py (RapidOCR every 0.5 s -> ocr_frames.json),
  txt_err_{h,v}.json (overlay text outside safe area; empty), dev_{h,v}.json (device/card bounds per frame).
VO: Kokoro-82M (kokoro-onnx 0.6.1), af_heart, speed 1.08; "Quasaria" forced to /kwˌeɪzˈɑɹiə/; "lien" -> /lˈiːn/, "title" -> /tˈaɪtəl/.
Safe area: 16:9 96/54 px margins; 9:16 x 72..1008, y 200..1660.
Text uses solid colours only (no gradient text fills).
