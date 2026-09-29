#!/usr/bin/env python3
"""Post-process the merch build (needs Pillow):
 - tag print PNGs with their DPI (300, or 600 for *600dpi embroidery files);
 - write web-optimised WebP versions into frontend/public/merch-assets/{designs,mockups,hero}.
"""
import glob, os, sys
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PRINT = os.environ.get("MERCH_PRINT_DIR", "/workspace/quasaria-merch/print")
SHOTS = os.environ.get("MERCH_SHOTS_DIR", "/workspace/redesign-shots/merch")
WEB = os.path.join(ROOT, "frontend", "public", "merch-assets")
os.makedirs(os.path.join(WEB, "designs"), exist_ok=True)
os.makedirs(os.path.join(WEB, "mockups"), exist_ok=True)

def web(src, dst, max_side, q):
    im = Image.open(src)
    im.thumbnail((max_side, max_side), Image.LANCZOS)
    im.save(dst, "WEBP", quality=q, method=6)
    return os.path.getsize(dst)

total = 0
for f in sorted(glob.glob(os.path.join(PRINT, "png", "*.png")) + glob.glob(os.path.join(PRINT, "stickers", "png", "*.png"))):
    dpi = 600 if "600dpi" in os.path.basename(f) else 300
    im = Image.open(f); im.load()
    im.save(f, "PNG", dpi=(dpi, dpi), compress_level=7)
    name = os.path.basename(f)[:-4]
    if "/png/" in f.replace("\\", "/") and "stickers" not in f and "print-with-cutlines" not in name:
        total += web(f, os.path.join(WEB, "designs", name + ".webp"), 1000, 84)
for f in sorted(glob.glob(os.path.join(SHOTS, "mockup-*.png"))):
    total += web(f, os.path.join(WEB, "mockups", os.path.basename(f)[7:-4] + ".webp"), 900, 80)
hero = os.path.join(SHOTS, "merch-hero-v4.png")
if os.path.exists(hero):
    os.makedirs(os.path.join(WEB, "hero"), exist_ok=True)
    im = Image.open(hero).convert("RGB"); im.thumbnail((1800, 1800), Image.LANCZOS)
    dst = os.path.join(WEB, "hero", "merch-hero-v4.webp"); im.save(dst, "WEBP", quality=82, method=6); total += os.path.getsize(dst)
print(f"web assets: {total/1024/1024:.2f} MB")
