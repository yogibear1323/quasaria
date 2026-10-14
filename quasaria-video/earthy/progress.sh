#!/bin/bash
V=/workspace/quasaria-video
python3 - <<P
import json,glob,subprocess
V='$V'
r=[l.split(' ',1) for l in open(V+'/earthy/logs/render.log').read().split('\n') if l and l!='ALLDONE']
ok=[c for s,c in r if s=='0']; bad=[c for s,c in r if s!='0']
vids=sorted(glob.glob(V+'/**/*-earthy.mp4',recursive=True))
tut=sorted(glob.glob('/workspace/quasaria-autopay/app/public/tutorials/*/*-earthy.mp4'))
json.dump({'stage':'render','captures':'done','tutorials_earthy':len(tut),'promo_rendered':len(vids),'render_ok':len(ok),'render_failed':bad,'render_done':'ALLDONE' in open(V+'/earthy/logs/render.log').read(),'thumbs':'pending','swap_exchange':'pending','swap_autopay':'pending','files':[v.replace(V+'/','') for v in vids]},open('/workspace/earthy-shots/videos/progress.json','w'),indent=1)
P
