# Earthy recolor: violet/blue/magenta -> clay/terracotta/umber/sand, cyan -> moss. Lightness kept.
import numpy as np, colorsys
def _w(h,a,b,e=12):  # soft membership of hue h (deg) in [a,b]
    return np.clip((h-(a-e))/e,0,1)*np.clip(((b+e)-h)/e,0,1)
def earth_arr(rgb):  # float array (...,3) in 0..1
    r,g,b=rgb[...,0],rgb[...,1],rgb[...,2]
    mx=rgb.max(-1); mn=rgb.min(-1); l=(mx+mn)/2; d=mx-mn
    den=np.where(l<0.5,mx+mn,2-mx-mn); s=np.where(d<1e-6,0,d/np.maximum(den,1e-9))
    h=np.zeros_like(l); dd=np.where(d<1e-6,1,d)
    h=np.where(mx==r,((g-b)/dd)%6,np.where(mx==g,(b-r)/dd+2,(r-g)/dd+4))*60
    h=np.where(d<1e-6,0,h)
    wv=_w(h,204,335,10); wc=_w(h,160,198,8)*(1-wv)
    sat_gate=np.clip((s-0.06)/0.08,0,1); wv*=sat_gate; wc*=sat_gate
    # violet target: hue 22 mid, 30 dark (umber), 36 light (sand)
    th=np.where(l<0.3,28,np.where(l>0.82,36,20)).astype(float)
    ts=np.where(l<0.3,np.minimum(s,0.42),np.where(l>0.82,np.minimum(s,0.45),np.minimum(s*0.85,0.62)))
    ch=th; cs=ts
    mh=np.full_like(h,84.); ms=np.minimum(s*0.6,0.38)
    def hls2rgb(H,L,S):
        C=(1-np.abs(2*L-1))*S; X=C*(1-np.abs((H/60)%2-1)); m=L-C/2; z=np.zeros_like(H); k=(H//60)%6
        R=np.select([k==0,k==1,k==2,k==3,k==4,k==5],[C,X,z,z,X,C]); G=np.select([k==0,k==1,k==2,k==3,k==4,k==5],[X,C,C,X,z,z]); B=np.select([k==0,k==1,k==2,k==3,k==4,k==5],[z,z,X,C,C,X])
        return np.stack([R+m,G+m,B+m],-1)
    lv=np.where((l>=0.3)&(l<=0.82),l*0.82,l); v=hls2rgb(ch,lv,cs); c=hls2rgb(mh,l,ms)
    out=rgb*(1-wv-wc)[...,None]+v*wv[...,None]+c*wc[...,None]
    return np.clip(out,0,1)
def earth(r,g,b):
    o=earth_arr(np.array([[r/255,g/255,b/255]],float))[0]; return tuple(int(round(x*255)) for x in o)
def write_cube(path,n=33):
    g=np.linspace(0,1,n); B,G,R=np.meshgrid(g,g,g,indexing='ij'); a=np.stack([R,G,B],-1).reshape(-1,3)
    o=earth_arr(a)
    with open(path,'w') as f:
        f.write(f'LUT_3D_SIZE {n}\n'); [f.write(f'{x[0]:.6f} {x[1]:.6f} {x[2]:.6f}\n') for x in o]
if __name__=='__main__':
    write_cube('/workspace/quasaria-video/earthy/earthy.cube')
    for c in [(139,92,246),(109,40,217),(6,182,212),(27,22,64),(245,246,253),(232,163,61),(122,52,21),(20,24,48),(232,121,249)]: print(c,earth(*c))
