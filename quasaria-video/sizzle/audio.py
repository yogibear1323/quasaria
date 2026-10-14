# Self-synthesized 128 BPM music bed + VO mix for the Quasaria sizzle (no samples, no copyrighted material)
import numpy as np, soundfile as sf
SR=48000; DUR=34.0; N=int(SR*DUR); t=np.arange(N)/SR
rng=np.random.default_rng(11)
BPM=128; B=60/BPM; BAR=4*B
DROP=2*BAR            # 3.75 s  : logo hit / full beat
BREAK=10*BAR          # 18.75 s : "why" section (keep beat, add warp)
BUILD=12*BAR          # 22.5 s  : CTA build
END=14*BAR            # 26.25 s : end card impact
def midi(m): return 440*2**((m-69)/12)
def lp(x,fc):
    X=np.fft.rfft(x); f=np.fft.rfftfreq(len(x),1/SR); X/=np.sqrt(1+(f/fc)**4); return np.fft.irfft(X,len(x))
def hp(x,fc): return x-lp(x,fc)
def saw(f,tt,ph=0):
    # band-limited-ish saw via additive (12 partials)
    return sum(((-1)**(k+1))*np.sin(2*np.pi*f*k*tt+ph*k)/k for k in range(1,13))*0.6
# progression A minor: Am F C G (one chord per bar)
CH=[[57,60,64],[53,57,60],[48,52,55],[55,59,62]]
ROOT=[45,41,48,43]
def chord_at(s): return int(s//BAR)%4
mus=np.zeros((N,2))
# ---- sidechain envelope (kick-driven) ----
sc=np.ones(N)
def kick_times():
    out=[]; s=DROP
    while s<END-0.01:
        if not (BUILD+BAR*1.5<=s<END): out.append(s)
        s+=B
    return out
KT=kick_times()
for s in KT:
    n0=int(s*SR); n=int(B*SR); tt=np.arange(min(n,N-n0))/SR
    sc[n0:n0+len(tt)]=np.minimum(sc[n0:n0+len(tt)],1-0.75*np.exp(-tt*9))
# ---- pad (supersaw chords, sidechained) ----
pad=np.zeros((N,2))
for b in range(int(DUR/BAR)+1):
    s=b*BAR; ch=CH[b%4]; n0=int(s*SR); n1=min(N,int((s+BAR+0.3)*SR))
    if n0>=N: break
    tt=np.arange(n1-n0)/SR; e=np.minimum(1,tt/0.04)*np.minimum(1,(tt[-1]-tt+1e-3)/0.3)
    for m in ch+[ch[0]+12]:
        for det,pan in [(-0.12,0.15),(0,0.5),(0.12,0.85)]:
            sig=saw(midi(m)*2**(det/12),tt,rng.uniform(0,6))*e*0.022
            pad[n0:n1,0]+=sig*(1-pan); pad[n0:n1,1]+=sig*pan
for c in range(2): pad[:,c]=lp(pad[:,c],2600)
pad_env=np.interp(t,[0,DROP-0.2,DROP,BUILD,END-0.1,END,DUR],[0.35,0.6,1.0,1.0,0.7,1.0,0.0])
mus+=pad*(pad_env*sc)[:,None]
# intro filter sweep: separate low-passed copy for intro
# ---- pluck arp 16ths ----
arp=np.zeros((N,2)); step=B/4
for i in range(int(DUR/step)):
    s=i*step
    if s>=END: break
    ch=CH[chord_at(s)]; pat=[0,1,2,1,2,0,3,2]; idx=pat[i%8]
    m=(ch+[ch[0]+12])[idx]+12
    n0=int(s*SR); n=int(0.35*SR); n1=min(N,n0+n); tt=np.arange(n1-n0)/SR
    sig=(saw(midi(m),tt)*0.5+np.sin(2*np.pi*midi(m)*tt))*np.exp(-tt*14)
    g=0.045 if s>=DROP else 0.03*(s/DROP)
    pan=0.5+0.3*np.sin(i*0.9)
    arp[n0:n1,0]+=sig*g*(1-pan); arp[n0:n1,1]+=sig*g*pan
for c in range(2): arp[:,c]=lp(arp[:,c],5000)
mus+=arp
# ---- sub bass offbeat 8ths ----
bass=np.zeros(N)
for i in range(int(DUR/(B/2))):
    s=i*B/2
    if s<DROP or s>=END: continue
    if i%2==0: continue
    if BUILD+BAR*1.5<=s<END: continue
    f=midi(ROOT[chord_at(s)]-12); n0=int(s*SR); n=int(B/2*SR*0.9); tt=np.arange(min(n,N-n0))/SR
    e=np.minimum(1,tt/0.005)*np.exp(-tt*4)
    bass[n0:n0+len(tt)]+=(np.sin(2*np.pi*f*tt)+0.25*np.sin(2*np.pi*2*f*tt))*e*0.22
mus+=bass[:,None]
# ---- kick ----
kick=np.zeros(N)
for s in KT:
    n0=int(s*SR); n=int(0.4*SR); tt=np.arange(min(n,N-n0))/SR
    f=48+110*np.exp(-tt*35); ph=2*np.pi*np.cumsum(f)/SR
    kick[n0:n0+len(tt)]+=np.sin(ph)*np.exp(-tt*8)*0.55 + rng.standard_normal(len(tt))*np.exp(-tt*300)*0.05
mus+=kick[:,None]
# ---- clap on 2 & 4, open hats offbeat ----
perc=np.zeros((N,2))
for i in range(int(DUR/B)):
    s=i*B
    if s<DROP or s>=END or BUILD+BAR*1.5<=s: continue
    if i%2==1:
        n0=int(s*SR); n=int(0.25*SR); tt=np.arange(n)/SR
        nz=hp(rng.standard_normal(n),900)*np.exp(-tt*22)*0.12
        perc[n0:n0+n]+=nz[:,None]
    s2=s+B/2; n0=int(s2*SR); n=int(0.12*SR); tt=np.arange(min(n,N-n0))/SR
    hz=hp(rng.standard_normal(len(tt)),7000)*np.exp(-tt*30)*0.07
    perc[n0:n0+len(tt),0]+=hz*0.8; perc[n0:n0+len(tt),1]+=hz
mus+=perc
# ---- FX: risers, impacts, whooshes, snare roll ----
fx=np.zeros((N,2))
def riser(a,b,g):
    n0=int(a*SR); n1=int(b*SR); n=n1-n0; tt=np.linspace(0,1,n)
    nz=rng.standard_normal(n); nz=hp(nz,300); nz=lp(nz,8000)
    tone=np.sin(2*np.pi*np.cumsum(200+1800*tt**2)/SR)*0.3
    e=tt**2.2; sig=(nz*0.7+tone)*e*g
    fx[n0:n1,0]+=sig; fx[n0:n1,1]+=sig
def impact(a,g):
    n0=int(a*SR); n=int(2.5*SR); n=min(n,N-n0); tt=np.arange(n)/SR
    f=40+90*np.exp(-tt*10); ph=2*np.pi*np.cumsum(f)/SR
    sig=np.sin(ph)*np.exp(-tt*2.0)*g + lp(rng.standard_normal(n),2500)*np.exp(-tt*5)*g*0.35
    fx[n0:n0+n]+=sig[:,None]
def whoosh(a,g,l=0.5):
    n=int(l*SR); n0=max(0,int(a*SR)-n//2); tt=np.linspace(0,1,n)
    nz=lp(hp(rng.standard_normal(n),500),6000)*np.sin(np.pi*tt)**2
    pan=np.linspace(0.1,0.9,n)
    fx[n0:n0+n,0]+=nz*g*(1-pan); fx[n0:n0+n,1]+=nz*g*pan
def shimmer(a,g):
    for m,d in [(81,0),(84,0.08),(88,0.16),(93,0.24)]:
        n0=int((a+d)*SR); n=min(int(3*SR),N-n0); tt=np.arange(n)/SR
        sig=np.sin(2*np.pi*midi(m)*tt)*np.exp(-tt*1.3)*g
        fx[n0:n0+n,0]+=sig*(0.3+0.4*(m%2)); fx[n0:n0+n,1]+=sig*(0.7-0.4*(m%2))
riser(0.0,DROP,0.10); impact(0.05,0.25); impact(DROP,0.55); shimmer(DROP,0.025)
for a in [7.5,9.375,11.25,13.125,15.0,18.75,22.5]: whoosh(a,0.10)
riser(BUILD+BAR*0.5,END,0.12)
# snare roll in build
for i in range(16):
    s=BUILD+BAR*1.5+i*(BAR*0.5/16)*1.0
    s=BUILD+BAR*1.5+(BAR/2)*(1-(1-i/16)**1.0)
    n0=int(s*SR); n=int(0.08*SR); tt=np.arange(n)/SR
    fx[n0:n0+n]+=(hp(rng.standard_normal(n),1200)*np.exp(-tt*35)*0.05*(0.4+0.6*i/16))[:,None]
impact(END,0.6); shimmer(END,0.03)
mus+=fx
# ---- master section dynamics + fade ----
dyn=np.interp(t,[0,DROP,END,END+4,DUR-1.4,DUR],[0.75,1.0,1.0,0.8,0.6,0.0])
mus*=dyn[:,None]
# light reverb
ir_n=int(1.6*SR); it=np.arange(ir_n)/SR
ir=rng.standard_normal((ir_n,2))*np.exp(-it*4)[:,None]; ir[:int(0.012*SR)]=0
nf=1<<int(np.ceil(np.log2(N+ir_n)))
wet=np.stack([np.fft.irfft(np.fft.rfft(mus[:,c],nf)*np.fft.rfft(ir[:,c],nf),nf)[:N] for c in range(2)],1)
wet*=np.max(np.abs(mus))/np.max(np.abs(wet))
mus=mus*0.85+wet*0.2
# soft clip glue
mus=mus/np.max(np.abs(mus)); mus=np.tanh(mus*1.6)/np.tanh(1.6)
# ---- voiceover ----
import json
VO=json.load(open('vo_times.json'))
def readwav(p):
    x,sr=sf.read(p)
    if x.ndim>1: x=x.mean(1)
    return np.interp(np.arange(int(len(x)*SR/sr))/SR, np.arange(len(x))/sr, x)
vo=np.zeros(N); duck=np.zeros(N)
for k,st in VO.items():
    x=readwav(f'vo/{k}.wav'); n0=int(st*SR); n=min(len(x),N-n0); vo[n0:n0+n]+=x[:n]
    duck[max(0,n0-int(0.12*SR)):n0+n+int(0.15*SR)]=1
kern=np.hanning(int(0.25*SR)); kern/=kern.sum(); duck=np.convolve(duck,kern,'same')
# VO polish: gentle presence lift + compression-ish normalization
pres=vo+0.25*hp(lp(vo,6000),2500)
vo=pres/np.max(np.abs(pres))
mix=mus*(1-0.5*duck)[:,None]*0.5 + vo[:,None]*0.78
mix/=max(1.0,np.max(np.abs(mix))/0.95)
sf.write('mix.wav',mix.astype(np.float32),SR,subtype='PCM_16')
sf.write('music_only.wav',(mus*0.8).astype(np.float32),SR,subtype='PCM_16')
print('ok peak',np.max(np.abs(mix)))
