import sys, math, subprocess, numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
MODE = sys.argv[1] if len(sys.argv)>1 else 'h'   # h or v
OUTF = sys.argv[2] if len(sys.argv)>2 else 'video_h.mp4'
ONLY = [float(x) for x in sys.argv[3].split(',')] if len(sys.argv)>3 else None
W,H = (1920,1080) if MODE=='h' else (1080,1920)
FPS=30; DUR=60.0; NF=int(DUR*FPS)
S = 1.0 if MODE=='h' else 1.0
SH='shots/'
GF='/usr/share/fonts/truetype/sand-box/google/'
def font(kind,size,weight='Bold'):
    p={'head':GF+'Space Grotesk/SpaceGrotesk-VariableFont_wght.ttf','body':GF+'Inter/Inter-VariableFont_opsz,wght.ttf'}[kind]
    f=ImageFont.truetype(p,size)
    try: f.set_variation_by_name(weight)
    except Exception as e: pass
    return f
VIOLET=(124,92,255); CYAN=(34,211,238); LILAC=(196,181,253); WHITE=(245,246,250); MUTED=(160,164,184)
def ease(x): x=min(1,max(0,x)); return x*x*(3-2*x)
def eout(x): x=min(1,max(0,x)); return 1-(1-x)**3
def env(t,a,b,fi=0.5,fo=0.5):
    if t<a or t>b: return 0.0
    return min(ease((t-a)/fi) if fi>0 else 1, ease((b-t)/fo) if fo>0 else 1)
def grad_img(w,h,c1=VIOLET,c2=CYAN,diag=True):
    x=np.linspace(0,1,w)[None,:]; y=np.linspace(0,1,h)[:,None]
    g=(x*0.8+y*0.2) if diag else x+0*y
    g=np.clip(g,0,1)
    arr=np.zeros((h,w,3)); 
    for i in range(3): arr[...,i]=c1[i]+(c2[i]-c1[i])*g
    return Image.fromarray(arr.astype(np.uint8))
# ---------- background ----------
def make_bg():
    yy,xx=np.mgrid[0:H,0:W].astype(np.float32)
    base=np.zeros((H,W,3),np.float32); base[:]=(7,7,11)
    def blob(cx,cy,r,col,a):
        d=np.exp(-(((xx-cx)**2+(yy-cy)**2)/(2*r*r)))
        for i in range(3): base[...,i]+=d*col[i]*a
    blob(W*0.12,H*0.15,W*0.35,VIOLET,0.16); blob(W*0.9,H*0.9,W*0.32,CYAN,0.09); blob(W*0.5,H*0.5,W*0.5,(40,30,90),0.25)
    # vignette
    v=1-0.55*(((xx/W-0.5)**2+(yy/H-0.5)**2)*2.2); base*=np.clip(v,0.35,1)[...,None]
    # subtle noise to avoid banding
    base+=np.random.default_rng(1).normal(0,1.2,base.shape)
    return Image.fromarray(np.clip(base,0,255).astype(np.uint8)).convert('RGBA')
def make_stars():
    rng=np.random.default_rng(3); im=Image.new('RGBA',(W+400,H+400),(0,0,0,0)); d=ImageDraw.Draw(im)
    for _ in range(int((W*H)/9000)):
        x,y=rng.uniform(0,W+400),rng.uniform(0,H+400); r=rng.choice([0.6,0.9,1.3],p=[.6,.3,.1]); a=int(rng.uniform(40,160))
        c=(210,215,255,a) if rng.random()<.7 else (170,240,255,a)
        d.ellipse([x-r,y-r,x+r,y+r],fill=c)
    return im
BG=make_bg(); STARS=make_stars()
# ---------- helpers ----------
def text_layer(txt,f,fill=WHITE,gradient=False,spacing=0,shadow=True):
    tmp=ImageDraw.Draw(Image.new('L',(10,10)))
    bb=tmp.textbbox((0,0),txt,font=f)
    w=bb[2]-bb[0]+40; h=bb[3]-bb[1]+40
    m=Image.new('L',(w,h),0); ImageDraw.Draw(m).text((20-bb[0],20-bb[1]),txt,font=f,fill=255)
    if gradient: col=grad_img(w,h,LILAC,CYAN,diag=False).convert('RGBA')
    else: col=Image.new('RGBA',(w,h),fill+(255,))
    col.putalpha(m)
    return col
