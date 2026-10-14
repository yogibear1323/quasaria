# Quasaria sizzle renderer (PIL frames -> ffmpeg). Usage: python render.py h|v out.mp4 [t1,t2,...] (stills)
import sys, math, json, subprocess, numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
MODE=sys.argv[1] if len(sys.argv)>1 else 'h'
OUTF=sys.argv[2] if len(sys.argv)>2 else f'video_{MODE}.mp4'
ONLY=[float(x) for x in sys.argv[3].split(',')] if len(sys.argv)>3 else None
HZ=MODE=='h'
W,H=(1920,1080) if HZ else (1080,1920)
FPS=30; DUR=34.0; NF=int(DUR*FPS)
# text-safe rectangle (title safe 90% for 16:9; extra top/bottom room for platform UI on 9:16)
SAFE=(96,54,W-96,H-54) if HZ else (72,200,W-72,H-260)
GF='/usr/share/fonts/truetype/sand-box/google/'
OLD='/workspace/quasaria-video/shots/'; SH='shots/'
def font(kind,size,weight='Bold'):
    p={'head':GF+'Space Grotesk/SpaceGrotesk-VariableFont_wght.ttf','body':GF+'Inter/Inter-VariableFont_opsz,wght.ttf'}[kind]
    f=ImageFont.truetype(p,size)
    try: f.set_variation_by_name(weight)
    except Exception: pass
    return f
VIOLET=(124,92,255); CYAN=(34,211,238); LILAC=(196,181,253); WHITE=(245,246,250); MUTED=(165,170,192)
def clamp(x): return min(1.0,max(0.0,x))
def ease(x): x=clamp(x); return x*x*(3-2*x)
def eout(x): x=clamp(x); return 1-(1-x)**3
def eback(x):
    x=clamp(x); c=1.7; return 1+(c+1)*(x-1)**3+c*(x-1)**2
def env(t,a,b,fi=0.25,fo=0.2):
    if t<a or t>b: return 0.0
    return min(ease((t-a)/fi) if fi>0 else 1, ease((b-t)/fo) if fo>0 else 1)
def grad(w,h,c1=LILAC,c2=CYAN):
    x=np.linspace(0,1,w)[None,:]*np.ones((h,1)); arr=np.zeros((h,w,3))
    for i in range(3): arr[...,i]=c1[i]+(c2[i]-c1[i])*x
    return Image.fromarray(arr.astype(np.uint8))
# ---------------- background ----------------
def make_bg():
    yy,xx=np.mgrid[0:H,0:W].astype(np.float32); base=np.zeros((H,W,3),np.float32); base[:]=(6,6,10)
    def blob(cx,cy,r,col,a):
        d=np.exp(-(((xx-cx)**2+(yy-cy)**2)/(2*r*r)))
        for i in range(3): base[...,i]+=d*col[i]*a
    m=max(W,H)
    blob(W*0.15,H*0.12,m*0.32,VIOLET,0.13); blob(W*0.88,H*0.9,m*0.3,CYAN,0.07); blob(W*0.5,H*0.5,m*0.45,(40,28,96),0.22)
    v=1-0.6*(((xx/W-0.5)**2+(yy/H-0.5)**2)*2.2); base*=np.clip(v,0.3,1)[...,None]
    base+=np.random.default_rng(1).normal(0,1.3,base.shape)
    return Image.fromarray(np.clip(base,0,255).astype(np.uint8)).convert('RGBA')
BG=make_bg()
rng=np.random.default_rng(5)
NS=520
SX=rng.uniform(-1,1,NS)*W*0.9; SY=rng.uniform(-1,1,NS)*H*0.9; SZ=rng.uniform(0.05,1,NS)
SC=[(215,215,255) if rng.random()<0.7 else (160,235,255) for _ in range(NS)]
def warp_speed(t):
    # 0 = drifting dots, >0 = light-speed streaks
    return (0.25+2.2*ease(t/1.2)*(1-ease((t-3.3)/0.5))*1 + 0.0) if t<3.8 else \
           (0.15 if t<18.9 else (1.6*env(t,18.9,22.6,0.6,0.4)+0.15 if t<22.6 else (0.4+2.5*ease((t-23.5)/2.7) if t<26.3 else 0.12)))
