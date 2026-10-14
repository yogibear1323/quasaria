# Quasaria light pearl theme for video renderers (tokens from yogibear1323/quasaria frontend/src/theme/tokens.css)
# exec()'d inside a renderer after W,H are defined. Provides make_bg_light(), light_fx(fr,t), PEARL.
import numpy as _np, math as _m
from PIL import Image as _I, ImageDraw as _D, ImageFilter as _F
PEARL=(245,246,253); INK=(27,22,64); INK2=(74,68,112); INK3=(93,87,127)
NVIOLET=(139,92,246); NCYAN=(6,182,212); NMAG=(232,121,249); GOLD=(232,163,61); HONEY=(242,184,75); TVIOLET=(109,40,217); TCYAN=(14,116,144); TMAG=(162,28,175)
def make_bg_light():
    yy,xx=_np.mgrid[0:H,0:W].astype(_np.float32); b=_np.zeros((H,W,3),_np.float32); b[:]=PEARL
    top=_np.clip(1-yy/H,0,1)[...,None]; b=b*(1-0.04*top)+_np.array([255,255,255])*0.04*top
    b+=_np.random.default_rng(1).normal(0,0.9,b.shape)
    return _I.fromarray(_np.clip(b,0,255).astype(_np.uint8)).convert('RGBA')
def _blob(px,col,a):
    yy,xx=_np.mgrid[0:px,0:px].astype(_np.float32)-px/2; d=_np.exp(-((xx**2+yy**2)/(2*(px*0.2)**2)))
    im=_np.zeros((px,px,4),_np.uint8); im[...,:3]=col; im[...,3]=_np.clip(d*a*255,0,255).astype(_np.uint8); return _I.fromarray(im)
def _band(w,h,col,a):
    yy=_np.linspace(-1,1,h)[:,None]*_np.ones((1,w)); d=_np.exp(-(yy**2)/0.08)
    im=_np.zeros((h,w,4),_np.uint8); im[...,:3]=col; im[...,3]=_np.clip(d*a*255,0,255).astype(_np.uint8)
    return _I.fromarray(im)
_M=max(W,H); _BS=int(_M*0.85)
_BL=[_blob(_BS,NVIOLET,0.20),_blob(_BS,NCYAN,0.16),_blob(int(_BS*0.8),NMAG,0.13),_blob(int(_BS*0.7),GOLD,0.18)]
_BANDS=[_band(int(_M*1.9),int(_M*0.30),c,a).rotate(ang,expand=True,resample=_I.BICUBIC) for c,a,ang in ((NVIOLET,0.10,-16),(NCYAN,0.08,12),(NMAG,0.07,-6),(HONEY,0.10,9))]
_HOR=int(H*0.72) if W>H else int(H*0.78)
_GRID={}
def _grid(ph):
    k=int(ph*24)%24
    if k in _GRID: return _GRID[k]
    ph=k/24; gh=H-_HOR; s=2
    lay=_I.new('L',(W*s,gh*s),0); d=_D.Draw(lay); cx=W*s/2
    for i in range(-26,27):
        d.line([(cx+i*W*s*0.012,0),(cx+i*W*s*0.20,gh*s)],fill=150,width=2*s)
    for j in range(14):
        z=(j+1-ph); 
        if z<=0: continue
        y=gh*s*(1.6/z) / 1.6 * 0.95
        y=gh*s*((1/(z*0.55))-0.12)
        if 0<y<gh*s: d.line([(0,y),(W*s,y)],fill=int(min(170,40+130*y/(gh*s))),width=2*s)
    lay=lay.resize((W,gh),_I.LANCZOS)
    fadem=_np.clip(_np.linspace(0,1,gh)[:,None]*1.6,0,1)*_np.ones((1,W)); a=_np.asarray(lay).astype(_np.float32)*fadem
    col=_np.zeros((gh,W,4),_np.uint8)
    xx=_np.linspace(0,1,W)[None,:]*_np.ones((gh,1))
    for c in range(3): col[...,c]=(NVIOLET[c]*(1-xx)+NCYAN[c]*xx).astype(_np.uint8)
    col[...,3]=_np.clip(a*0.55,0,255).astype(_np.uint8)
    g=_I.fromarray(col); glow_=g.filter(_F.GaussianBlur(3)); out=_I.new('RGBA',g.size,(0,0,0,0)); out.alpha_composite(glow_); out.alpha_composite(g)
    # horizon glow
    hz=_band(W,60,GOLD,0.45); out.alpha_composite(hz.crop((0,30,W,60)),(0,0))
    _GRID[k]=out; return out
def _pc(fr,im,x,y):
    x,y=int(x),int(y); x0,y0=max(0,-x),max(0,-y); x1,y1=min(im.width,W-x),min(im.height,H-y)
    if x1>x0 and y1>y0: fr.alpha_composite(im.crop((x0,y0,x1,y1)),(x+x0,y+y0))
def light_fx(fr,t,speed=0.25):
    m=_M
    _pc(fr,_BL[0],W*0.15+m*0.08*_m.sin(t*0.21)-_BS/2,H*0.18+m*0.06*_m.cos(t*0.17)-_BS/2)
    _pc(fr,_BL[1],W*0.88+m*0.07*_m.cos(t*0.19)-_BS/2,H*0.80+m*0.06*_m.sin(t*0.23)-_BS/2)
    s2=_BL[2].width; _pc(fr,_BL[2],W*0.72+m*0.1*_m.sin(t*0.13+1)-s2/2,H*0.22+m*0.08*_m.sin(t*0.16+2)-s2/2)
    s3=_BL[3].width; _pc(fr,_BL[3],W*0.5+m*0.09*_m.cos(t*0.12+0.5)-s3/2,H*0.55+m*0.05*_m.sin(t*0.15)-s3/2)
    for i,b in enumerate(_BANDS):
        _pc(fr,b,W/2-b.width/2+m*0.12*_m.sin(t*0.11+i*2.1),H*(0.25+0.25*i)-b.height/2+m*0.06*_m.cos(t*0.09+i))
    _pc(fr,_grid((t*speed)%1.0),0,_HOR)
