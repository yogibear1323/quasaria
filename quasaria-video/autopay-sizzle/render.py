# Quasaria Autopay sizzle renderer (PIL frames -> ffmpeg). Usage: python render.py h|v out.mp4 [t1,t2,...] (stills)
# Derived from ../sizzle/render.py. No gradient text: accents are solid colors.
import sys, os, math, json, glob, subprocess, numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
MODE=sys.argv[1] if len(sys.argv)>1 else 'h'
OUTF=sys.argv[2] if len(sys.argv)>2 else f'video_{MODE}.mp4'
ONLY=[float(x) for x in sys.argv[3].split(',')] if len(sys.argv)>3 and sys.argv[3] not in ('-','x') else None
AUD=sys.argv[4] if len(sys.argv)>4 else 'mix_norm.wav'
HZ=MODE=='h'
W,H=(1920,1080) if HZ else (1080,1920)
FPS=30; DUR=49.5; NF=int(DUR*FPS)
SAFE=(96,54,W-96,H-54) if HZ else (72,200,W-72,H-260)
GF='/usr/share/fonts/truetype/sand-box/google/'; SH='shots/'
def font(kind,size,weight='Bold'):
    p={'head':GF+'Space Grotesk/SpaceGrotesk-VariableFont_wght.ttf','body':GF+'Inter/Inter-VariableFont_opsz,wght.ttf'}[kind]
    f=ImageFont.truetype(p,size)
    try: f.set_variation_by_name(weight)
    except Exception: pass
    return f
VIOLET=(124,92,255); CYAN=(34,211,238); LILAC=(196,181,253); WHITE=(245,246,250); MUTED=(165,170,192); ICE=(165,243,252)
def clamp(x): return min(1.0,max(0.0,x))
def ease(x): x=clamp(x); return x*x*(3-2*x)
def eout(x): x=clamp(x); return 1-(1-x)**3
def eio(x): x=clamp(x); return 4*x**3 if x<0.5 else 1-(-2*x+2)**3/2
def eback(x):
    x=clamp(x); c=1.7; return 1+(c+1)*(x-1)**3+c*(x-1)**2
def env(t,a,b,fi=0.25,fo=0.2):
    if t<a or t>b: return 0.0
    return min(ease((t-a)/fi) if fi>0 else 1, ease((b-t)/fo) if fo>0 else 1)
def grad(w,h,c1=LILAC,c2=CYAN):
    x=np.linspace(0,1,w)[None,:]*np.ones((h,1)); arr=np.zeros((h,w,3))
    for i in range(3): arr[...,i]=c1[i]+(c2[i]-c1[i])*x
    return Image.fromarray(arr.astype(np.uint8))
# ---------------- sections ----------------
BARL=60/128*4
S_HOOK,S_LOGO,S1,S2,S3,S4,S5,S6,S7,S_DEAL,S_CTA,S_END=[b*BARL for b in (0,2,4,6,8,10,12,15,17,19,22,24)]
CUTS=[S_LOGO,S1,S2,S3,S4,S5,S6,S7,S_DEAL,S_CTA,S_END]
# ---------------- background ----------------
def make_bg():
    yy,xx=np.mgrid[0:H,0:W].astype(np.float32); base=np.zeros((H,W,3),np.float32); base[:]=(5,5,9)
    def blob(cx,cy,r,col,a):
        d=np.exp(-(((xx-cx)**2+(yy-cy)**2)/(2*r*r)))
        for i in range(3): base[...,i]+=d*col[i]*a
    m=max(W,H); blob(W*0.5,H*0.5,m*0.45,(36,26,90),0.18)
    v=1-0.6*(((xx/W-0.5)**2+(yy/H-0.5)**2)*2.2); base*=np.clip(v,0.3,1)[...,None]
    base+=np.random.default_rng(1).normal(0,1.3,base.shape)
    return Image.fromarray(np.clip(base,0,255).astype(np.uint8)).convert('RGBA')
BG=make_bg()
def glow_sprite(px,col,a):
    yy,xx=np.mgrid[0:px,0:px].astype(np.float32)-px/2; d=np.exp(-((xx**2+yy**2)/(2*(px*0.2)**2)))
    im=np.zeros((px,px,4),np.uint8); im[...,:3]=col; im[...,3]=np.clip(d*a*255,0,255).astype(np.uint8); return Image.fromarray(im)
GS=int(max(W,H)*0.9)
GV=glow_sprite(GS,VIOLET,0.30); GC=glow_sprite(GS,CYAN,0.16); GV2=glow_sprite(int(GS*0.7),(150,110,255),0.16)
def glows(fr,t):
    m=max(W,H)
    comp(fr,GV,W*0.18+m*0.08*math.sin(t*0.21)-GS/2,H*0.15+m*0.06*math.cos(t*0.17)-GS/2)
    comp(fr,GC,W*0.85+m*0.07*math.cos(t*0.19)-GS/2,H*0.88+m*0.06*math.sin(t*0.23)-GS/2)
    s2=GV2.width; comp(fr,GV2,W*0.75+m*0.1*math.sin(t*0.13+1)-s2/2,H*0.25+m*0.08*math.sin(t*0.16+2)-s2/2)
rng=np.random.default_rng(5)
NS=560
SX=rng.uniform(-1,1,NS)*W*0.9; SY=rng.uniform(-1,1,NS)*H*0.9; SZ=rng.uniform(0.05,1,NS)
SC=[(215,215,255) if rng.random()<0.7 else (160,235,255) for _ in range(NS)]
STW=rng.uniform(0,6.28,NS)
def warp_speed(t):
    if t<S_LOGO: return 0.2+1.6*ease(t/1.2)*(1-ease((t-3.2)/0.5))
    if S_CTA-1.2<t<S_END: return 0.15+2.4*ease((t-(S_CTA-1.2))/(S_END-S_CTA+1.0))
    return 0.12
def zpos(t):
    # integrate a gentle forward drift plus warp bursts
    return t*0.035+0.25*ease(t/3.5)+0.5*ease((t-(S_CTA-1.2))/(S_END-S_CTA+1.2))
