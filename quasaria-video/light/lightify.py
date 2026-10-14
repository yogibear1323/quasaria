import re,sys,colorsys
LT='/workspace/quasaria-video/light/lighttheme.py'; BR='/workspace/quasaria-video/light/brand/'
FIX={(196,181,253):(109,40,217),(34,211,238):(8,145,178),(165,243,252):(6,182,212),(124,92,255):(124,58,237),
     (139,124,255):(124,58,237),(150,110,255):(139,92,246),(253,224,71):(180,83,9),(251,191,36):(180,83,9),(250,204,21):(180,83,9),
     (52,211,153):(4,120,87),(160,235,255):(8,145,178),(215,215,255):(139,92,246),(255,95,87):None,(254,188,46):None,(40,200,64):None}
def mapc(r,g,b):
    if (r,g,b) in FIX: return FIX[(r,g,b)] or (r,g,b)
    h,l,s=colorsys.rgb_to_hls(r/255,g/255,b/255); L=0.3*r+0.59*g+0.11*b
    if L<75: # dark surface -> light surface
        k=L/75; return (int(255-12*k),int(255-14*k),int(255-4*k))
    if s<0.35 or L>200:
        if L>215: return (27,22,64)
        if L>170: return (61,55,100)
        if L>120: return (93,87,127)
        return (150,145,180)
    return (r,g,b)
def sub(m):
    r,g,b=int(m.group(1)),int(m.group(2)),int(m.group(3))
    if max(r,g,b)>255: return m.group(0)
    nr,ng,nb=mapc(r,g,b); return f'({nr},{ng},{nb}{m.group(4) or ""}'
def lightify(src,dst,extra=()):
    s=open(src).read()
    s=re.sub(r'\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})(\s*[,)])',lambda m:m.group(0) if re.search(r'(\bin|normal|range|uniform|integers)\s*$',s[max(0,m.start()-12):m.start()]) else sub(m),s)
    s=s.replace("(W,H),(27,22,64,int(255*a*0.5)","(W,H),(255,255,255,int(255*a*0.5)").replace("(W,H),(27,22,64,int(","(W,H),(245,246,253,int(")
    for a,b in extra: s=s.replace(a,b)
    open(dst,'w').write(s)
if __name__=='__main__': lightify(sys.argv[1],sys.argv[2])
