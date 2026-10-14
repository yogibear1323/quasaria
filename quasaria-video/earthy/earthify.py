# Generate *_earthy counterparts of every *_light pipeline file (never touches originals/light files).
import re,os,sys,glob
sys.path.insert(0,'/workspace/quasaria-video/earthy'); from earthcolor import earth
V='/workspace/quasaria-video'; CB=os.environ.get('CB','earthy-20261013')
files=[f for f in glob.glob(V+'/**/*',recursive=True) if re.search(r'(_light[^/]*\.(py|mjs|sh)|render_light\.py)$',f) and '/light/' not in f and 'node_modules' not in f and '__pycache__' not in f]
def ren(s):
    s=s.replace('/light/lighttheme.py','/earthy/earthytheme.py').replace('/light/brand/','/earthy/brand/').replace('/light/mux.sh','/earthy/mux.sh')
    s=re.sub(r'(?<![A-Za-z])(make_bg)_light','\\1_LIGHTKEEP',s)
    s=re.sub(r'([A-Za-z0-9])_light',r'\1_earthy',s)
    s=re.sub(r'(?<=[A-Za-z0-9\}\)$])-light(?=[._/\-\'"\s$`]|$)','-earthy',s)
    s=s.replace('logs/light_','logs/earthy_').replace('raw-light','raw-earthy')
    s=s.replace('_LIGHTKEEP','_light')
    s=re.sub(r'\bv=gold-20261011\b','v='+CB,s)
    s=re.sub(r"\b(art(?:8|9|10)?)/",r"\1_earthy/",s)
    s=re.sub(r"(['\"])metals/",r"\1metals_earthy/",s)
    s=re.sub(r"f'metals/",r"f'metals_earthy/",s)
    s=re.sub(r"f'icons/",r"f'icons/",s)
    return s
def colors(s):
    def sub(m):
        r,g,b=int(m.group(1)),int(m.group(2)),int(m.group(3))
        if max(r,g,b)>255: return m.group(0)
        if re.search(r'(\bin|normal|range|uniform|integers|resize|crop|paste|size|xy|mgrid)\s*\(?\s*$',s[max(0,m.start()-14):m.start()]): return m.group(0)
        nr,ng,nb=earth(r,g,b); return f'({nr},{ng},{nb}{m.group(4)}'
    s=re.sub(r'\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})(\s*[,)])',sub,s)
    def hx(m):
        h=m.group(1); r,g,b=int(h[0:2],16),int(h[2:4],16),int(h[4:6],16); nr,ng,nb=earth(r,g,b); return '#%02x%02x%02x'%(nr,ng,nb)
    s=re.sub(r'#([0-9a-fA-F]{6})\b',hx,s)
    return s
for f in files:
    d,b=os.path.split(f); nb=b.replace('_light','_earthy')
    s=ren(open(f).read())
    if f.endswith('.py'): s=colors(s)
    out=os.path.join(d,nb); open(out,'w').write(s)
    if f.endswith('.sh'): os.chmod(out,0o755)
    print(out)