STREAKS=[(1.2,0.15,0.08,1),(9.6,0.62,0.12,-1),(17.0,0.08,0.7,1),(25.6,0.7,0.06,-1),(30.4,0.2,0.1,1),(38.6,0.66,0.1,-1),(47.0,0.15,0.12,1)]
def stars(fr,t):
    lay=Image.new('RGBA',(W,H),(0,0,0,0)); d=ImageDraw.Draw(lay)
    sp=warp_speed(t); cx,cy=W/2,H/2
    z=(SZ-zpos(t)%1.0)%1.0+0.03
    for i in range(NS):
        zi=z[i]; x=cx+SX[i]/zi*0.18; y=cy+SY[i]/zi*0.18
        if not (-50<x<W+50 and -50<y<H+50): continue
        b=clamp((1-zi)*1.1)*(0.75+0.25*math.sin(t*2.1+STW[i]))
        L=sp*40*(1-zi)**2+0.5
        dx,dy=x-cx,y-cy; n=math.hypot(dx,dy)+1e-3
        x2=x-dx/n*L; y2=y-dy/n*L
        a=int(50+160*b); c=SC[i]+(a,)
        if L>2: d.line([(x2,y2),(x,y)],fill=c,width=2 if b>0.7 else 1)
        else:
            r=0.6+1.1*b; d.ellipse([x-r,y-r,x+r,y+r],fill=c)
    # occasional light streaks (shooting stars)
    for (t0,fx,fy,dr) in STREAKS:
        k=(t-t0)/0.9
        if 0<=k<=1:
            L=W*0.22; ang=math.radians(24 if dr>0 else 156)
            hx=W*fx+dr*k*W*0.45; hy=H*fy+k*W*0.45*math.tan(math.radians(24))*0.6
            al=math.sin(math.pi*k)
            for j in range(14):
                f0=j/14; f1=(j+1)/14
                p0=(hx-math.cos(ang)*L*f0*dr*dr, hy-math.sin(ang)*L*f0*0.6); p1=(hx-math.cos(ang)*L*f1, hy-math.sin(ang)*L*f1*0.6)
                d.line([p0,p1],fill=(200,230,255,int(200*al*(1-f0))),width=2)
    fr.alpha_composite(lay)
# ---------------- text helpers ----------------
TXT_ERR=[]; DEV=[]
def text_im(txt,size,kind='head',weight='Bold',fill=WHITE,accent=None,acol=CYAN,track=0):
    """Solid-color text; optional accent substring drawn in a second SOLID color (no gradient fill)."""
    f=font(kind,size,weight); tmp=ImageDraw.Draw(Image.new('L',(4,4)))
    bb=tmp.textbbox((0,0),txt,font=f); asc,desc=f.getmetrics(); top=int(asc*0.22)
    w=bb[2]-bb[0]+int(track*len(txt))+40; h=asc+desc-top+40; bb=(bb[0],top,bb[2],bb[3])
    im=Image.new('RGBA',(w,h),(0,0,0,0)); d=ImageDraw.Draw(im)
    ai=txt.index(accent) if accent and accent in txt else len(txt)
    x=20-bb[0]
    if track:
        for i,ch in enumerate(txt): d.text((x,20-bb[1]),ch,font=f,fill=(acol if i>=ai else fill)+(255,)); x+=tmp.textlength(ch,font=f)+track
    else:
        d.text((x,20-bb[1]),txt[:ai],font=f,fill=fill+(255,))
        if ai<len(txt): d.text((x+tmp.textlength(txt[:ai],font=f),20-bb[1]),txt[ai:],font=f,fill=acol+(255,))
    return im
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
def device(fr,t,im,x,y,op,s,name,inner_pad):
    """Paste a device/card image and record its visible (non-glow) bounds for the safe-area report."""
    if op<=0.01: return
    paste(fr,im,x,y,op,s=s)
    w=(im.width-2*inner_pad)*s; h=(im.height-2*inner_pad)*s
    if op>0.9: DEV.append((round(t,2),name,int(x-w/2),int(y-h/2),int(x+w/2),int(y+h/2)))
# ---------------- logo assets ----------------
LOGO=Image.open(SH+'logo.png').convert('RGBA'); LOGO=LOGO.crop(LOGO.getchannel('A').getbbox())
WORD=Image.open(SH+'wordmark.png').convert('RGBA')
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
def lockup(h):
    """'Quasaria' brand wordmark + 'Autopay' set in Space Grotesk, solid lilac (matches the site nav)."""
    wm=WORD.resize((int(WORD.width*h/WORD.height),h),Image.LANCZOS)
    f=font('head',int(h*1.32),'Medium'); tmp=ImageDraw.Draw(Image.new('L',(4,4))); bb=tmp.textbbox((0,0),'Autopay',font=f)
    gap=int(h*0.32); tw=bb[2]-bb[0]; th=bb[3]-bb[1]
    im=Image.new('RGBA',(wm.width+gap+tw+40,max(h,th)+60),(0,0,0,0)); im.alpha_composite(wm,(20,30))
    # align baselines: wordmark baseline ~ bottom of 'Quasaria' x-height (exclude Q tail ~ 12% of height)
    base=30+int(h*0.80)
    ImageDraw.Draw(im).text((20+wm.width+gap,base),'Autopay',font=f,fill=LILAC+(255,),anchor='ls')
    return im.crop(im.getchannel('A').getbbox())
def flare():
    s=1000; yy,xx=np.mgrid[0:s,0:s].astype(np.float32)-s/2; r=np.sqrt(xx**2+yy**2)
    core=np.exp(-(r/(s*0.16))**2); streak=np.exp(-(yy/5)**2)*np.exp(-(np.abs(xx)/(s*0.32)))
    a=np.clip(core*0.5+streak*0.85,0,1); im=np.zeros((s,s,4),np.uint8)
    q=np.clip(r/(s/2),0,1)[...,None]; col=np.array([150,120,255])*(1-q)+np.array([34,211,238])*q
    im[...,:3]=np.clip(col*0.6+255*np.clip(streak,0,1)[...,None]*0.45,0,255); im[...,3]=(a*255).astype(np.uint8)
    return Image.fromarray(im).rotate(-18,resample=Image.BICUBIC)
FLARE=flare()
def rmask(w,h,r):
    m=Image.new('L',(w*2,h*2),0); ImageDraw.Draw(m).rounded_rectangle([0,0,w*2-1,h*2-1],r*2,fill=255); return m.resize((w,h),Image.LANCZOS)
