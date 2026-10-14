# Quasaria sizzle (34 s)
Outputs: quasaria-sizzle-16x9.mp4 (1920x1080), quasaria-sizzle-9x16.mp4 (1080x1920), contact-sheet-16x9.png, contact-sheet-9x16.png
Rebuild: . .venv/bin/activate; node shoot.mjs; python tts.py af_heart 1.08 vo; python audio.py;
  python render.py h quasaria-sizzle-16x9.mp4; python render.py v quasaria-sizzle-9x16.mp4;
  then loudnorm mix.wav -> mix_norm.wav (-14 LUFS) and remux (see report).
VO: Kokoro-82M (kokoro-onnx 0.6.1), voice af_heart, speed 1.08; "Quasaria" forced to /kwˌeɪzˈɑɹiə/.
Music: self-synthesized in numpy (audio.py), 128 BPM A minor, no samples.
render.py records any text outside the safe area on every frame (txt_err_h.json / txt_err_v.json; both empty).