def stars(fr,t):
    lay=Image.new('RGBA',(W,H),(0,0,0,0)); d=ImageDraw.Draw(lay)
    sp=warp_speed(t); cx,cy=W/2,H/2
    # z decreases over time (fly forward); integrate approx with t*base
    z=(SZ-((t*0.06)+ (0.0))%1.0)%1.0+0.03
    for i in range(NS):
        zi=z[i]; x=cx+SX[i]/zi*0.18; y=cy+SY[i]/zi*0.18
        if not (-50<x<W+50 and -50<y<H+50): continue
        b=clamp((1-zi)*1.1)
        L=sp*40*(1-zi)**2+0.5
        dx,dy=x-cx,y-cy; n=math.hypot(dx,dy)+1e-3
        x2=x-dx/n*L; y2=y-dy/n*L
        a=int(60+170*b); c=SC[i]+(a,)
        if L>2: d.line([(x2,y2),(x,y)],fill=c,width=2 if b>0.7 else 1)
        else:
            r=0.6+1.2*b; d.ellipse([x-r,y-r,x+r,y+r],fill=c)
    fr.alpha_composite(lay)
# ---------------- text helpers ----------------
TXT_ERR=[]
def text_im(txt,size,kind='head',weight='Bold',fill=WHITE,grad_from=None,track=0):
    f=font(kind,size,weight); tmp=ImageDraw.Draw(Image.new('L',(4,4)))
    bb=tmp.textbbox((0,0),txt,font=f); w=bb[2]-bb[0]+int(track*len(txt))+40; h=bb[3]-bb[1]+40
    m=Image.new('L',(w,h),0); dm=ImageDraw.Draw(m)
    if track:
        x=20-bb[0]
        for ch in txt: dm.text((x,20-bb[1]),ch,font=f,fill=255); x+=tmp.textlength(ch,font=f)+track
    else: dm.text((20-bb[0],20-bb[1]),txt,font=f,fill=255)
    col=np.zeros((h,w,3)); col[:]=fill
    if grad_from is not None and grad_from in txt:
        i=txt.index(grad_from); x1=20-bb[0]+tmp.textlength(txt[:i],font=f); x2=20-bb[0]+tmp.textlength(txt,font=f)
        xs=np.arange(w); g=np.clip((xs-x1)/max(1,x2-x1),0,1)
        for c in range(3): col[:,:,c]=np.where((xs>=x1-1)[None,:],LILAC[c]+(CYAN[c]-LILAC[c])*g[None,:],fill[c])
    im=Image.fromarray(col.astype(np.uint8)).convert('RGBA'); im.putalpha(m); return im
def glow(im,rad=16,s=0.45,col=VIOLET):
    a=im.getchannel('A').filter(ImageFilter.GaussianBlur(rad))
    g=Image.new('RGBA',im.size,col+(0,)); g.putalpha(a.point(lambda v:int(v*s)))
    out=Image.new('RGBA',im.size,(0,0,0,0)); out.alpha_composite(g); out.alpha_composite(im); return out
CACHE={}
def C(key,fn):
    if key not in CACHE: CACHE[key]=fn()
    return CACHE[key]
def scaled(im,s):
    if abs(s-1)<2e-3: return im
    return im.resize((max(1,int(im.width*s)),max(1,int(im.height*s))),Image.BICUBIC)
def fade(im,op):
    if op>=0.999: return im
    im=im.copy(); im.putalpha(im.getchannel('A').point(lambda v:int(v*op))); return im
def comp(fr,im,x,y):
    x,y=int(round(x)),int(round(y))
    if x>=0 and y>=0 and x+im.width<=W and y+im.height<=H: fr.alpha_composite(im,(x,y))
    else:
        cx0,cy0=max(0,-x),max(0,-y); cx1,cy1=min(im.width,W-x),min(im.height,H-y)
        if cx1>cx0 and cy1>cy0: fr.alpha_composite(im.crop((cx0,cy0,cx1,cy1)),(x+cx0,y+cy0))
