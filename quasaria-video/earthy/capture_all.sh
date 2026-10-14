#!/bin/bash
# Earthy re-film: all read-only captures + testnet drives from the LIVE earthy sites (logo landed).
V=/workspace/quasaria-video; L=$V/earthy/logs; A=/workspace/quasaria-autopay
( cd $A && VIEW=web node scripts/tutorial-record-earthy.mjs > $L/tut_web.log 2>&1; echo "tutweb $?" >> $L/cap.log
  VIEW=mobile node scripts/tutorial-record-earthy.mjs > $L/tut_mob.log 2>&1; echo "tutmob $?" >> $L/cap.log ) &
( for M in home loop; do W=$V/autopay-$M/work; cd $W
   rm -f loop_earthy.jsonl; (MODE=$M LOG=$W/loop_earthy.jsonl node $V/earthy/driver/drive.mjs > $W/driveE.log 2>&1; echo '{"step":"end"}' >> $W/loop_earthy.jsonl) &
   sleep 2; node cap_earthy.mjs h > capE_h.log 2>&1 & node cap_earthy.mjs v > capE_v.log 2>&1; wait; echo "drive $M done" >> $L/cap.log
  done ) &
( cd $V/autopay-sizzle && node shoot_earthy.mjs > $L/as1.log 2>&1; echo "as1 $?" >> $L/cap.log; node shoot_pan_earthy.mjs > $L/as2.log 2>&1; echo "as2 $?" >> $L/cap.log; node shoot_scroll_earthy.mjs > $L/as3.log 2>&1; echo "as3 $?" >> $L/cap.log
  cd $V/autopay-variations/work && for s in capture capture8 capture9; do node ${s}_earthy.mjs > $L/va_$s.log 2>&1; echo "va $s $?" >> $L/cap.log; done
  cd $V/autopay-people/work && for s in capture capclip; do node ${s}_earthy.mjs > $L/pp_$s.log 2>&1; echo "pp $s $?" >> $L/cap.log; done ) &
( cd $V/exchange-features/work && node shoot2_earthy.mjs > $L/xf_shoot2.log 2>&1; echo "xf shoot2 $?" >> $L/cap.log
  for t in h v; do node shoot_demo_earthy.mjs $t > $L/xf_demo_$t.log 2>&1; echo "xf demo $t $?" >> $L/cap.log; done
  cd $V && node shoot2_earthy.mjs > $L/root_shoot2.log 2>&1; echo "root shoot2 $?" >> $L/cap.log ) &
wait; echo CAPDONE >> $L/cap.log
