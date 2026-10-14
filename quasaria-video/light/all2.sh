#!/bin/bash
# re-render every light video (gold accent pass)
V=/workspace/quasaria-video
{
for v in v1 v2 v3 v4 v5 v6 v7 v8 v9 v10; do for m in h v; do echo "cd $V/autopay-variations/work && ./rend_light.sh $v $m"; done; done
for v in p55 p30 p15 p20 p45 p45v2; do for m in h v; do echo "cd $V/autopay-people/work && ./rend_light.sh $v $m"; done; done
for m in h v; do echo "cd $V/sizzle && python3 render_light.py $m /tmp/sz_$m.mp4 && ../light/mux.sh /tmp/sz_$m.mp4 quasaria-sizzle-\$([ $m = h ] && echo 16x9 || echo 9x16).mp4 quasaria-sizzle-\$([ $m = h ] && echo 16x9 || echo 9x16)-light.mp4"; done
for m in h v; do echo "cd $V/autopay-sizzle && python3 render_light.py $m /tmp/as_$m.mp4 && ../light/mux.sh /tmp/as_$m.mp4 quasaria-autopay-sizzle-\$([ $m = h ] && echo 16x9 || echo 9x16).mp4 quasaria-autopay-sizzle-\$([ $m = h ] && echo 16x9 || echo 9x16)-light.mp4"; done
echo "cd $V && python3 render_light.py h /tmp/r60h.mp4 && light/mux.sh /tmp/r60h.mp4 quasaria-sizzle-60s.mp4 quasaria-sizzle-60s-light.mp4"
echo "cd $V && python3 render_light.py v /tmp/r60v.mp4 && light/mux.sh /tmp/r60v.mp4 quasaria-sizzle-60s-vertical.mp4 quasaria-sizzle-60s-vertical-light.mp4"
while ! grep -q FIN $V/exchange-features/work/logs/demo_gold_v.log; do sleep 20; done >&2
for v in 01 02 03 04 05 06 07 08 09 10 11; do for m in h v; do echo "cd $V/exchange-features/work && ./rend_light.sh $v $m"; done; done
} | xargs -P4 -I{} bash -c "{} >/dev/null 2>&1; echo \"\$? {}\"" > $V/light/logs/all2.log
echo ALLDONE >> $V/light/logs/all2.log