# ---------------- phone frame ----------------
PPAD=90
def phone_template(sw):
    sh=int(sw*2532/1170); b=max(8,int(sw*0.032)); r=int(sw*0.13)
    w,h=sw+2*b,sh+2*b; Wt,Ht=w+2*PPAD,h+2*PPAD
    out=Image.new('RGBA',(Wt,Ht),(0,0,0,0))
    gm=Image.new('L',(Wt,Ht),0); ImageDraw.Draw(gm).rounded_rectangle([PPAD,PPAD,PPAD+w,PPAD+h],r+b,fill=255); gm=gm.filter(ImageFilter.GaussianBlur(40))
    g=grad(Wt,Ht,VIOLET,CYAN).convert('RGBA'); g.putalpha(gm.point(lambda v:int(v*0.55))); out.alpha_composite(g)
    body=Image.new('RGBA',(w,h),(12,12,20,255)); body.putalpha(rmask(w,h,r+b)); out.alpha_composite(body,(PPAD,PPAD))
    om=Image.new('L',(Wt,Ht),0); ImageDraw.Draw(om).rounded_rectangle([PPAD,PPAD,PPAD+w,PPAD+h],r+b,outline=255,width=2)
    oc=grad(Wt,Ht,LILAC,CYAN).convert('RGBA'); oc.putalpha(om.point(lambda v:int(v*0.7))); out.alpha_composite(oc)
    # glass sheen
    sm=Image.new('L',(sw,sh),0); ImageDraw.Draw(sm).polygon([(0,0),(sw*0.55,0),(0,sh*0.38)],fill=16); sm=sm.filter(ImageFilter.GaussianBlur(30))
    sheen=Image.new('RGBA',(sw,sh),(255,255,255,0)); sheen.putalpha(sm)
    return out,rmask(sw,sh,r),(PPAD+b,PPAD+b),sheen
IMGS={}
def img(path):
    if path not in IMGS: IMGS[path]=Image.open(path).convert('RGB')
    return IMGS[path]
def screen_src(name,sw):
    """name: 'dashboard-m' still, or ('scroll','dashboard',pos 0..1)"""
    sh=int(sw*2532/1170)
    if isinstance(name,tuple) and name[0]=='pan':
        _,n,pos=name; meta=C('panmeta',lambda:json.load(open(SH+'pan/meta.json')))[n]
        full=C(('pf',n,sw),lambda:(lambda im:im.resize((sw,int(im.height*sw/im.width)),Image.LANCZOS))(img(f'{SH}pan/{n}_full.png')))
        view=C(('pv',n,sw),lambda:img(f'{SH}pan/{n}_view.png').resize((sw,sh),Image.LANCZOS))
        y=int(round(clamp(pos)*(full.height-sh)))
        out=full.crop((0,y,sw,y+sh)); k=sw/390
        tb=int(meta['top']*k); tabs=int(meta['tabs']*k)
        if tb: out.paste(view.crop((0,0,sw,tb)),(0,0))
        if tabs: out.paste(view.crop((0,sh-tabs,sw,sh)),(0,sh-tabs))
        return out
    if isinstance(name,tuple):
        _,n,pos=name; files=C(('sf',n),lambda:sorted(glob.glob(f'{SH}scroll/{n}_*.png')))
        f=pos*(len(files)-1); i=int(f); fr_=f-i
        a=C(('ss',files[i],sw),lambda:img(files[i]).resize((sw,sh),Image.LANCZOS))
        if fr_<0.02 or i+1>=len(files): return a
        b=C(('ss',files[i+1],sw),lambda:img(files[i+1]).resize((sw,sh),Image.LANCZOS))
        return Image.blend(a,b,fr_)
    return C(('ss',name,sw),lambda:img(SH+name+'.png').resize((sw,sh),Image.LANCZOS))
def phone(name,sw,name2=None,mix=0.0):
    tpl,m,(ox,oy),sheen=C(('ph',sw),lambda:phone_template(sw))
    scr=screen_src(name,sw)
    if name2 is not None and mix>0.01: scr=Image.blend(scr,screen_src(name2,sw),clamp(mix))
    scr=scr.convert('RGBA'); scr.alpha_composite(sheen); scr.putalpha(m)
    out=tpl.copy(); out.alpha_composite(scr,(ox,oy)); return out
