import re,os,sys,shutil,glob
sys.path.insert(0,'/workspace/quasaria-video/earthy'); from earthcolor import earth
def rec(s):
    s=re.sub(r'#([0-9a-fA-F]{6})\b',lambda m:'#%02x%02x%02x'%earth(*[int(m.group(1)[i:i+2],16) for i in (0,2,4)]),s)
    s=re.sub(r'#([0-9a-fA-F]{3})\b(?![0-9a-fA-F])',lambda m:'#%02x%02x%02x'%earth(*[int(c*2,16) for c in m.group(1)]),s)
    s=re.sub(r'rgba?\((\d+),\s*(\d+),\s*(\d+)',lambda m:m.group(0).split('(')[0]+'(%d,%d,%d'%earth(*map(int,m.groups())),s)
    return s
for src in sys.argv[1:]:
    dst=src.rstrip('/')+'_earthy'; shutil.rmtree(dst,ignore_errors=True); shutil.copytree(src,dst)
    for f in glob.glob(dst+'/**/*.svg',recursive=True):
        t=rec(open(f).read()); open(f,'w').write(t)
    for f in glob.glob(dst+'/**/*.json',recursive=True):
        t=rec(open(f).read()); open(f,'w').write(t)
    print(dst)
