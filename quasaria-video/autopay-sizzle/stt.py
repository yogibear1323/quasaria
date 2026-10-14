import sys,json
from faster_whisper import WhisperModel
m=WhisperModel('small.en',device='cpu',compute_type='int8')
import numpy as np,soundfile as sf,subprocess
raw=subprocess.run(['ffmpeg','-loglevel','error','-i',sys.argv[1],'-ac','1','-ar','16000','-f','f32le','-'],capture_output=True).stdout
audio=np.frombuffer(raw,np.float32)
segs,_=m.transcribe(audio,word_timestamps=True,beam_size=5,vad_filter=False,condition_on_previous_text=False)
out=[]
for s in segs:
    out.append({'start':round(s.start,2),'end':round(s.end,2),'text':s.text.strip()}); print(f'{s.start:6.2f}-{s.end:6.2f} {s.text.strip()}')
json.dump(out,open(sys.argv[2],'w'),indent=1)
txt=' '.join(o['text'] for o in out).lower()
print('BANK:', 'bank' in txt)