# ---------------- browser card (dealer portal) ----------------
BAR=40
def chrome(cw,url):
    im=Image.new('RGBA',(cw,BAR),(16,16,26,255)); d=ImageDraw.Draw(im)
    for i,c in enumerate([(255,95,87),(254,188,46),(40,200,64)]): d.ellipse([16+i*20,BAR//2-5,26+i*20,BAR//2+5],fill=c+(190,))
    f=font('body',16,'Medium'); bw=min(cw-200,520); x0=(cw-bw)//2
    d.rounded_rectangle([x0,7,x0+bw,BAR-7],11,fill=(28,28,42,255)); d.text((cw//2,BAR//2),url,font=f,fill=(185,190,212),anchor='mm')
    return im
def card_frame(cw,ch):
    pad=80; w,h=cw+2*pad,ch+2*pad
    m=Image.new('L',(w,h),0); ImageDraw.Draw(m).rounded_rectangle([pad,pad,pad+cw,pad+ch],18,fill=255); m=m.filter(ImageFilter.GaussianBlur(34))
    g=grad(w,h,VIOLET,CYAN).convert('RGBA'); g.putalpha(m.point(lambda v:int(v*0.55)))
    bm=Image.new('L',(w,h),0); ImageDraw.Draw(bm).rounded_rectangle([pad-1,pad-1,pad+cw+1,pad+ch+1],19,outline=255,width=2)
    bc=grad(w,h,LILAC,CYAN).convert('RGBA'); bc.putalpha(bm.point(lambda v:int(v*0.7))); g.alpha_composite(bc); return g,pad
def bcard(fname,url,p,cw,ch,z0=1.0,z1=1.12,fx=0.5,fy=0.4):
    im=img(SH+fname); e=eio(p); z=z0+(z1-z0)*e
    w=im.width/z; h=w*ch/cw
    if h>im.height: h=im.height; w=h*cw/ch
    x0=(im.width-w)*fx; y0=(im.height-h)*fy*e
    crop=im.resize((cw,ch),Image.BICUBIC,box=(x0,y0,x0+w,y0+h))
    key=('fr',cw,ch)
    if key not in CACHE: CACHE[key]=(card_frame(cw,ch+BAR),rmask(cw,ch+BAR,18))
    (G,pad),M=CACHE[key]
    c=Image.new('RGBA',(cw,ch+BAR)); c.paste(C(('ch',cw,url),lambda:chrome(cw,url)),(0,0)); c.paste(crop,(0,BAR)); c.putalpha(M)
    out=G.copy(); out.alpha_composite(c,(pad,pad)); return out
# ---------------- glass panels / chips ----------------
def panel(w,h,r=28,a=200):
    pad=50; im=Image.new('RGBA',(w+2*pad,h+2*pad),(0,0,0,0))
    gm=Image.new('L',im.size,0); ImageDraw.Draw(gm).rounded_rectangle([pad,pad,pad+w,pad+h],r,fill=255); gm=gm.filter(ImageFilter.GaussianBlur(30))
    g=Image.new('RGBA',im.size,VIOLET+(0,)); g.putalpha(gm.point(lambda v:int(v*0.35))); im.alpha_composite(g)
    body=Image.new('RGBA',(w,h),(16,14,32,a)); body.putalpha(rmask(w,h,r).point(lambda v:int(v*a/255))); im.alpha_composite(body,(pad,pad))
    om=Image.new('L',im.size,0); ImageDraw.Draw(om).rounded_rectangle([pad,pad,pad+w,pad+h],r,outline=255,width=2)
    oc=grad(*im.size,LILAC,CYAN).convert('RGBA'); oc.putalpha(om.point(lambda v:int(v*0.55))); im.alpha_composite(oc)
    return im,pad
def chip(title,value,sub=None,size=1.0):
    ft=font('body',int(24*size),'Medium'); fv=font('head',int(40*size),'Bold'); fs=font('body',int(19*size),'Medium')
    tmp=ImageDraw.Draw(Image.new('L',(1,1)))
    w=int(max(tmp.textlength(title,font=ft),tmp.textlength(value,font=fv),tmp.textlength(sub or '',font=fs))+120*size); h=int((112 if sub else 92)*size)
    im,pad=panel(w,h,int(22*size),215); d=ImageDraw.Draw(im)
    cx,cy=pad+int(36*size),pad+h//2
    d.ellipse([cx-int(14*size),cy-int(14*size),cx+int(14*size),cy+int(14*size)],fill=CYAN+(60,),outline=CYAN+(255,),width=2)
    d.ellipse([cx-int(5*size),cy-int(5*size),cx+int(5*size),cy+int(5*size)],fill=ICE+(255,))
    x=pad+int(70*size); y=pad+int(16*size)
    d.text((x,y),title,font=ft,fill=MUTED+(255,)); d.text((x,y+int(28*size)),value,font=fv,fill=WHITE+(255,))
    if sub: d.text((x,y+int(76*size)),sub,font=fs,fill=(170,175,200,255))
    return im
def pill(txt,size,solid=False):
    f=font('body',size,'SemiBold'); tl=ImageDraw.Draw(Image.new('L',(1,1))).textlength(txt,font=f)
    w=int(tl)+90; h=int(size*2.1); im=Image.new('RGBA',(w+24,h+24),(0,0,0,0))
    fill=Image.new('L',im.size,0); ImageDraw.Draw(fill).rounded_rectangle([12,12,12+w,12+h],h//2,fill=255)
    bg=Image.new('RGBA',im.size,(20,18,40,0)); bg.putalpha(fill.point(lambda v:int(v*0.85))); im.alpha_composite(bg)
    m=Image.new('L',im.size,0); ImageDraw.Draw(m).rounded_rectangle([12,12,12+w,12+h],h//2,outline=255,width=3)
    g=grad(*im.size,VIOLET,CYAN).convert('RGBA'); g.putalpha(m); im.alpha_composite(g)
    ImageDraw.Draw(im).text((12+w/2,12+h/2),txt,font=f,fill=WHITE,anchor='mm')
    return glow(im,12,0.5)
def tag(txt,size):
    f=font('body',size,'SemiBold'); tl=ImageDraw.Draw(Image.new('L',(1,1))).textlength(txt,font=f)+len(txt)*3
    w=int(tl)+36; h=int(size*1.9); im=Image.new('RGBA',(w+4,h+4),(0,0,0,0)); d=ImageDraw.Draw(im)
    d.rounded_rectangle([2,2,2+w,2+h],h//2,fill=(250,204,21,28),outline=(250,204,21,200),width=2)
    x=20
    for ch in txt: d.text((x,2+h/2),ch,font=f,fill=(253,224,71,255),anchor='lm'); x+=d.textlength(ch,font=f)+3
    return im
# ---------------- scene helpers ----------------
def step_text(fr,t,a,b,idx,label,lines,accent,sub,sub2=None):
    """Kicker + headline + sub. HZ: left column; V: centered top block."""
    lt=t-a; op=env(t,a,b,0.12,0.15)
    kick=f'0{idx}  ·  {label.upper()}' if idx else label.upper()
    if HZ:
        tx=150; hs=96; lh=106; n=len(lines)
        ytop=H/2-(n*lh)/2-30
        k0=eout(lt/0.35)
        T(fr,t,('kick',kick),lambda:text_im(kick,24,'body','SemiBold',fill=CYAN,track=5),tx-20-30*(1-k0),ytop-60,op,'l')
        for i,l in enumerate(lines):
            k=eout((lt-0.08-0.07*i)/0.4)
            T(fr,t,('hl',l,hs),lambda l=l:glow(text_im(l,hs,accent=accent if accent and accent in l else None),14,0.28),tx-20-60*(1-k),ytop+i*lh+lh/2,op*clamp((lt-0.08-0.07*i)/0.15),'l')
        k=eout((lt-0.35)/0.4); ys=ytop+n*lh+40
        T(fr,t,('sub',sub),lambda:text_im(sub,34,'body','Medium',fill=MUTED),tx-20-40*(1-k),ys,env(t,a+0.35,b,0.2,0.15),'l')
        if sub2: T(fr,t,('sub2',sub2),lambda:text_im(sub2,24,'body','Medium',fill=(135,140,165)),tx-20-40*(1-k),ys+52,env(t,a+0.5,b,0.2,0.15),'l')
    else:
        hs=92; lh=104; n=len(lines); y0=300
        k0=eout(lt/0.35)
        T(fr,t,('kick',kick),lambda:text_im(kick,28,'body','SemiBold',fill=CYAN,track=5),W/2,y0-50+20*(1-k0),op)
        for i,l in enumerate(lines):
            k=eout((lt-0.08-0.07*i)/0.4)
            T(fr,t,('hl',l,hs),lambda l=l:glow(text_im(l,hs,accent=accent if accent and accent in l else None),14,0.28),W/2,y0+40+i*lh+40*(1-k),op*clamp((lt-0.08-0.07*i)/0.15))
        k=eout((lt-0.35)/0.4); ys=y0+40+n*lh+5
        T(fr,t,('subv',sub),lambda:text_im(sub,36,'body','Medium',fill=MUTED),W/2,ys+20*(1-k),env(t,a+0.35,b,0.2,0.15))
        if sub2: T(fr,t,('sub2v',sub2),lambda:text_im(sub2,26,'body','Medium',fill=(135,140,165)),W/2,ys+52+20*(1-k),env(t,a+0.5,b,0.2,0.15))
def phone_scene(fr,t,a,b,src,src2=None,mixt=None,sw=None,dy=0,name='phone',push=0.06):
    lt=t-a; op=env(t,a,b,0.1,0.15); D=b-a
    sw=sw or (405 if HZ else 430)
    ex=eout(lt/0.55)
    mix=ease((t-mixt)/0.45) if mixt else 0
    s_=src(lt/D) if callable(src) else src
    im=phone(s_,sw,src2,mix)
    s=(0.94+0.06*ex)*(1+push*eio(lt/D))
    if HZ: x=1330+260*(1-ex)-25*eio(lt/D); y=H/2+dy+8*math.sin(lt*1.3)
    else: x=W/2; y=1135+dy+120*(1-ex)-12*eio(lt/D)
    device(fr,t,im,x,y,op,s,name,PPAD)
    return x,y,s,im
# ---------------- scenes ----------------
URL='yogibear1323.github.io/autopay'
def hook(fr,t):
    if t>S_LOGO+0.1: return
    words=[('What',0.30,0),('if',0.48,0),('your',0.58,0),('down',0.76,1 if not HZ else 0),('payment',0.98,1),('kept',1.36,2 if not HZ else 1),('working?',1.58,2 if not HZ else 1)]
    nl=3 if not HZ else 2
    size=128 if HZ else 118
    f=font('head',size,'Bold'); tmp=ImageDraw.Draw(Image.new('L',(4,4))); sp=tmp.textlength(' ',font=f)
    lines=[[w for w in words if w[2]==i] for i in range(nl)]
    out=ease((t-3.25)/0.45); zs=1+0.12*out; gop=1-out
    lh=150 if HZ else 140
    for li,ln in enumerate(lines):
        tot=sum(tmp.textlength(w[0],font=f) for w in ln)+sp*(len(ln)-1)
        x=W/2-tot/2*zs; y=H/2+(li-(nl-1)/2)*lh; y=H/2+(y-H/2)*zs
        for wd,ta,_ in ln:
            adv=tmp.textlength(wd,font=f)
            k=eout((t-ta)/0.25); op=clamp((t-ta)/0.12)*gop
            acc=wd in ('kept','working?')
            im=C(('hw',wd),lambda wd=wd,acc=acc:glow(text_im(wd,size,fill=CYAN if acc else WHITE),18,0.35))
            s=(1.25-0.25*k)*zs
            paste(fr,im,x+adv*zs/2,y,op,s=s,is_text=True,t=t,name='hook:'+wd)
            x+=(adv+sp)*zs
    if t<1.7:
        k=ease(t/1.5); paste(fr,FLARE,-200+k*(W+400),H*0.5,0.8*math.sin(math.pi*clamp(t/1.6)),s=1.1)
def logo_scene(fr,t):
    a,b=S_LOGO,S1
    if not (a-0.05<=t<=b): return
    lt=t-a; op=env(t,a,b,0.06,0.18)
    k=eback(lt/0.6); s=0.55+0.45*k+0.03*lt/3.75
    boost=max(0,1-lt/0.9)*0.9
    cy=H/2-110 if HZ else H/2-180
    paste(fr,FLARE,W/2,cy,op*(0.35+0.6*boost),s=0.8+0.6*eout(lt/1.2))
    draw_logo(fr,C('LB',lambda:logo_pack(280 if HZ else 320)),W/2,cy,s,op,boost)
    wop=env(t,a+0.45,b,0.35,0.18); wk=eout((lt-0.45)/0.6)
    T(fr,t,'lockL',lambda:lockup(92 if HZ else 84),W/2,cy+(280 if HZ else 300)+30*(1-wk),wop)
    sop=env(t,a+1.0,b,0.35,0.18); sk=eout((lt-1.0)/0.6)
    tg='DOWN PAYMENTS THAT KEEP WORKING'
    T(fr,t,'tag',lambda:text_im(tg,28 if HZ else 30,'body','SemiBold',fill=LILAC,track=6 if HZ else 4),W/2,cy+(395 if HZ else 410)+20*(1-sk),sop)
def step1(fr,t):
    a,b=S1,S2
    if not (a<=t<=b+0.02): return
    step_text(fr,t,a,b,1,'Buy & put down',['Make your','down payment.'],'down payment.','Car  ·  bike  ·  home')
    x,y,s,_=phone_scene(fr,t,a,b,'create-m',name='create')
    lt=t-a; k=eout((lt-0.9)/0.5)
    cx=(x-390 if HZ else x-250); cy=(y+170 if HZ else y+300)
    T(fr,t,'c1chip',lambda:chip('Down payment','$10,000',None,1.0 if HZ else 1.05),cx-40*(1-k),cy,env(t,a+0.9,b,0.25,0.15))
def step2(fr,t):
    a,b=S2,S3
    if not (a<=t<=b+0.02): return
    step_text(fr,t,a,b,2,'Deposit',['Into a','transparent','vault.'] if HZ else ['Into a transparent','vault.'],'vault.','USDC on Stellar')
    x,y,s,_=phone_scene(fr,t,a,b,lambda p:('pan','review',eio(clamp(p/0.45))),'done-m',a+1.85,name='review>done')
    lt=t-a; k=eout((lt-2.2)/0.5)
    cx=(x-390 if HZ else x+230); cy=(y+190 if HZ else y+330)
    T(fr,t,'c2chip',lambda:chip('Visible on-chain','USDC vault',None,1.0 if HZ else 1.05),cx-40*(1-k),cy,env(t,a+2.2,b,0.25,0.15))
def ring_img(R,tilt):
    s=int(R*2+60); m=Image.new('L',(s,s),0); d=ImageDraw.Draw(m)
    d.ellipse([30,s/2-R*tilt,s-30,s/2+R*tilt],outline=255,width=3); m=m.filter(ImageFilter.GaussianBlur(1.5))
    g=grad(s,s,VIOLET,CYAN).convert('RGBA'); g.putalpha(m.point(lambda v:int(v*0.7))); return g
def step3(fr,t):
    a,b=S3,S4
    if not (a<=t<=b+0.02): return
    step_text(fr,t,a,b,3,'Earn',['It earns','yield.'],'yield.','From vetted on-chain sources','Yield varies and can be zero.')
    lt=t-a; op=env(t,a,b,0.15,0.15); ex=eout(lt/0.6)
    cx,cy=(1300,H/2) if HZ else (W/2,1150)
    R=330 if HZ else 360
    lay=Image.new('RGBA',(W,H),(0,0,0,0)); d=ImageDraw.Draw(lay)
    rings=[(R,0.30,-14,0.55),(R*0.72,0.42,18,-0.8),(R*1.18,0.22,6,0.35)]
    for i,(rr,tl,rot,spd) in enumerate(rings):
        im=C(('ring',i),lambda rr=rr,tl=tl,rot=rot:ring_img(rr,tl).rotate(rot,resample=Image.BICUBIC))
        paste(fr,im,cx,cy,op*(0.8-0.15*i),s=0.85+0.15*ex)
        # orbiting particles
        for j in range(5):
            th=lt*spd*2+j*1.2566+i
            px=math.cos(th)*rr*(0.85+0.15*ex); py=math.sin(th)*rr*tl*(0.85+0.15*ex)
            cr,sr=math.cos(math.radians(-rot)),math.sin(math.radians(-rot))
            X=cx+px*cr-py*sr; Y=cy+px*sr+py*cr
            rad=4 if j%2 else 3; al=int(230*op)
            d.ellipse([X-rad*3,Y-rad*3,X+rad*3,Y+rad*3],fill=CYAN+(int(al*0.15),)); d.ellipse([X-rad,Y-rad,X+rad,Y+rad],fill=ICE+(al,))
    # inflow from three source nodes
    nodes=[(-1.0,-0.75),(1.05,-0.55),(0.1,1.05)]
    for ni,(nx,ny) in enumerate(nodes):
        NX=cx+nx*R*1.05; NY=cy+ny*R*0.8
        pul=0.5+0.5*math.sin(lt*4+ni)
        no=op*ease((lt-0.3-0.15*ni)/0.4)
        d.ellipse([NX-22,NY-22,NX+22,NY+22],outline=LILAC+(int(160*no),),width=2)
        d.ellipse([NX-7-3*pul,NY-7-3*pul,NX+7+3*pul,NY+7+3*pul],fill=VIOLET+(int(220*no),))
        for q in range(6):
            f=((lt*0.9+q/6+ni*0.13)%1.0)
            if lt<0.6+0.15*ni: continue
            ef=f*f
            X=NX+(cx-NX)*ef+math.sin(f*math.pi)*30*(1 if ni%2 else -1); Y=NY+(cy-NY)*ef
            al=int(220*op*math.sin(math.pi*f))
            d.ellipse([X-9,Y-9,X+9,Y+9],fill=CYAN+(al//6,)); d.ellipse([X-3,Y-3,X+3,Y+3],fill=ICE+(al,))
    fr.alpha_composite(lay)
    draw_logo(fr,C('LV',lambda:logo_pack(170 if HZ else 190)),cx,cy,0.85+0.15*ex+0.03*math.sin(lt*3),op,0.25+0.2*math.sin(lt*3)**2)
    k=eout((lt-0.7)/0.5)
    T(fr,t,'vaultlbl',lambda:text_im('USDC VAULT',24 if HZ else 26,'body','SemiBold',fill=LILAC,track=6),cx,cy+(R*0.72*0.42+70 if HZ else R*0.72*0.42+80)+15*(1-k),env(t,a+0.7,b,0.3,0.15))
def step4(fr,t):
    a,b=S4,S5
    if not (a<=t<=b+0.02): return
    step_text(fr,t,a,b,4,'Sweep',['Swept to','your lender.'],'your lender.','Monthly, as extra principal')
    x,y,s,_=phone_scene(fr,t,a,b,lambda p:('pan','payments',0.12*eio(p)),name='payments')
    lt=t-a
    for i,(ta,val,dyy) in enumerate([(0.9,'+$41.67',-120),(1.6,'+$41.67',120)][:1]):
        k=eout((lt-ta)/0.5)
        cx=(x-395 if HZ else x-200); cy=(y+dyy if HZ else y+420)
        T(fr,t,('c4chip',i),lambda:chip('Yield sweep → lender','+$41.67 / mo','extra principal · illustrative',1.0 if HZ else 1.05),cx-50*(1-k),cy,env(t,a+ta,b,0.25,0.15))
CARD=(860,720) if HZ else (920,770)
def step5(fr,t):
    a,b=S5,S6
    if not (a<=t<=b+0.02): return
    step_text(fr,t,a,b,5,'Save',['Pay less,','or finish','sooner.'] if HZ else ['Pay less,','or finish sooner.'],'sooner.','Car example  ·  illustrative')
    lt=t-a; op=env(t,a,b,0.12,0.15); ex=eout(lt/0.6)
    cw,ch=CARD; k=1.0 if HZ else 1.06
    cx,cy=(1300,H/2+10) if HZ else (W/2,1185)
    pn,pp=C('p5',lambda:panel(cw,ch,30,205))
    yo=40*(1-ex)
    device(fr,t,pn,cx+(80*(1-ex) if HZ else 0),cy+yo,op,1.0,'carcard',pp)
    L=cx-cw/2+50; R_=cx+cw/2-50; Tp=cy-ch/2+yo
    def row(key,fn,x,y,ta,anchor='l'):
        kk=eout((lt-ta)/0.35)
        paste(fr,C(key,fn),x+(0 if anchor!='r' else 0),y+12*(1-kk),op*clamp((lt-ta)/0.25),anchor=anchor if anchor!='r' else 'c',is_text=True,t=t,name=str(key)) if anchor!='r' else \
        paste_r(fr,C(key,fn),x,y+12*(1-kk),op*clamp((lt-ta)/0.25),t,str(key))
    row('k5',lambda:text_im('CAR EXAMPLE',int(22*k),'body','SemiBold',fill=CYAN,track=5),L-20,Tp+60*k,0.3)
    row('t5',lambda:tag('ILLUSTRATIVE',int(18*k)),R_+20,Tp+60*k,0.3,'r')
    row('r1',lambda:text_im('$50,000 car  ·  $10,000 down',int(34*k),'body','SemiBold'),L-20,Tp+130*k,0.45)
    row('r2',lambda:text_im('$40,000 loan  ·  7%  ·  60 months',int(28*k),'body','Medium',fill=MUTED),L-20,Tp+180*k,0.6)
    if op>0.02:
        dl=Image.new('RGBA',(cw-100,2),(196,181,253,int(60*op*clamp((lt-0.7)/0.3)))); comp(fr,dl,L,Tp+225*k)
    row('r3l',lambda:text_im('Monthly payment',int(28*k),'body','Medium',fill=MUTED),L-20,Tp+285*k,0.85)
    row('r3v',lambda:text_im('$792/mo',int(48*k),'head','Bold'),R_+20,Tp+285*k,0.85,'r')
    row('r4l',lambda:text_im('Est. vault yield (5% APY)',int(28*k),'body','Medium',fill=MUTED),L-20,Tp+360*k,1.25)
    yv=int(round(42*eout((lt-1.25)/0.9)))
    row(('r4v',yv),lambda:text_im(f'~${yv}/mo',int(48*k),'head','Bold',fill=CYAN),R_+20,Tp+360*k,1.25,'r')
    # result tiles
    tw=(cw-100-70)//2; th=int(170*k)
    tile=C('tile5',lambda:tile_img(tw,th))
    tk=eout((lt-2.1)/0.5); tk2=eout((lt-2.6)/0.5)
    ty=Tp+415*k+th/2
    paste(fr,tile,L+tw/2,ty+20*(1-tk),op*clamp((lt-2.1)/0.3))
    paste(fr,tile,R_-tw/2,ty+20*(1-tk2),op*clamp((lt-2.6)/0.3))
    ev=int(round(792-42*eout((lt-2.1)/0.8)))
    T(fr,t,('e5',ev),lambda:text_im(f'~${ev}/mo',int(50*k),'head','Bold',fill=WHITE),L+tw/2,ty-22+20*(1-tk),op*clamp((lt-2.1)/0.3))
    T(fr,t,'e5l',lambda:text_im('effective payment',int(24*k),'body','Medium',fill=MUTED),L+tw/2,ty+38+20*(1-tk),op*clamp((lt-2.1)/0.3))
    T(fr,t,'or5',lambda:text_im('or',int(28*k),'body','SemiBold',fill=LILAC),cx,ty,op*clamp((lt-2.45)/0.3))
    mv=int(round(3*eout((lt-2.6)/0.6)))
    T(fr,t,('m5',mv),lambda:text_im(f'~{mv} months',int(50*k),'head','Bold',fill=WHITE),R_-tw/2,ty-22+20*(1-tk2),op*clamp((lt-2.6)/0.3))
    T(fr,t,'m5l',lambda:text_im('sooner payoff',int(24*k),'body','Medium',fill=MUTED),R_-tw/2,ty+38+20*(1-tk2),op*clamp((lt-2.6)/0.3))
    row('f5',lambda:text_im('Illustrative estimate. Yield varies and can be zero.',int(21*k),'body','Medium',fill=(140,145,170)),L-20,Tp+ch-45,3.0)
def tile_img(w,h):
    im=Image.new('RGBA',(w,h),(0,0,0,0)); d=ImageDraw.Draw(im)
    d.rounded_rectangle([0,0,w-1,h-1],20,fill=(124,92,255,34),outline=(34,211,238,120),width=2); return im
def paste_r(fr,im,x,y,op,t,name):
    # right-anchored (x = right edge incl. 20px text padding)
    paste(fr,im,x-im.width,y,op,anchor='l',is_text=True,t=t,name=name)
def step6(fr,t):
    a,b=S6,S7
    if not (a<=t<=b+0.02): return
    step_text(fr,t,a,b,6,'Track',['Track it','all.'] if HZ else ['Track it all.'],'all.','Every deposit and sweep, in the app')
    phone_scene(fr,t,a,b,lambda p:('pan','dashboard',eio(clamp((p-0.15)/0.8))),name='dashboard',push=0.05)
def step7(fr,t):
    a,b=S7,S_DEAL
    if not (a<=t<=b+0.02): return
    step_text(fr,t,a,b,7,'Payoff',['Your deposit','comes back.'],'comes back.','At payoff, it returns to you')
    x,y,s,_=phone_scene(fr,t,a,b,'payoff-m',name='payoff')
    lt=t-a; k=eout((lt-1.0)/0.5)
    cx=(x-395 if HZ else x+200); cy=(y+150 if HZ else y+380)
    T(fr,t,'c7chip',lambda:chip('Back to you','Your deposit',None,1.0 if HZ else 1.05),cx-50*(1-k),cy,env(t,a+1.0,b,0.25,0.15))
def dealer(fr,t):
    a,b=S_DEAL,S_CTA
    if not (a<=t<=b+0.02): return
    lt=t-a; op=env(t,a,b,0.1,0.15); D=b-a; ex=eout(lt/0.6)
    step_text(fr,t,a,b,0,'For dealers & lenders',['Close more','deals.'],'deals.','Same lien. Same title process.')
    url='Autopay  ·  dealer portal (prototype)'
    mix=ease((lt-2.9)/0.5)
    if HZ:
        cw,ch=1040,650
        c=bcard('dealer-d.png',url,lt/D,cw,ch,1.0,1.15,0.35,0.3)
        if mix>0.01: c=Image.blend(c,bcard('ledger-d.png',url,lt/D,cw,ch,1.0,1.15,0.35,0.3),mix)
        device(fr,t,c,1290+120*(1-ex)-30*eio(lt/D),H/2+8*math.sin(lt),op,0.96+0.04*ex,'dealer',80)
    else:
        cw,ch=920,575
        c=bcard('dealer-d.png',url,lt/D,cw,ch,1.15,1.35,0.0,0.2)
        if mix>0.01: c=Image.blend(c,bcard('ledger-d.png',url,lt/D,cw,ch,1.15,1.35,0.0,0.2),mix)
        device(fr,t,c,W/2,1130+120*(1-ex),op,0.96+0.04*ex,'dealer',80)
    k=eout((lt-1.3)/0.5)
    pts=['Close more deals','No change to financing','Every sweep on-chain']
def cta(fr,t):
    a,b=S_CTA,S_END
    if not (a<=t<=b): return
    lt=t-a; op=env(t,a,b,0.12,0.12); k=eout(lt/0.4)
    draw_logo(fr,C('LC',lambda:logo_pack(110)),W/2,H/2-(220 if HZ else 300),0.9+0.1*eout(lt/0.8),op*0.95,max(0,1-lt/0.8)*0.6)
    T(fr,t,'c1',lambda:glow(text_im('Join the pilot.',140 if HZ else 128,accent='pilot.'),20,0.4),W/2,H/2-10+40*(1-k),op*clamp(lt/0.15),s=1+0.03*lt/3.75)
    k2=eout((lt-0.6)/0.45)
    T(fr,t,'c2',lambda:pill(URL,40 if HZ else 38),W/2,H/2+(150 if HZ else 160)+30*(1-k2),env(t,a+0.6,b,0.2,0.12))
    k3=eout((lt-1.0)/0.45)
    T(fr,t,'c3',lambda:text_im('For dealers, lenders and buyers  ·  testnet pilot',30 if HZ else 30,'body','Medium',fill=MUTED),W/2,H/2+(255 if HZ else 260)+20*(1-k3),env(t,a+1.0,b,0.2,0.12))
DISC='Prototype. Illustrative estimates. Not a loan offer or financial advice. Yield varies and can be zero.'
def endcard(fr,t):
    a=S_END
    if t<a: return
    lt=t-a; op=env(t,a,DUR+1,0.05,0.1)
    k=eback(lt/0.7); boost=max(0,1-lt/1.0)*0.9
    cy=H/2-170 if HZ else H/2-280
    paste(fr,FLARE,W/2,cy,op*(0.25+0.6*boost),s=0.7+0.4*eout(lt/1.5))
    draw_logo(fr,C('LE',lambda:logo_pack(210 if HZ else 250)),W/2,cy,0.7+0.3*k,op,boost)
    wk=eout((lt-0.35)/0.6)
    T(fr,t,'lockE',lambda:lockup(76 if HZ else 72),W/2,cy+(215 if HZ else 250)+25*(1-wk),env(t,a+0.35,DUR+1,0.4,0.1))
    uk=eout((lt-0.8)/0.6)
    T(fr,t,'eu1',lambda:text_im('Join the pilot',34 if HZ else 38,'body','Medium',fill=LILAC),W/2,cy+(320 if HZ else 370)+20*(1-uk),env(t,a+0.8,DUR+1,0.4,0.1))
    T(fr,t,'eu2',lambda:text_im(URL,46 if HZ else 46,'body','SemiBold',fill=WHITE),W/2,cy+(385 if HZ else 440)+20*(1-uk),env(t,a+0.9,DUR+1,0.4,0.1))
    dop=env(t,a+1.2,DUR+1,0.5,0.1)
    if HZ: T(fr,t,'disc',lambda:text_im(DISC,25,'body','Regular',fill=(160,164,186)),W/2,SAFE[3]-40,dop)
    else:
        T(fr,t,'disc1',lambda:text_im('Prototype. Illustrative estimates. Not a loan',29,'body','Regular',fill=(160,164,186)),W/2,SAFE[3]-90,dop)
        T(fr,t,'disc2',lambda:text_im('offer or financial advice. Yield varies and can be zero.',29,'body','Regular',fill=(160,164,186)),W/2,SAFE[3]-45,dop)
def flash(fr,t):
    a=0
    for at,g in [(S_LOGO,0.85),(S_END,0.8),(S5,0.3),(S_DEAL,0.3),(S_CTA,0.3)]+[(c,0.2) for c in (S1,S2,S3,S4,S6,S7)]:
        d=t-at
        if -0.03<=d<0.25: a=max(a,g*(1-d/0.25) if d>=0 else g*0.5)
    if a>0.01: fr.alpha_composite(Image.new('RGBA',(W,H),(225,215,255,int(255*a*0.5))))
def whip(arr,t):
    for at in [S1,S2,S3,S4,S5,S6,S7,S_DEAL,S_CTA]:
        d=t-at
        if -0.07<=d<0.07:
            k=int(40*(1-abs(d)/0.07))+4; acc=np.zeros_like(arr,dtype=np.float32); n=0
            for sh in range(-k,k+1,max(1,k//4)): acc+=np.roll(arr,sh,axis=1 if HZ else 0); n+=1
            arr=(acc/n).astype(np.uint8)
    return arr
def render(t):
    fr=BG.copy(); glows(fr,t); stars(fr,t)
    hook(fr,t); logo_scene(fr,t)
    step1(fr,t); step2(fr,t); step3(fr,t); step4(fr,t); step5(fr,t); step6(fr,t); step7(fr,t)
    dealer(fr,t); cta(fr,t); endcard(fr,t); flash(fr,t)
    g=min(1,t/0.25,(DUR-t)/0.8)
    if g<1: fr.alpha_composite(Image.new('RGBA',(W,H),(0,0,0,int(255*(1-max(0,g))))))
    return whip(np.asarray(fr.convert('RGB')),t)
if __name__=='__main__':
    if ONLY:
        import os; os.makedirs('frames',exist_ok=True)
        for tt in ONLY: Image.fromarray(render(tt)).save(f'frames/{MODE}_{tt:05.2f}.png')
        print('TXT_ERR',TXT_ERR); sys.exit(0)
    cmd=['ffmpeg','-y','-loglevel','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-',
         '-i',AUD,'-map','0:v','-map','1:a','-c:v','libx264','-preset','slow','-crf',os.environ.get('CRF','21'),'-pix_fmt','yuv420p','-profile:v','high','-g','60',
         '-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart',OUTF]
    p=subprocess.Popen(cmd,stdin=subprocess.PIPE)
    import time; t0=time.time()
    for i in range(NF):
        p.stdin.write(render(i/FPS).tobytes())
        if i%150==0: print(i,round(time.time()-t0,1),flush=True)
    p.stdin.close(); p.wait()
    json.dump(TXT_ERR,open(f'txt_err_{MODE}.json','w')); json.dump(DEV,open(f'dev_{MODE}.json','w'))
    print('done',p.returncode,'TXT_ERR',len(TXT_ERR),TXT_ERR[:10])