def paste(fr,im,x,y,op=1.0,anchor='c',s=1.0,is_text=False,t=None,name=''):
    if op<=0.01: return
    im=scaled(im,s); im=fade(im,op)
    if anchor=='c': x-=im.width/2; y-=im.height/2
    elif anchor=='l': y-=im.height/2
    if is_text and op>0.05:
        bb=im.getchannel('A').point(lambda v:255 if v>40 else 0).getbbox()
        if bb:
            X0,Y0,X1,Y1=x+bb[0],y+bb[1],x+bb[2],y+bb[3]
            if X0<SAFE[0]-1 or Y0<SAFE[1]-1 or X1>SAFE[2]+1 or Y1>SAFE[3]+1:
                TXT_ERR.append((round(t,2),name,int(X0),int(Y0),int(X1),int(Y1)))
    comp(fr,im,x,y)
def T(fr,t,key,fn,x,y,op,anchor='c',s=1.0):
    paste(fr,C(key,fn),x,y,op,anchor,s,True,t,key if isinstance(key,str) else str(key))
# ---------------- logo assets ----------------
LOGO=Image.open(OLD+'logo.png').convert('RGBA')
LK=Image.open(OLD+'lockup.png').convert('RGBA')
A=np.array(LK.getchannel('A')); occ=A.max(0)>10
ws=next(i for i in range(520,len(occ)) if occ[i]); WORD=LK.crop((ws-4,60,1960,515))
WORD=WORD.crop(WORD.getchannel('A').getbbox())
def logo_pack(px):
    l=LOGO.resize((px,px),Image.LANCZOS); pad=int(px*0.7)
    big=Image.new('RGBA',(px+2*pad,px+2*pad),(0,0,0,0)); big.alpha_composite(l,(pad,pad))
    g1=Image.new('RGBA',big.size,VIOLET+(0,)); g1.putalpha(big.getchannel('A').filter(ImageFilter.GaussianBlur(px*0.14)).point(lambda v:int(v*0.95)))
    g2=Image.new('RGBA',big.size,CYAN+(0,)); g2.putalpha(big.getchannel('A').filter(ImageFilter.GaussianBlur(px*0.04)).point(lambda v:int(v*0.6)))
    return big,g1,g2
def draw_logo(fr,P,cx,cy,s,op,boost=0.0):
    big,g1,g2=P
    paste(fr,g1,cx,cy,op*min(1,0.55+boost),s=s*(1+0.05*boost)); paste(fr,g2,cx,cy,op*min(1,0.65+boost),s=s)
    paste(fr,big,cx,cy,op,s=s)
def flare():
    s=1000; yy,xx=np.mgrid[0:s,0:s].astype(np.float32)-s/2; r=np.sqrt(xx**2+yy**2)
    core=np.exp(-(r/(s*0.16))**2); streak=np.exp(-(yy/5)**2)*np.exp(-(np.abs(xx)/(s*0.32)))
    a=np.clip(core*0.5+streak*0.85,0,1); im=np.zeros((s,s,4),np.uint8)
    q=np.clip(r/(s/2),0,1)[...,None]; col=np.array([150,120,255])*(1-q)+np.array([34,211,238])*q
    im[...,:3]=np.clip(col*0.6+255*np.clip(streak,0,1)[...,None]*0.45,0,255); im[...,3]=(a*255).astype(np.uint8)
    return Image.fromarray(im).rotate(-18,resample=Image.BICUBIC)
FLARE=flare()
# ---------------- screenshot cards ----------------
BAR=40
def rmask(w,h,r):
    m=Image.new('L',(w*2,h*2),0); ImageDraw.Draw(m).rounded_rectangle([0,0,w*2-1,h*2-1],r*2,fill=255); return m.resize((w,h),Image.LANCZOS)