def rich_line(parts,f):
    """parts: list of (text, 'w'|'g'|'m')"""
    ims=[]
    for txt,st in parts:
        ims.append(text_layer(txt,f,fill=WHITE if st=='w' else MUTED,gradient=(st=='g')))
    # measure advance with font to keep spacing natural
    tot=sum(im.width-40 for im in ims)+40; h=max(im.height for im in ims)
    out=Image.new('RGBA',(tot,h),(0,0,0,0)); x=0
    for im,(txt,st) in zip(ims,parts):
        out.alpha_composite(im,(x,0)); x+=im.width-40
    return out
def with_glow(im,rad=18,strength=0.55,col=VIOLET):
    a=im.getchannel('A').filter(ImageFilter.GaussianBlur(rad))
    g=Image.new('RGBA',im.size,col+(0,)); g.putalpha(a.point(lambda v:int(v*strength)))
    pad=Image.new('RGBA',im.size,(0,0,0,0)); pad.alpha_composite(g); pad.alpha_composite(im); return pad
def fade(im,op):
    if op>=0.999: return im
    im=im.copy(); a=im.getchannel('A').point(lambda v:int(v*op)); im.putalpha(a); return im
def paste(frame,im,x,y,op=1.0,anchor='c'):
    if op<=0.003: return
    im=fade(im,op)
    if anchor=='c': x-=im.width//2; y-=im.height//2
    elif anchor=='l': y-=im.height//2
    frame.alpha_composite(im,(int(x),int(y))) if x>=0 and y>=0 and x+im.width<=W and y+im.height<=H else safe_comp(frame,im,int(x),int(y))
def safe_comp(frame,im,x,y):
    tmp=Image.new('RGBA',frame.size,(0,0,0,0)); tmp.paste(im,(x,y)); frame.alpha_composite(tmp)
def scaled(im,s):
    if abs(s-1)<1e-3: return im
    return im.resize((max(1,int(im.width*s)),max(1,int(im.height*s))),Image.LANCZOS)
def rounded_mask(w,h,r):
    m=Image.new('L',(w*2,h*2),0); ImageDraw.Draw(m).rounded_rectangle([0,0,w*2-1,h*2-1],r*2,fill=255); return m.resize((w,h),Image.LANCZOS)
# ---------- logo ----------
LOGO=Image.open(SH+'logo.png').convert('RGBA')
LK=Image.open(SH+'lockup.png').convert('RGBA')
A=np.array(LK.getchannel('A')); occ=A.max(0)>10
wstart=next(i for i in range(520,len(occ)) if occ[i])
WORD=LK.crop((wstart-4,60,1960,515))
def logo_sized(px):
    l=LOGO.resize((px,px),Image.LANCZOS)
    pad=int(px*0.6); big=Image.new('RGBA',(px+2*pad,px+2*pad),(0,0,0,0)); big.alpha_composite(l,(pad,pad))
    glow=big.getchannel('A').filter(ImageFilter.GaussianBlur(px*0.12))
    g1=Image.new('RGBA',big.size,VIOLET+(0,)); g1.putalpha(glow.point(lambda v:int(v*0.9)))
    glow2=big.getchannel('A').filter(ImageFilter.GaussianBlur(px*0.035))
    g2=Image.new('RGBA',big.size,CYAN+(0,)); g2.putalpha(glow2.point(lambda v:int(v*0.6)))
    return big,g1,g2,l
LOGO_BIG=logo_sized(360 if MODE=='h' else 400)
LOGO_SM=logo_sized(170)
def word_sized(w): 
    return WORD.resize((w,int(WORD.height*w/WORD.width)),Image.LANCZOS)
