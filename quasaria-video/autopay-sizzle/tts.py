import sys, os, soundfile as sf
from kokoro_onnx import Kokoro
k=Kokoro('tts/kokoro-v1.0.onnx','tts/voices-v1.0.bin')
voice=sys.argv[1]; speed=float(sys.argv[2]); out=sys.argv[3]; os.makedirs(out,exist_ok=True)
Q='kwˌeɪzˈɑɹiə'
for l in open('vo_lines.txt'):
    i,t=l.strip().split('|',1)
    ph=k.tokenizer.phonemize(t.replace('Quasaria','QQQ'),'en-us')
    import re; ph=re.sub(r'k[^\s.,]*?QQQ|[^\s.,]*kjˈuː[^\s.,]*','',ph) if False else ph
    # phonemize the placeholder separately and replace
    qp=k.tokenizer.phonemize('QQQ','en-us').strip('. ')
    ph=ph.replace(qp,Q).replace('lˈiːən','lˈiːn').replace('tˈaɪɾəl','tˈaɪtəl')
    s,sr=k.create(ph,voice=voice,speed=speed,is_phonemes=True)
    sf.write(f'{out}/{i}.wav',s,sr); print(i, round(len(s)/sr,2), ph)
