#!/bin/bash
# sequential autopay read-only recaptures from live gold app
set -x
cd /workspace/quasaria-video/autopay-sizzle && node shoot_light.mjs && node shoot_pan_light.mjs && node shoot_scroll_light.mjs
cd /workspace/quasaria-video/autopay-variations/work && node capture_light.mjs && node capture8_light.mjs && node capture9_light.mjs
cd /workspace/quasaria-video/autopay-people/work && node capture_light.mjs && node capclip_light.mjs
echo RECAPDONE
