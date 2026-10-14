import glob,json,re
from rapidocr_onnxruntime import RapidOCR
ocr=RapidOCR(); out={}
for f in sorted(glob.glob('frames/ocr/*.png')):
    r,_=ocr(f); out[f]=' | '.join(x[1] for x in (r or []) if float(x[2])>0.5)
json.dump(out,open('ocr_frames.json','w'),indent=1)
allt=' '.join(out.values()).lower()
print('frames',len(out),'BANK hits:',[k for k,v in out.items() if 'bank' in v.lower()])
for k in sorted(out):
    i=int(k[-7:-4]); 
    if i%2==0: print(k.split('/')[-1], f'{i/2:5.1f}s', out[k][:150])