WORD_L=word_sized(560 if MODE=='h' else 620)
WORD_END=word_sized(520 if MODE=='h' else 600)
# ---------- browser card ----------
if MODE=='h': CW,CHh=1180,738
else: CW,CHh=960,1060
BAR=44
def chrome_bar(url):
    im=Image.new('RGBA',(CW,BAR),(18,18,28,255)); d=ImageDraw.Draw(im)
    for i,c in enumerate([(255,95,87),(254,188,46),(40,200,64)]):
        d.ellipse([18+i*22,BAR//2-6,30+i*22,BAR//2+6],fill=c+(200,))
    f=font('body',17,'Medium'); bw=min(CW-220,560); x0=(CW-bw)//2
    d.rounded_rectangle([x0,8,x0+bw,BAR-8],12,fill=(30,30,44,255))
    d.text((CW//2,BAR//2),url,font=f,fill=(190,194,214),anchor='mm')
    return im
MASK=rounded_mask(CW,CHh+BAR,18)
def card_glow():
    pad=90; w,h=CW+2*pad,CHh+BAR+2*pad
    m=Image.new('L',(w,h),0); ImageDraw.Draw(m).rounded_rectangle([pad,pad,pad+CW,pad+CHh+BAR],20,fill=255)
    m=m.filter(ImageFilter.GaussianBlur(38))
    g=grad_img(w,h,VIOLET,CYAN).convert('RGBA'); g.putalpha(m.point(lambda v:int(v*0.55))); 
    # hairline border
    b=Image.new('RGBA',(w,h),(0,0,0,0)); bm=Image.new('L',(w,h),0)
    ImageDraw.Draw(bm).rounded_rectangle([pad-1,pad-1,pad+CW+1,pad+CHh+BAR+1],20,outline=255,width=2)
    bc=grad_img(w,h,LILAC,CYAN).convert('RGBA'); bc.putalpha(bm.point(lambda v:int(v*0.7)))
    g.alpha_composite(bc); return g,pad
GLOW,GPAD=card_glow()
SHOTS={}
def shot(n):
    if n not in SHOTS: SHOTS[n]=Image.open(SH+n+'.png').convert('RGB')
    return SHOTS[n]
def card(name,url,r0,r1,p,bars={}):
    """r=(cx,cy,w) in screenshot coords; p progress 0..1"""
    im=shot(name); e=ease(p)
    cx=r0[0]+(r1[0]-r0[0])*e; cy=r0[1]+(r1[1]-r0[1])*e; w=r0[2]+(r1[2]-r0[2])*e
    w=min(w,im.width,im.height*CW/CHh); h=w*CHh/CW
    x0=max(0,min(im.width-w,cx-w/2)); y0=max(0,min(im.height-h,cy-h/2))
    crop=im.resize((CW,CHh),Image.BICUBIC,box=(x0,y0,x0+w,y0+h))
    key=(name,url)
    if key not in bars: bars[key]=chrome_bar(url)
    c=Image.new('RGBA',(CW,CHh+BAR)); c.paste(bars[key],(0,0)); c.paste(crop,(0,BAR)); c.putalpha(MASK)
    out=GLOW.copy(); out.alpha_composite(c,(GPAD,GPAD)); return out
# ---------- toml card ----------
def toml_card():
    lines=open(SH+'toml.txt').read().splitlines()
    keep=[l for l in lines if l.strip()][:22]
    keep=[l if len(l)<70 else l[:67]+'…' for l in keep]
    c=Image.new('RGBA',(CW,CHh+BAR),(12,12,20,255)); c.paste(chrome_bar('yogibear1323.github.io/.well-known/stellar.toml'),(0,0))
    d=ImageDraw.Draw(c); f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',22 if MODE=='h' else 20)
    y=BAR+24
    for l in keep:
        col=(120,124,150) if l.startswith('#') else ((196,181,253) if l.startswith('[') else (220,224,240))
        if '=' in l and not l.startswith('#'):
            k,v=l.split('=',1); d.text((28,y),k+'=',font=f,fill=(125,211,252)); kw=d.textlength(k+'=',font=f); d.text((28+kw,y),v,font=f,fill=(230,232,245))
        else: d.text((28,y),l,font=f,fill=col)
        y+=int(f.size*1.45)
        if y>CHh+BAR-30: break
    c.putalpha(MASK); out=GLOW.copy(); out.alpha_composite(c,(GPAD,GPAD)); return out
TOML=toml_card()
# ---------- text cards cache ----------
TC={}
def T(key,fn):
    if key not in TC: TC[key]=fn()
    return TC[key]
HS = 150 if MODE=='h' else 128   # hook size
PS = 80 if MODE=='h' else 86     # product headline
SS = 34 if MODE=='h' else 38     # sub
def head(txt,size,grad_word=None):
    f=font('head',size,'Bold')
    if grad_word and grad_word in txt:
        tmp=ImageDraw.Draw(Image.new('L',(10,10))); bb=tmp.textbbox((0,0),txt,font=f)
        w=bb[2]-bb[0]+40; h=bb[3]-bb[1]+40
        m=Image.new('L',(w,h),0); ImageDraw.Draw(m).text((20-bb[0],20-bb[1]),txt,font=f,fill=255)
        i=txt.index(grad_word); x1=20-bb[0]+tmp.textlength(txt[:i],font=f); x2=20-bb[0]+tmp.textlength(txt[:i+len(grad_word)],font=f)
        col=np.zeros((h,w,3)); col[:]=WHITE
        xs=np.arange(w); g=np.clip((xs-x1)/max(1,x2-x1),0,1)
        for c in range(3): col[:,:,c]=np.where((xs>=x1-2)[None,:], LILAC[c]+(CYAN[c]-LILAC[c])*g[None,:], WHITE[c])
        im=Image.fromarray(col.astype(np.uint8)).convert('RGBA'); im.putalpha(m); return im
    return text_layer(txt,f)
def sub(txt,size=SS,col=MUTED,weight='Medium'):
    return text_layer(txt,font('body',size,weight),fill=col)
def pill(txt):
    f=font('body',30,'SemiBold'); tmp=ImageDraw.Draw(Image.new('L',(1,1))); w=int(tmp.textlength(txt,font=f))+70; h=62
    im=Image.new('RGBA',(w+20,h+20),(0,0,0,0)); m=Image.new('L',im.size,0); ImageDraw.Draw(m).rounded_rectangle([10,10,10+w,10+h],h//2,outline=255,width=2)
    g=grad_img(*im.size,VIOLET,CYAN).convert('RGBA'); g.putalpha(m); im.alpha_composite(g)
    ImageDraw.Draw(im).text((10+w//2,10+h//2),txt,font=f,fill=WHITE,anchor='mm')
    return with_glow(im,10,0.5)
# ---------- scenes ----------
def product(frame,t,a,b,name,url,r0,r1,h1,s1,s1col=MUTED,grad=None,small=None,rv=None):
    op=env(t,a,b,0.5,0.5)
    if op<=0: return
    p=(t-a)/(b-a)
    if MODE=='v' and rv: r0,r1=rv
    c=card(name,url,r0,r1,p)
    rise=(1-eout((t-a)/0.8))
    l1,_,l2=h1.partition('|'); hl=T(('h',l1,PS),lambda:head(l1,PS,grad)); hl2=T(('h2',l2,PS),lambda:head(l2,PS,grad)) if l2 else None; sl=T(('s',s1),lambda:sub(s1,SS,s1col)) if s1 else None
    sm=T(('sm',small),lambda:sub(small,26 if MODE=='h' else 30,(150,154,176),'Regular')) if small else None
    if MODE=='h':
        cs=0.97+0.03*ease(p)
        cc=scaled(c,cs); paste(frame,cc,1255+30*rise,540,op)
        tx=100
        y0=440 if hl2 else 480
        paste(frame,hl,tx-20,y0+40*rise,op,'l')
        if hl2: paste(frame,hl2,tx-20,y0+100+45*rise,env(t,a+0.2,b,0.5,0.5),'l'); y0+=100
        if sl: paste(frame,sl,tx-20,y0+95+50*rise,env(t,a+0.35,b,0.5,0.5),'l')
        if sm: paste(frame,sm,tx-20,y0+(160 if sl else 100)+50*rise,env(t,a+0.5,b,0.5,0.5),'l')
    else:
        cs=0.97+0.03*ease(p)
        cc=scaled(c,cs); paste(frame,cc,W//2,1150+40*rise,op)
        y0=300 if hl2 else 330
        paste(frame,hl,W//2,y0+40*rise,op)
        if hl2: paste(frame,hl2,W//2,y0+100+45*rise,env(t,a+0.2,b,0.5,0.5)); y0+=100
        if sl: paste(frame,sl,W//2,y0+105+50*rise,env(t,a+0.35,b,0.5,0.5))
        if sm: paste(frame,sm,W//2,y0+(165 if sl else 100)+50*rise,env(t,a+0.5,b,0.5,0.5))
def hook_text(frame,t,a,b,txt,y,grad=None,size=HS):
    op=env(t,a,b,0.55,0.5)
    if op<=0: return
    im=T(('hook',txt,size),lambda:with_glow(head(txt,size,grad),22,0.35))
    k=eout((t-a)/1.2); s=0.94+0.06*k + 0.015*((t-a)/(b-a))
    paste(frame,scaled(im,s),W//2,y+(1-k)*30,op)
def draw_logo(frame,t,cx,cy,L,scale,op,glow_boost=0.0):
    big,g1,g2,l=L
    gb=min(1.0,0.6+glow_boost)
    for im,o in [(g1,op*gb),(g2,op*min(1,0.7+glow_boost))]:
        paste(frame,scaled(im,scale*(1+0.04*glow_boost)),cx,cy,o)
    paste(frame,scaled(big,scale),cx,cy,op)
def render(t):
    fr=BG.copy()
    # stars drift
    ox=int(200+120*math.sin(t/30)); oy=int(200-t*2.2)
    fr.alpha_composite(STARS.crop((ox,oy,ox+W,oy+H)))
    # ===== 1 logo reveal 0-6
    if t<6.2:
        op=env(t,0.4,6.1,1.4,0.7)
        k=eout((t-0.4)/2.4); s=0.82+0.18*k+0.02*max(0,t-2.8)/3
        boost=max(0,1-abs(t-2.3)/1.4)*0.8
        cy = H//2-60 if MODE=='h' else H//2-120
        # light flare behind
        if t>1.2:
            fl=T('flare',lambda:flare())
            paste(fr,scaled(fl,0.6+0.5*k),W//2,cy,op*0.8*(0.5+0.5*boost))
        draw_logo(fr,t,W//2,cy,LOGO_BIG,s,op,boost)
        wop=env(t,2.8,6.1,1.0,0.7)
        paste(fr,WORD_L,W//2,cy+(300 if MODE=='h' else 340)+ (1-eout((t-2.8)/1.2))*25,wop)
    # ===== 2 hook 6-14
    hy=H//2
    if MODE=='h':
        hook_text(fr,t,6.2,8.9,'Your money.',hy-90)
        hook_text(fr,t,7.3,8.9,'Your rules.',hy+90,'rules.')
    else:
        hook_text(fr,t,6.2,8.9,'Your money.',hy-90,None,120)
        hook_text(fr,t,7.3,8.9,'Your rules.',hy+90,'rules.',120)
    if MODE=='h':
        hook_text(fr,t,9.1,11.35,'Be your own bank.',hy,'bank.')
        hook_text(fr,t,11.5,14.0,'At your own pace.',hy,'pace.')
    else:
        hook_text(fr,t,9.1,11.35,'Be your own',hy-80,None,120); hook_text(fr,t,9.1,11.35,'bank.',hy+70,'bank.',140)
        hook_text(fr,t,11.5,14.0,'At your',hy-80,None,120); hook_text(fr,t,11.5,14.0,'own pace.',hy+70,'pace.',130)
    # ===== 3 product 14-38
    B='yogibear1323.github.io/quasaria'
    product(fr,t,14.0,19.8,'home',B+'/',(960,420,1700),(820,380,1150),'No middleman.','Trade from your own wallet.',grad='middleman.',
            rv=((830,420,1000),(700,380,760)))
    product(fr,t,19.6,25.4,'pools',B+'/pools',(960,560,1800),(900,640,1250),'Put your money','to work.',LILAC if False else WHITE,small='Rewards vary. Testnet preview.',
            rv=((500,650,1000),(560,700,760))) if False else None
    pools(fr,t)
    product(fr,t,25.2,30.4,'quests',B+'/quests',(960,500,1800),(800,700,1150),'Learn at|your own pace.',None,grad='pace.',small='Quests, levels and badges.',
            rv=((560,560,1000),(560,900,760)))
    product(fr,t,30.2,34.5,'trade',B+'/trade',(960,540,1900),(900,500,1300),'No bank hours.','Open whenever you are.',grad='hours.',
            rv=((700,560,1000),(760,560,800)))
    product(fr,t,34.3,38.2,'merch',B+'/merch',(960,600,1900),(960,640,1350),'One growing|ecosystem.','News, quests, merch and more.',grad='ecosystem.',
            rv=((960,700,1250),(920,760,1080)))
    # ===== 4 verified 38-43
    verified(fr,t)
    # ===== keys / simple 43-48
    product(fr,t,43.0,45.9,'home','yogibear1323.github.io/quasaria/',(960,4070,1400),(960,4110,1250),'Your keys|stay with you.','Only you hold them.',grad='you.',
            rv=((760,4000,1000),(740,4050,880)))
    product(fr,t,45.7,48.3,'home','yogibear1323.github.io/quasaria/',(960,12180,1500),(960,12200,1250),'Simple enough|for anyone.','A few clicks to get started.',grad='anyone.',
            rv=((960,12180,1100),(960,12200,900)))
    # ===== 5 coming soon 48-54
    coming(fr,t)
    # ===== 6 end card 54-60
    endcard(fr,t)
    # global fade in/out
    g=min(1,t/0.4, (DUR-t)/0.9)
    if g<1:
        blk=Image.new('RGBA',(W,H),(0,0,0,int(255*(1-max(0,g)))))
        fr.alpha_composite(blk)
    return fr.convert('RGB')
def pools(fr,t):
    a,b=19.6,25.4
    op=env(t,a,b,0.5,0.5)
    if op<=0: return
    p=(t-a)/(b-a)
    if MODE=='h': c=card('pools','yogibear1323.github.io/quasaria/pools',(960,560,1800),(900,640,1250),p)
    else: c=card('pools','yogibear1323.github.io/quasaria/pools',(520,650,1000),(560,700,760),p)
    rise=(1-eout((t-a)/0.8))
    h1=T(('h','Put your money',PS),lambda:head('Put your money',PS)); h2=T(('h2','to work.',PS),lambda:head('to work.',PS,'work.'))
    sm=T(('sm','Rewards vary. Testnet preview.'),lambda:sub('Rewards vary. Testnet preview.',26 if MODE=='h' else 30,(150,154,176),'Regular'))
    cs=0.97+0.03*ease(p)
    if MODE=='h':
        paste(fr,scaled(c,cs),1255+30*rise,540,op)
        paste(fr,h1,80,440+40*rise,op,'l'); paste(fr,h2,80,540+45*rise,env(t,a+0.2,b,0.5,0.5),'l')
        paste(fr,sm,80,640+50*rise,env(t,a+0.5,b,0.5,0.5),'l')
    else:
        paste(fr,scaled(c,cs),W//2,1150+40*rise,op)
        paste(fr,h1,W//2,300+40*rise,op); paste(fr,h2,W//2,400+45*rise,env(t,a+0.2,b,0.5,0.5))
        paste(fr,sm,W//2,500+50*rise,env(t,a+0.5,b,0.5,0.5))
def verified(fr,t):
    a,b=38.2,43.2
    op=env(t,a,b,0.5,0.5)
    if op<=0: return
    p=(t-a)/(b-a); rise=(1-eout((t-a)/0.8))
    # explorer glimpse behind (dimmed), then toml in front
    ex=card('tx','stellar.expert/explorer/testnet/tx/f9fe7c2d…a78c',(960,380,1500),(700,480,1000),p)
    h1=T(('h','Verified on',PS),lambda:head('Verified on',PS)); h2=T(('h2','Stellar.',PS),lambda:head('Stellar.',PS,'Stellar.'))
    sl=T(('s','home'),lambda:sub('Home domain: yogibear1323.github.io',SS-4 if MODE=='h' else SS-6,(200,204,224)))
    tiny=T('tiny',lambda:sub('Testnet account GDAEZ…NKCY · ledger 4,950,291 · tx f9fe7c2d…a78c',20 if MODE=='h' else 22,(120,124,146),'Regular'))
    if MODE=='h':
        paste(fr,scaled(ex,0.78+0.02*p),1330+20*rise,420,op*0.9)
        paste(fr,scaled(TOML,0.72+0.03*ease(p)),1130-40*eout(p),640,env(t,a+0.4,b,0.6,0.5))
        paste(fr,h1,80,440+40*rise,op,'l'); paste(fr,h2,80,540+45*rise,env(t,a+0.2,b,0.5,0.5),'l')
        paste(fr,sl,80,640+50*rise,env(t,a+0.5,b,0.5,0.5),'l')
        paste(fr,tiny,W//2,H-50,env(t,a+0.8,b,0.5,0.5))
    else:
        paste(fr,scaled(ex,0.72),W//2,1060+20*rise,op*0.9)
        paste(fr,scaled(TOML,0.7+0.03*ease(p)),W//2,1400-30*eout(p),env(t,a+0.4,b,0.6,0.5))
        paste(fr,h1,W//2,300+40*rise,op); paste(fr,h2,W//2,400+45*rise,env(t,a+0.2,b,0.5,0.5))
        paste(fr,sl,W//2,500+50*rise,env(t,a+0.5,b,0.5,0.5))
        paste(fr,tiny,W//2,H-110,env(t,a+0.8,b,0.5,0.5))
def coming(fr,t):
    a,b=48.2,54.1
    op=env(t,a,b,0.6,0.6)
    if op<=0: return
    rise=(1-eout((t-a)/1.0))
    pl=T('pill',lambda:pill('COMING SOON'))
    if MODE=='h':
        h1=T(('c1'),lambda:with_glow(head('Borrow and lend',128,'lend'),22,0.35))
        h2=T(('c2'),lambda:head('on your terms.',84))
        paste(fr,pl,W//2,330+30*rise,op)
        paste(fr,h1,W//2,500+40*rise,env(t,a+0.2,b,0.6,0.6))
        paste(fr,h2,W//2,640+45*rise,env(t,a+0.5,b,0.6,0.6))
        s3=T('c3',lambda:sub('Supply  ·  Borrow  ·  Your keys',34,(190,194,214)))
        paste(fr,s3,W//2,760+50*rise,env(t,a+0.9,b,0.6,0.6))
    else:
        h1=T(('c1v'),lambda:with_glow(head('Borrow',140),22,0.35)); h1b=T(('c1bv'),lambda:with_glow(head('and lend',140,'lend'),22,0.35))
        h2=T(('c2v'),lambda:head('on your terms.',84))
        paste(fr,pl,W//2,620+30*rise,op)
        paste(fr,h1,W//2,820+40*rise,env(t,a+0.2,b,0.6,0.6)); paste(fr,h1b,W//2,980+40*rise,env(t,a+0.3,b,0.6,0.6))
        paste(fr,h2,W//2,1130+45*rise,env(t,a+0.5,b,0.6,0.6))
        s3=T('c3',lambda:sub('Supply  ·  Borrow  ·  Your keys',36,(190,194,214)))
        paste(fr,s3,W//2,1260+50*rise,env(t,a+0.9,b,0.6,0.6))
    # orbit ring accent
    ring=T('ring',lambda:orbit())
    paste(fr,scaled(ring,1+0.03*((t-a)/(b-a))),W//2,(540 if MODE=='h' else 950),op*0.5)
def orbit():
    s=1500 if MODE=='h' else 1050
    im=Image.new('RGBA',(s,s),(0,0,0,0)); m=Image.new('L',(s,s),0); d=ImageDraw.Draw(m)
    d.ellipse([60,s*0.3,s-60,s*0.7],outline=255,width=3)
    m=m.filter(ImageFilter.GaussianBlur(2)); g=grad_img(s,s,VIOLET,CYAN).convert('RGBA'); g.putalpha(m.point(lambda v:int(v*0.6)))
    return g
def flare():
    s=900; yy,xx=np.mgrid[0:s,0:s].astype(np.float32)-s/2
    r=np.sqrt(xx**2+yy**2)
    core=np.exp(-(r/(s*0.18))**2)
    streak=np.exp(-(yy/6)**2)*np.exp(-(np.abs(xx)/(s*0.35)))
    a=np.clip(core*0.55+streak*0.8,0,1)
    im=np.zeros((s,s,4),np.uint8)
    col=np.array([150,120,255])*(1-np.clip(r/(s/2),0,1))[...,None]+np.array([34,211,238])*np.clip(r/(s/2),0,1)[...,None]
    im[...,:3]=np.clip(col*0.6+255*np.clip(streak,0,1)[...,None]*0.4,0,255); im[...,3]=(a*255).astype(np.uint8)
    return Image.fromarray(im).rotate(-20,resample=Image.BICUBIC)
def endcard(fr,t):
    a=54.1
    if t<a: return
    op=env(t,a,70,0.9,0.1)
    k=eout((t-a)/1.6)
    boost=max(0,1-abs(t-54.4)/1.2)*0.6
    if MODE=='h':
        cy=380
        draw_logo(fr,t,W//2,cy,LOGO_SM,0.9+0.1*k,op,boost)
        paste(fr,WORD_END,W//2,cy+200+20*(1-k),env(t,a+0.4,70,0.8,0.1))
        u=T('url',lambda:sub('yogibear1323.github.io/quasaria',44,(220,224,240),'SemiBold'))
        paste(fr,u,W//2,cy+330+20*(1-k),env(t,a+0.9,70,0.8,0.1))
        ln=T('line',lambda:line_grad(420))
        paste(fr,ln,W//2,cy+400,env(t,a+1.1,70,0.8,0.1))
        d=T('disc',lambda:sub('Testnet preview. Not financial advice. Unaudited.',26,(140,144,166),'Regular'))
        paste(fr,d,W//2,H-90,env(t,a+1.3,70,0.8,0.1))
    else:
        cy=700
        draw_logo(fr,t,W//2,cy,LOGO_SM,1.1+0.1*k,op,boost)
        paste(fr,WORD_END,W//2,cy+250+20*(1-k),env(t,a+0.4,70,0.8,0.1))
        u=T('url',lambda:sub('yogibear1323.github.io/quasaria',44,(220,224,240),'SemiBold'))
        paste(fr,u,W//2,cy+400+20*(1-k),env(t,a+0.9,70,0.8,0.1))
        ln=T('line',lambda:line_grad(420))
        paste(fr,ln,W//2,cy+470,env(t,a+1.1,70,0.8,0.1))
        d1=T('disc1',lambda:sub('Testnet preview. Not financial advice.',30,(140,144,166),'Regular'))
        d2=T('disc2',lambda:sub('Unaudited.',30,(140,144,166),'Regular'))
        paste(fr,d1,W//2,H-190,env(t,a+1.3,70,0.8,0.1)); paste(fr,d2,W//2,H-145,env(t,a+1.3,70,0.8,0.1))
def line_grad(w):
    im=grad_img(w,3,VIOLET,CYAN,False).convert('RGBA')
    a=np.clip(1-np.abs(np.linspace(-1,1,w)),0,1)**0.6; im.putalpha(Image.fromarray(np.tile((a*255).astype(np.uint8),(3,1)))); return im
if ONLY:
    for tt in ONLY: render(tt).save(f'/tmp/prev_{MODE}_{tt:05.1f}.png')
    sys.exit()
ff=subprocess.Popen(['ffmpeg','-y','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-',
    '-i','mix.wav','-map','0:v','-map','1:a','-c:v','libx264','-preset','slow','-crf','19','-tune','film','-pix_fmt','yuv420p',
    '-profile:v','high','-level','4.1','-g','60','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart','-shortest',OUTF],stdin=subprocess.PIPE)
import time; t0=time.time()
for i in range(NF):
    ff.stdin.write(render(i/FPS).tobytes())
    if i%150==0: print(i, round(time.time()-t0,1), flush=True)
ff.stdin.close(); ff.wait(); print('done', ff.returncode)
