# purplecheck.py files... : % of purple/violet/magenta pixels (hue 245-330, S>0.3, V>0.25) over 12 sampled frames
import sys,subprocess,numpy as np
for v in sys.argv[1:]:
    if v.endswith('.jpg') or v.endswith('.png'):
        raw=subprocess.check_output(['ffmpeg','-v','error','-i',v,'-vf','scale=160:-2','-f','rawvideo','-pix_fmt','rgb24','-'])
    else:
        d=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',v]))
        raw=subprocess.check_output(['ffmpeg','-v','error','-i',v,'-vf',f'fps={12/d},scale=160:90:force_original_aspect_ratio=decrease','-f','rawvideo','-pix_fmt','rgb24','-'])
    a=np.frombuffer(raw,np.uint8).reshape(-1,3).astype(float)/255
    mx=a.max(1); mn=a.min(1); dl=mx-mn+1e-9; r,g,b=a.T
    h=np.where(mx==r,((g-b)/dl)%6,np.where(mx==g,(b-r)/dl+2,(r-g)/dl+4))*60
    s=dl/(mx+1e-9); m=(h>245)&(h<330)&(s>0.3)&(mx>0.25)
    print(f'{100*m.mean():6.2f}%  {v}')