def chrome(cw,url):
    im=Image.new('RGBA',(cw,BAR),(16,16,26,255)); d=ImageDraw.Draw(im)
    for i,c in enumerate([(255,95,87),(254,188,46),(40,200,64)]): d.ellipse([16+i*20,BAR//2-5,26+i*20,BAR//2+5],fill=c+(190,))
    f=font('body',16,'Medium'); bw=min(cw-200,520); x0=(cw-bw)//2
    d.rounded_rectangle([x0,7,x0+bw,BAR-7],11,fill=(28,28,42,255)); d.text((cw//2,BAR//2),url,font=f,fill=(185,190,212),anchor='mm')
    return im
def card_frame(cw,ch):
    pad=80; w,h=cw+2*pad,ch+2*pad
    m=Image.new('L',(w,h),0); ImageDraw.Draw(m).rounded_rectangle([pad,pad,pad+cw,pad+ch],18,fill=255); m=m.filter(ImageFilter.GaussianBlur(34))
    g=grad(w,h,VIOLET,CYAN).convert('RGBA'); g.putalpha(m.point(lambda v:int(v*0.6)))
    bm=Image.new('L',(w,h),0); ImageDraw.Draw(bm).rounded_rectangle([pad-1,pad-1,pad+cw+1,pad+ch+1],19,outline=255,width=2)
    bc=grad(w,h,LILAC,CYAN).convert('RGBA'); bc.putalpha(bm.point(lambda v:int(v*0.75))); g.alpha_composite(bc); return g,pad
SHOTS={}
def shot(n):
    if n not in SHOTS: SHOTS[n]=Image.open(SH+n).convert('RGB')
    return SHOTS[n]
SAFE_Y={'home':2400,'lending':3500}   # never show page regions below these (they contain unrelated news text)
def card(fname,url,r0,r1,p,cw,ch):
    im=shot(fname); e=ease(p)
    cx=r0[0]+(r1[0]-r0[0])*e; cy=r0[1]+(r1[1]-r0[1])*e; w=r0[2]+(r1[2]-r0[2])*e
    w=min(w,im.width); h=w*ch/cw
    lim=min(im.height,SAFE_Y.get(fname.split('-')[0],10**6))
    x0=max(0,min(im.width-w,cx-w/2)); y0=max(0,min(lim-h,cy-h/2))
    crop=im.resize((cw,ch),Image.BICUBIC,box=(x0,y0,x0+w,y0+h))
    key=('fr',cw,ch)
    if key not in CACHE: CACHE[key]=(card_frame(cw,ch+BAR),rmask(cw,ch+BAR,18))
    (G,pad),M=CACHE[key]
    c=Image.new('RGBA',(cw,ch+BAR)); c.paste(C(('ch',cw,url),lambda:chrome(cw,url)),(0,0)); c.paste(crop,(0,BAR)); c.putalpha(M)
    out=G.copy(); out.alpha_composite(c,(pad,pad)); return out
# ---------------- scenes ----------------
URL='yogibear1323.github.io/quasaria'
def hook(fr,t):
    if t>3.85: return
    words=[('Trade',0.30,0),('at',0.58,0),('the',0.70,0),('speed',0.86,1),('of',1.12,1),('light.',1.24,1)]
    size=150 if HZ else 112
    f=font('head',size,'Bold'); tmp=ImageDraw.Draw(Image.new('L',(4,4))); sp=tmp.textlength(' ',font=f)
    lines=[[w for w in words if w[2]==0],[w for w in words if w[2]==1]]
    out=ease((t-3.3)/0.4); zs=1+0.12*out; gop=1-out
    for li,ln in enumerate(lines):
        tot=sum(tmp.textlength(w[0],font=f) for w in ln)+sp*(len(ln)-1)
        x=W/2-tot/2*zs; y=(H/2+((-95 if li==0 else 85) if HZ else (-75 if li==0 else 70)))
        y=H/2+(y-H/2)*zs
        for wd,ta,_ in ln:
            adv=tmp.textlength(wd,font=f)
            k=eout((t-ta)/0.22); op=clamp((t-ta)/0.12)*gop
            im=C(('hw',wd),lambda wd=wd:glow(text_im(wd,size,grad_from='light' if wd=='light.' else None),18,0.35))
            s=((1.3-0.3*k) if HZ else (1.18-0.18*k))*zs
            paste(fr,im,x+adv*zs/2,y,op,s=s,is_text=True,t=t,name='hook:'+wd)
            x+=(adv+sp)*zs
    # light streak sweep across at start
    if t<1.6:
        k=ease(t/1.4); paste(fr,FLARE,-200+k*(W+400),H*0.5,0.85*math.sin(math.pi*clamp(t/1.5)),s=1.1)
def logo_scene(fr,t):
    a,b=3.75,7.5
    if not (a-0.05<=t<=b): return
    lt=t-a; op=env(t,a,b,0.06,0.18)
    k=eback(lt/0.6); s=0.55+0.45*k+0.03*lt/3.75
    boost=max(0,1-lt/0.9)*0.9
    cy=H/2-110 if HZ else H/2-200
    paste(fr,FLARE,W/2,cy,op*(0.35+0.6*boost),s=0.8+0.6*eout(lt/1.2))
    draw_logo(fr,C('LB',lambda:logo_pack(300 if HZ else 340)),W/2,cy,s,op,boost)
    wop=env(t,a+0.45,b,0.35,0.18); wk=eout((lt-0.45)/0.6)
    wm=C('wordL',lambda:WORD.resize((600 if HZ else 640,int(WORD.height*(600 if HZ else 640)/WORD.width)),Image.LANCZOS))
    T(fr,t,'wordL',lambda:wm,W/2,cy+(285 if HZ else 320)+30*(1-wk),wop)
    sop=env(t,a+1.0,b,0.35,0.18); sk=eout((lt-1.0)/0.6)
    T(fr,t,'tag',lambda:text_im('STELLAR DECENTRALIZED EXCHANGE',30 if HZ else 34,'body','SemiBold',fill=LILAC,track=7),W/2,cy+(400 if HZ else 445)+20*(1-sk),sop)
FEATS=[ # start,end,file,url,(r0),(r1) for h ; (rv0),(rv1) for v ; label lines, grad word, sub
 (7.5,9.375,'trade','/trade',(1110,500,1080),(1090,470,960),(540,700,1080),(540,640,1040),['Swap.'],'Swap.','in seconds'),
 (9.375,11.25,'pools','/pools',(1010,520,1450),(935,560,1200),(540,760,1080),(540,700,1040),['Pools.'],'Pools.','provide liquidity'),
 (11.25,13.125,'lending','/lending',(1010,520,1450),(935,480,1200),(540,640,1080),(540,600,1040),['Lend &','borrow.'],'borrow.','supply · borrow · repay'),
 (13.125,15.0,'quests','/quests',(1010,520,1450),(925,460,1180),(540,650,1080),(540,600,1040),['Earn XP.'],'XP.','quests · levels · badges'),
]
def feature(fr,t,F,idx):
    a,b,fn,path,r0,r1,v0,v1,lines,gw,subt=F
    if not (a<=t<=b+0.02): return
    p=(t-a)/(b-a); lt=t-a
    op=env(t,a,b+0.02,0.08,0.06)
    if HZ:
        cw,ch=1060,600
        c=card(fn+'-h-full.png',URL+path,r0,r1,p,cw,ch)
        ex=eout(lt/0.35); cx=1290+220*(1-ex)-60*ease((lt-1.6)/0.3)
        paste(fr,c,cx,H/2,op,s=1.04-0.04*ex)
        tx=150; y0=H/2-(60 if len(lines)==2 else 10)
        T(fr,t,('kick',idx),lambda:text_im(f'0{idx+1}',26,'body','SemiBold',fill=CYAN,track=4),tx,y0-(55 if len(lines)==2 else 0)-100,env(t,a+0.05,b,0.15,0.06),'l')
        for i,l in enumerate(lines):
            k=eout((lt-0.06*i)/0.3)
            T(fr,t,('fl',l),lambda l=l:glow(text_im(l,118,grad_from=gw if gw in l else None),14,0.3),tx-20-60*(1-k),y0-(55 if len(lines)==2 else 0)+i*120,op*clamp((lt-0.06*i)/0.12),'l')
        k=eout((lt-0.25)/0.35)
        ytop=y0-(55 if len(lines)==2 else 0)
        T(fr,t,('fs',subt),lambda:text_im(subt,34,'body','Medium',fill=MUTED),tx-20-40*(1-k),ytop+(len(lines)-1)*120+100,env(t,a+0.25,b,0.15,0.06),'l')
    else:
        cw,ch=930,1000
        c=card(fn+'-v-full.png',URL+path,v0,v1,p,cw,ch)
        ex=eout(lt/0.35); cy=1180+200*(1-ex)
        paste(fr,c,W/2-60*ease((lt-1.6)/0.3),cy,op,s=1.04-0.04*ex)
        y0=330
        for i,l in enumerate(lines):
            k=eout((lt-0.06*i)/0.3)
            T(fr,t,('fl',l),lambda l=l:glow(text_im(l,120,grad_from=gw if gw in l else None),14,0.3),W/2,y0+i*125+40*(1-k),op*clamp((lt-0.06*i)/0.12))
        k=eout((lt-0.25)/0.35)
        T(fr,t,('fs',subt),lambda:text_im(subt,38,'body','Medium',fill=MUTED),W/2,y0+(len(lines)-1)*125+110+20*(1-k),env(t,a+0.25,b,0.15,0.06))
def keys(fr,t):
    a,b=15.0,18.75
    if not (a<=t<=b): return
    lt=t-a; op=env(t,a,b,0.15,0.15)
    ring=C('ring',lambda:orbit())
    paste(fr,ring,W/2,H/2,op*0.55,s=0.9+0.1*eout(lt/3.7))
    draw_logo(fr,C('LS',lambda:logo_pack(120)),W/2,H/2-(250 if HZ else 330),0.9+0.1*eout(lt/1.0),op*0.9,max(0,1-lt/0.8)*0.6)
    k=eout(lt/0.4); k2=eout((lt-0.35)/0.4)
    size=130 if HZ else 120
    T(fr,t,'k1',lambda:glow(text_im('You keep',size),18,0.3),W/2,H/2-30+40*(1-k),op*clamp(lt/0.15))
    T(fr,t,'k2',lambda:glow(text_im('your keys.',size,grad_from='keys.'),18,0.35),W/2,H/2+(110 if HZ else 105)+40*(1-k2),op*clamp((lt-0.35)/0.15))
    k3=eout((lt-1.2)/0.5)
    T(fr,t,'k3',lambda:text_im('Your wallet. Your signature.',34 if HZ else 38,'body','Medium',fill=MUTED),W/2,H/2+(235 if HZ else 230)+20*(1-k3),env(t,a+1.2,b,0.3,0.15))
def orbit():
    s=1500 if HZ else 1040
    m=Image.new('L',(s,s),0); d=ImageDraw.Draw(m); d.ellipse([50,s*0.32,s-50,s*0.68],outline=255,width=3)
    m=m.filter(ImageFilter.GaussianBlur(2)).rotate(-12,resample=Image.BICUBIC)
    g=grad(s,s,VIOLET,CYAN).convert('RGBA'); g.putalpha(m.point(lambda v:int(v*0.6))); return g
GRID=[('home','/'),('markets','/markets'),('trade','/trade'),('pools','/pools'),('lending','/lending'),('quests','/quests')]
def why(fr,t):
    a,b=18.75,22.5
    if not (a<=t<=b): return
    lt=t-a
    # part 1: grid of all screens zooming out + "All in one place."
    if t<20.25:
        op=env(t,a,20.25,0.1,0.2)
        cols,rows=(3,2) if HZ else (2,3)
        tw,th=(560,315) if HZ else (440,600)
        gx,gy=(40,40)
        z=1.25-0.25*eout(lt/1.3)
        for i,(n,pth) in enumerate(GRID):
            r,c=divmod(i,cols)
            x=W/2+(c-(cols-1)/2)*(tw+gx); y=H/2+(r-(rows-1)/2)*(th+gy+BAR)
            x=W/2+(x-W/2)*z; y=H/2+(y-H/2)*z
            src=n+('-h.png' if HZ else '-v.png')
            ci=C(('tile',n),lambda src=src,pth=pth:card(src,URL+pth,(W/2,H/2,W),(W/2,H/2,W),0,tw,th) if HZ else card(src,URL+pth,(540,800,1080),(540,800,1080),0,tw,th))
            d=clamp((lt-0.05*i)/0.25)
            paste(fr,ci,x,y,op*d*0.55,s=z*(0.92+0.08*eout(d)))
        # dark scrim behind text
        sc=C('scrim',lambda:scrim())
        paste(fr,sc,W/2,H/2,op)
        k=eout((lt-0.1)/0.35)
        T(fr,t,'w1',lambda:glow(text_im('All in one place.',120 if HZ else 104,grad_from='place.'),18,0.35),W/2,H/2+30*(1-k),op*clamp((lt-0.1)/0.15))
    else:
        # part 2: warp + Settled on Stellar / Fast. Low-fee.
        size=124 if HZ else 110
        if t<21.35:
            o=env(t,20.25,21.35,0.12,0.12); k=eout((t-20.25)/0.35)
            T(fr,t,'w2',lambda:glow(text_im('Settled on',size),18,0.3),W/2,H/2-70+30*(1-k),o)
            T(fr,t,'w3',lambda:glow(text_im('Stellar.',size,grad_from='Stellar.'),18,0.4),W/2,H/2+70+30*(1-k),o*clamp((t-20.35)/0.12))
        else:
            o=env(t,21.35,22.5,0.1,0.15)
            k1=eout((t-21.4)/0.3); k2=eout((t-21.85)/0.3)
            T(fr,t,'w4',lambda:glow(text_im('Fast.',size+20),18,0.3),W/2,H/2-75,o*clamp((t-21.4)/0.1),s=1.25-0.25*k1)
            T(fr,t,'w5',lambda:glow(text_im('Low-fee.',size+20,grad_from='Low-fee.'),18,0.4),W/2,H/2+85,o*clamp((t-21.85)/0.1),s=1.25-0.25*k2)
def scrim():
    s=(1500,700) if HZ else (1080,800)
    yy,xx=np.mgrid[0:s[1],0:s[0]].astype(np.float32)
    d=((xx-s[0]/2)/(s[0]/2))**2+((yy-s[1]/2)/(s[1]/2))**2
    a=np.clip(1-d,0,1)**0.8*235
    im=np.zeros((s[1],s[0],4),np.uint8); im[...,:3]=(6,6,12); im[...,3]=a.astype(np.uint8); return Image.fromarray(im)
def pill(txt,size):
    f=font('body',size,'SemiBold'); tl=ImageDraw.Draw(Image.new('L',(1,1))).textlength(txt,font=f)
    w=int(tl)+90; h=int(size*2.1); im=Image.new('RGBA',(w+24,h+24),(0,0,0,0))
    fill=Image.new('L',im.size,0); ImageDraw.Draw(fill).rounded_rectangle([12,12,12+w,12+h],h//2,fill=255)
    bg=Image.new('RGBA',im.size,(20,18,40,0)); bg.putalpha(fill.point(lambda v:int(v*0.85))); im.alpha_composite(bg)
    m=Image.new('L',im.size,0); ImageDraw.Draw(m).rounded_rectangle([12,12,12+w,12+h],h//2,outline=255,width=3)
    g=grad(*im.size,VIOLET,CYAN).convert('RGBA'); g.putalpha(m); im.alpha_composite(g)
    ImageDraw.Draw(im).text((12+w/2,12+h/2),txt,font=f,fill=WHITE,anchor='mm')
    return glow(im,12,0.5)
def cta(fr,t):
    a,b=22.5,26.25
    if not (a<=t<=b): return
    lt=t-a; op=env(t,a,b,0.12,0.12)
    k=eout(lt/0.4)
    if HZ:
        T(fr,t,'c1',lambda:glow(text_im('Try it on testnet.',132,grad_from='testnet.'),20,0.4),W/2,H/2-70+40*(1-k),op*clamp(lt/0.15),s=1+0.03*lt/3.75)
        k2=eout((lt-0.7)/0.45)
        T(fr,t,'c2',lambda:pill(URL,40),W/2,H/2+110+30*(1-k2),env(t,a+0.7,b,0.2,0.12))
    else:
        T(fr,t,'c1a',lambda:glow(text_im('Try it',140),20,0.4),W/2,H/2-170+40*(1-k),op*clamp(lt/0.15))
        T(fr,t,'c1b',lambda:glow(text_im('on testnet.',140,grad_from='testnet.'),20,0.4),W/2,H/2-20+40*(1-k),op*clamp((lt-0.1)/0.15))
        k2=eout((lt-0.7)/0.45)
        T(fr,t,'c2',lambda:pill(URL,40),W/2,H/2+170+30*(1-k2),env(t,a+0.7,b,0.2,0.12))
def endcard(fr,t):
    a=26.25
    if t<a: return
    lt=t-a; op=env(t,a,DUR+1,0.05,0.1)
    k=eback(lt/0.7); boost=max(0,1-lt/1.0)*0.9
    cy=H/2-150 if HZ else H/2-260
    paste(fr,FLARE,W/2,cy,op*(0.25+0.6*boost),s=0.7+0.4*eout(lt/1.5))
    draw_logo(fr,C('LE',lambda:logo_pack(230 if HZ else 280)),W/2,cy,0.7+0.3*k,op,boost)
    wk=eout((lt-0.35)/0.6)
    wm=C('wordE',lambda:WORD.resize((520 if HZ else 600,int(WORD.height*(520 if HZ else 600)/WORD.width)),Image.LANCZOS))
    T(fr,t,'wordE',lambda:wm,W/2,cy+(235 if HZ else 285)+25*(1-wk),env(t,a+0.35,DUR+1,0.4,0.1))
    uk=eout((lt-0.8)/0.6)
    T(fr,t,'eu1',lambda:text_im('Try it on testnet',34 if HZ else 38,'body','Medium',fill=LILAC),W/2,cy+(340 if HZ else 405)+20*(1-uk),env(t,a+0.8,DUR+1,0.4,0.1))
    T(fr,t,'eu2',lambda:text_im(URL,46 if HZ else 48,'body','SemiBold',fill=WHITE),W/2,cy+(405 if HZ else 475)+20*(1-uk),env(t,a+0.9,DUR+1,0.4,0.1))
    T(fr,t,'disc',lambda:text_im('Testnet preview. Not financial advice. Crypto involves risk.',26 if HZ else 30,'body','Regular',fill=(155,159,180)),W/2,SAFE[3]-30,env(t,a+1.3,DUR+1,0.5,0.1))
def flash(fr,t):
    a=0
    for at,g in [(3.75,0.85),(26.25,0.8),(7.5,0.25),(9.375,0.25),(11.25,0.25),(13.125,0.25),(15.0,0.3),(18.75,0.3),(20.25,0.2),(22.5,0.3)]:
        d=t-at
        if -0.03<=d<0.25: a=max(a,g*(1-d/0.25) if d>=0 else g*0.5)
    if a>0.01:
        fr.alpha_composite(Image.new('RGBA',(W,H),(225,215,255,int(255*a*0.55))))
def whip(arr,t):
    for at in [7.5,9.375,11.25,13.125,15.0,18.75,22.5]:
        d=t-at
        if -0.07<=d<0.07:
            k=int(40*(1-abs(d)/0.07))+4; acc=np.zeros_like(arr,dtype=np.float32)
            for sh in range(-k,k+1,max(1,k//4)): acc+=np.roll(arr,sh,axis=1); 
            arr=(acc/len(range(-k,k+1,max(1,k//4)))).astype(np.uint8)
    return arr
def render(t):
    fr=BG.copy(); stars(fr,t)
    hook(fr,t); logo_scene(fr,t)
    for i,F in enumerate(FEATS): feature(fr,t,F,i)
    keys(fr,t); why(fr,t); cta(fr,t); endcard(fr,t); flash(fr,t)
    g=min(1,t/0.25,(DUR-t)/0.8)
    if g<1: fr.alpha_composite(Image.new('RGBA',(W,H),(0,0,0,int(255*(1-max(0,g))))))
    arr=np.asarray(fr.convert('RGB')); arr=whip(arr,t)
    return arr
if ONLY:
    for tt in ONLY:
        Image.fromarray(render(tt)).save(f'frames/{MODE}_{tt:05.2f}.png')
    print('TXT_ERR',TXT_ERR); sys.exit(0)
cmd=['ffmpeg','-y','-loglevel','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-',
     '-i','mix.wav','-map','0:v','-map','1:a','-c:v','libx264','-preset','medium','-crf','20','-pix_fmt','yuv420p','-profile:v','high',
     '-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart',OUTF]
p=subprocess.Popen(cmd,stdin=subprocess.PIPE)
import time; t0=time.time()
for i in range(NF):
    p.stdin.write(render(i/FPS).tobytes())
    if i%150==0: print(i,round(time.time()-t0,1),flush=True)
p.stdin.close(); p.wait()
json.dump(TXT_ERR,open(f'txt_err_{MODE}.json','w'))
print('done',p.returncode,'TXT_ERR',len(TXT_ERR),TXT_ERR[:10])
