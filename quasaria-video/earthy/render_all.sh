#!/bin/bash
# render every earthy video (after capture_all.sh). Writes *-earthy.mp4 next to originals/-light; never overwrites them.
V=/workspace/quasaria-video; L=$V/earthy/logs
{
for v in 01 02 03 04 05 06 07 08 09 10 11; do for m in h v; do echo "cd $V/exchange-features/work && ./rend_earthy.sh $v $m"; done; done
for v in v1 v2 v3 v4 v5 v6 v7 v8 v9 v10; do for m in h v; do echo "cd $V/autopay-variations/work && ./rend_earthy.sh $v $m"; done; done
for v in p55 p30 p15 p20 p45 p45v2; do for m in h v; do echo "cd $V/autopay-people/work && ./rend_earthy.sh $v $m"; done; done
for m in h v; do A=$([ $m = h ] && echo 16x9 || echo 9x16); echo "cd $V/sizzle && python3 render_earthy.py $m /tmp/esz_$m.mp4 > $L/sz_$m.log 2>&1 && ../earthy/mux.sh /tmp/esz_$m.mp4 quasaria-sizzle-$A.mp4 quasaria-sizzle-$A-earthy.mp4"; done
for m in h v; do A=$([ $m = h ] && echo 16x9 || echo 9x16); echo "cd $V/autopay-sizzle && python3 render_earthy.py $m /tmp/eas_$m.mp4 > $L/as_$m.log 2>&1 && ../earthy/mux.sh /tmp/eas_$m.mp4 quasaria-autopay-sizzle-$A.mp4 quasaria-autopay-sizzle-$A-earthy.mp4"; done
echo "cd $V && python3 render_earthy.py h /tmp/er60h.mp4 > $L/r60h.log 2>&1 && earthy/mux.sh /tmp/er60h.mp4 quasaria-sizzle-60s.mp4 quasaria-sizzle-60s-earthy.mp4"
echo "cd $V && python3 render_earthy.py v /tmp/er60v.mp4 > $L/r60v.log 2>&1 && earthy/mux.sh /tmp/er60v.mp4 quasaria-sizzle-60s-vertical.mp4 quasaria-sizzle-60s-vertical-earthy.mp4"
} | xargs -P5 -I{} bash -c "{} >/dev/null 2>&1; echo \"\$? {}\"" > $L/render.log
echo ALLDONE >> $L/render.log
