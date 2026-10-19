#!/usr/bin/env python3
"""Build the print-ready yeti bust cut-out for the merch line (needs: rembg, pymatting, opencv-contrib, Pillow, numpy).

  python3 scripts/merch/yeti-cutout.py /path/to/yeti-photo.jpg [OUT_DIR] [EDSR_x4.pb]

Source: the user's own yeti photo (1320 x 1953). The original is never modified.
Steps: (1) remove the small Stellar logo/lettering on the headband by inpainting (the chest logo is simply
cropped out of the bust), (2) rembg (isnet-general-use) matte + pymatting foreground estimation so no
background halo is left on the fur, (3) crop head + hood + shoulders and dissolve the shoulders with an
elliptical vignette, (4) optional x4 EDSR super-resolution (OpenCV dnn_superres) for print size.
Writes yeti-bust-cutout.webp (RGBA, used by yeti.mjs) and a lossless .png master to OUT_DIR (default: scripts/merch/assets).
"""
import os, sys
import cv2, numpy as np
from PIL import Image

src = sys.argv[1]
out_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")
edsr = sys.argv[3] if len(sys.argv) > 3 else os.environ.get("EDSR_PB", "")
os.makedirs(out_dir, exist_ok=True)

# ---- 1) headband retouch (logo + lettering on the navy band; polygon is in 3x crop coords of origin 440,90)
im = cv2.imread(src)
P = [(246,226),(270,184),(310,150),(345,132),(385,114),(470,104),(555,108),(572,134),(570,190),(556,226),(500,229),(400,233),(330,242),(268,250)]
poly = np.array([(440 + x / 3, 90 + y / 3) for x, y in P], np.int32)
m = np.zeros(im.shape[:2], np.uint8); cv2.fillPoly(m, [poly], 255)
g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.float32)
base = np.median(g[m > 0])
bright = ((g > base + 10) & (m > 0)).astype(np.uint8) * 255
bright = cv2.dilate(bright, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
mm = cv2.bitwise_and(bright, m)
clean = cv2.inpaint(im, mm, 10, cv2.INPAINT_TELEA)
rng = np.random.default_rng(3)
noise = cv2.GaussianBlur(rng.normal(0, 3.0, im.shape).astype(np.float32), (0, 0), 0.7)
clean = np.clip(clean.astype(np.float32) + noise * (cv2.GaussianBlur(mm, (0, 0), 2)[..., None] / 255.0), 0, 255).astype(np.uint8)
rgb = cv2.cvtColor(clean, cv2.COLOR_BGR2RGB)

# ---- 2) matte + clean foreground colours
from rembg import remove, new_session
from pymatting import estimate_foreground_ml
# work on the bust region only (matting the whole 1320x1953 frame is very slow)
PX0, PY0, PX1, PY1 = 200, 30, 1040, 660
rgb = rgb[PY0:PY1, PX0:PX1]
print("matting", rgb.shape, flush=True)
cut = remove(Image.fromarray(rgb), session=new_session("isnet-general-use"), alpha_matting=True,
             alpha_matting_foreground_threshold=240, alpha_matting_background_threshold=15, alpha_matting_erode_size=8)
alpha = np.array(cut)[..., 3].astype(np.float32) / 255.0
print('foreground', flush=True)
fg = estimate_foreground_ml(rgb.astype(np.float64) / 255.0, alpha.astype(np.float64))
# ---- 3) bust crop + shoulder vignette
X0, Y0 = PX0, PY0  # all coordinates below are photo coordinates; arrays start at (PX0, PY0)
h, w = alpha.shape
yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
cx, cy, rx, ry = 665 - PX0, 330 - PY0, 430, 335
d = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
t = np.clip((1.0 - d) / 0.16, 0, 1); v = t * t * (3 - 2 * t)
# nothing below the neckline (keeps the chest logo out of frame)
yb = np.clip((600 - PY0 - yy) / 70.0, 0, 1); v *= yb * yb * (3 - 2 * yb)
alpha = alpha * v
ys, xs = np.where(alpha > 0.02)
b = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
fg = fg[b[1]:b[3], b[0]:b[2]]; alpha = alpha[b[1]:b[3], b[0]:b[2]]
print('upscale', fg.shape, flush=True)
# ---- 4) x4 super-resolution (colour) + Lanczos alpha
fg8 = (np.clip(fg, 0, 1) * 255).astype(np.uint8)
if edsr and os.path.exists(edsr):
    sr = cv2.dnn_superres.DnnSuperResImpl_create(); sr.readModel(edsr); sr.setModel("edsr", 4)
    big = sr.upsample(cv2.cvtColor(fg8, cv2.COLOR_RGB2BGR)); big = cv2.cvtColor(big, cv2.COLOR_BGR2RGB)
else:
    big = cv2.resize(fg8, None, fx=4, fy=4, interpolation=cv2.INTER_LANCZOS4)
a_big = cv2.resize(alpha, (big.shape[1], big.shape[0]), interpolation=cv2.INTER_CUBIC)
a_big = np.clip(cv2.GaussianBlur(a_big, (0, 0), 1.2), 0, 1)
rgba = np.dstack([big, (a_big * 255).astype(np.uint8)])
im_out = Image.fromarray(rgba, "RGBA")
im_out.save(os.path.join(out_dir, "yeti-bust-cutout.png"), optimize=True)  # lossless master (~5 MB, not committed)
im_out.save(os.path.join(out_dir, "yeti-bust-cutout.webp"), "WEBP", quality=95, method=6, exact=True)  # committed copy the build reads
print("native bust px:", fg.shape[1], "x", fg.shape[0], "-> output", big.shape[1], "x", big.shape[0])
