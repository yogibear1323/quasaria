# thumb.py orig.mp4 orig_poster.jpg|- light.mp4 out.jpg
# Finds the poster's timestamp in the original video (frame match), grabs the same moment from the light video.
import sys,subprocess,numpy as np,io
from PIL import Image
ov,op,lv,out=sys.argv[1:5]
def dur(v): return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',v]))
def frames(v,fps):
    raw=subprocess.check_output(['ffmpeg','-v','error','-i',v,'-vf',f'fps={fps},scale=64:64','-f','rawvideo','-pix_fmt','rgb24','-'])
    a=np.frombuffer(raw,np.uint8).reshape(-1,64,64,3).astype(np.float32); return a
D=dur(lv)
if op!='-':
    fps=4; F=frames(ov,fps); P=np.asarray(Image.open(op).convert('RGB').resize((64,64))).astype(np.float32)
    e=((F-P)**2).mean((1,2,3)); t=(int(e.argmin())+0.5)/fps
else: t=D-1.5
t=min(max(t,0.1),D-0.1)
w=subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=width','-of','csv=p=0',lv]).decode().strip()
subprocess.run(['ffmpeg','-v','error','-y','-ss',f'{t:.2f}','-i',lv,'-frames:v','1','-q:v','3',out],check=True)
print(out,'t=',round(t,2))
