import numpy as np, wave, subprocess
SR=48000; DUR=60.0; N=int(SR*DUR)
t=np.arange(N)/SR
rng=np.random.default_rng(7)
def midi(m): return 440*2**((m-69)/12)
def onepole(x,fc):
    # simple lowpass via FFT-domain smooth rolloff (fast)
    X=np.fft.rfft(x); f=np.fft.rfftfreq(len(x),1/SR)
    X/= np.sqrt(1+(f/fc)**4); return np.fft.irfft(X,len(x))
def env_adsr(n,a,r):
    e=np.ones(n); na=min(int(a*SR),n//2); nr=min(int(r*SR),n//2)
    e[:na]=np.linspace(0,1,na)**2; e[-nr:]*=np.linspace(1,0,nr)**2; return e
BPM=90; beat=60/BPM; bar=4*beat
# chord progression (every 2 bars): Fmaj7, Am7, Dm9, Bbmaj7
chords=[[53,57,60,64],[57,60,64,67],[50,53,57,60,64],[46,50,53,57]]
pad=np.zeros((N,2))
seg=2*bar
k=0; s=0.0
while s<DUR:
    ch=chords[k%4]; n0=int(s*SR); n1=min(N,int((s+seg+1.5)*SR)); n=n1-n0
    tt=np.arange(n)/SR; e=env_adsr(n,1.6,1.8)
    for m in ch:
        for det,pan in [(-0.07,0.2),(0.0,0.5),(0.07,0.8)]:
            f=midi(m)*2**(det/12)
            sig=sum((0.5**h)*np.sin(2*np.pi*f*(h+1)*tt+rng.uniform(0,6)) for h in range(4))
            pad[n0:n1,0]+=sig*e*(1-pan)*0.03; pad[n0:n1,1]+=sig*e*pan*0.03
    # bass
    f=midi(ch[0]-12); pad[n0:n1]+= (np.sin(2*np.pi*f*tt)*e*0.09)[:,None]
    k+=1; s+=seg
for c in range(2): pad[:,c]=onepole(pad[:,c],1800)
# slow filter swell: amplitude LFO
pad*= (0.85+0.15*np.sin(2*np.pi*t/9.0))[:,None]
# arp plucks 14-48s and 54-58
arp=np.zeros((N,2))
step=beat/2
for i in range(int(DUR/step)):
    st=i*step
    if not (14.0<=st<47.5 or 6.0<=st<14.0 and i%2==0): continue
    ch=chords[int(st//seg)%4]; m=ch[(i*3)%len(ch)]+12+(12 if i%8==7 else 0)
    n0=int(st*SR); n=int(1.2*SR); n1=min(N,n0+n); tt=np.arange(n1-n0)/SR
    sig=np.sin(2*np.pi*midi(m)*tt)*np.exp(-tt*5)+0.3*np.sin(2*np.pi*midi(m)*2*tt)*np.exp(-tt*9)
    g=0.05 if st>=14 else 0.03
    pan=0.5+0.35*np.sin(i*1.3)
    arp[n0:n1,0]+=sig*g*(1-pan); arp[n0:n1,1]+=sig*g*pan
# soft kick pulse 14-47.5
kick=np.zeros(N)
for i in range(int(DUR/beat)):
    st=i*beat
    if not (14.0<=st<47.4): continue
    n0=int(st*SR); n=int(0.5*SR); tt=np.arange(min(n,N-n0))/SR
    f=45+70*np.exp(-tt*30); ph=2*np.pi*np.cumsum(f)/SR
    kick[n0:n0+len(tt)]+=np.sin(ph)*np.exp(-tt*9)*0.28
# shaker/hat soft offbeats 22-47
hat=np.zeros(N)
hn=onepole(rng.standard_normal(N),12000)-onepole(rng.standard_normal(N),6000)*0
for i in range(int(DUR/beat)):
    st=i*beat+beat/2
    if not (22.0<=st<47.4): continue
    n0=int(st*SR); n=int(0.08*SR); tt=np.arange(n)/SR
    hat[n0:n0+n]+=rng.standard_normal(n)*np.exp(-tt*60)*0.025
hat=hat-onepole(hat,5000)
# riser 0-2.2 + impact at 2.2; whooshes
fx=np.zeros(N)
def whoosh(at,length,gain):
    n=int(length*SR); n0=int((at-length*0.8)*SR); n0=max(0,n0); tt=np.linspace(0,1,n)
    nz=rng.standard_normal(n); nz=onepole(nz,3000)
    e=np.sin(np.pi*tt)**2*tt
    fx[n0:n0+n]+=nz*e*gain
whoosh(2.2,2.6,0.12)
for a in [6.0,14.0,38.0,48.0,54.0]: whoosh(a,1.2,0.05)
def impact(at,gain):
    n0=int(at*SR); n=int(3*SR); tt=np.arange(n)/SR
    f=38+50*np.exp(-tt*12); ph=2*np.pi*np.cumsum(f)/SR
    fx[n0:n0+n]+=np.sin(ph)*np.exp(-tt*2.2)*gain
impact(2.2,0.35); impact(54.2,0.3)
# shimmer on logo: high sine cluster
for m,d in [(84,0.0),(88,0.15),(91,0.3),(96,0.45)]:
    n0=int((2.2+d)*SR); n=int(3.5*SR); tt=np.arange(n)/SR
    fx[n0:n0+n]+=np.sin(2*np.pi*midi(m)*tt)*np.exp(-tt*1.4)*0.02
    n0=int((54.3+d)*SR); fx[n0:n0+n]+=np.sin(2*np.pi*midi(m)*tt)*np.exp(-tt*1.4)*0.02
mus=pad+arp+(kick+hat+fx)[:,None]
# section dynamics
dyn=np.interp(t,[0,2,6,14,47,48.3,53.5,54.2,58,60],[0.5,0.8,0.85,1.0,1.0,0.7,0.8,1.0,0.8,0.0])
mus*=dyn[:,None]
# reverb (FFT convolution with decaying noise IR)
ir_n=int(2.2*SR); it=np.arange(ir_n)/SR
ir=rng.standard_normal((ir_n,2))*np.exp(-it*3.2)[:,None]; ir[:int(0.01*SR)]=0
L=N+ir_n; nf=1<<int(np.ceil(np.log2(L)))
wet=np.stack([np.fft.irfft(np.fft.rfft(mus[:,c],nf)*np.fft.rfft(ir[:,c],nf),nf)[:N] for c in range(2)],1)
wet/=np.max(np.abs(wet))/np.max(np.abs(mus))
mus=mus*0.75+wet*0.35
# voiceover
def readwav(p):
    w=wave.open(p); sr=w.getframerate(); x=np.frombuffer(w.readframes(w.getnframes()),np.int16)/32768.0
    # resample to SR
    ti=np.arange(int(len(x)*SR/sr))/SR; return np.interp(ti,np.arange(len(x))/sr,x)
VO={ '01':2.3,'02':6.4,'03':9.2,'04':14.5,'05':19.75,'06':25.45,'07':30.45,'08':34.55,'09':38.6,'10':43.5,'11':48.6,'12':55.0}
vo=np.zeros(N); duck=np.zeros(N)
for k,st in VO.items():
    x=readwav(f'vo/{k}.wav'); n0=int(st*SR); n=min(len(x),N-n0); vo[n0:n0+n]+=x[:n]
    duck[max(0,n0-int(0.25*SR)):n0+n+int(0.3*SR)]=1
# smooth duck
kern=np.hanning(int(0.4*SR)); kern/=kern.sum(); duck=np.convolve(duck,kern,'same')
mus*= (1-0.55*duck)[:,None]
vo=vo/np.max(np.abs(vo))*0.9
# gentle warmth on VO: slight low shelf lift absent; leave natural
out=mus/np.max(np.abs(mus))*0.42 + vo[:,None]*0.8
fade=np.ones(N); fade[-int(1.5*SR):]=np.linspace(1,0,int(1.5*SR))
out*=fade[:,None]
out/=max(1.0,np.max(np.abs(out))/0.97)
np.save('/tmp/mus.npy',mus)
def wr(p,x):
    w=wave.open(p,'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((np.clip(x,-1,1)*32767).astype(np.int16).tobytes()); w.close()
wr('mix_raw.wav',out)
m2=mus/np.max(np.abs(mus))*0.8*fade[:,None]; wr('music_only.wav',m2)
print('ok')
