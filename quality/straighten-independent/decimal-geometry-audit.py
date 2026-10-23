"""Independent 100-digit trig / active-constraint crop oracle. No production edits."""
import decimal,json,math,subprocess,sys,random,os
from decimal import Decimal as D
from pathlib import Path
decimal.getcontext().prec=100
PI=D('3.1415926535897932384626433832795028841971693993751058209749445923078164062862089986280348253421170679')
TARGET=sys.argv[1] if len(sys.argv)>1 else str(Path(os.environ.get('MINT_APP_ROOT',Path(__file__).resolve().parents[2]))/'app/src/main/assets/straighten.js')
def trig(degrees):
    x=D.from_float(float(degrees))*PI/D(180)
    sine=term=x; cosine=cterm=D(1)
    for n in range(1,180):
        term*=-x*x/D((2*n)*(2*n+1));sine+=term
        cterm*=-x*x/D((2*n-1)*(2*n));cosine+=cterm
    return abs(cosine),abs(sine)
def oracle(w,h,a,mode):
    if a%90==0:return (h,w) if int(a/90)%2 else (w,h)
    c,s=trig(a)
    if mode=='expand':
        return tuple(int(x.to_integral_value(rounding=decimal.ROUND_CEILING)) for x in (c*w+s*h,s*w+c*h))
    W,H=D(w-1),D(h-1)
    if not W or not H:return 1,1
    # Search the one-dimensional concave area envelope: Y(X) is the minimum
    # of the two constraint lines. Only individual quadratic vertices and
    # their crossover can be maxima. Unlike production, no geometry tolerance,
    # range reduction, split integer arithmetic or feasibility correction.
    upper=min(W/c,H/s)
    xs=[D(0),upper,W/(2*c),H/(2*s)]
    if c*c!=s*s:xs.append((W*c-H*s)/(c*c-s*s))
    candidates=[]
    for x in xs:
        if not 0<=x<=upper:continue
        y=min((W-c*x)/s,(H-s*x)/c)
        if y>=0:candidates.append((x*y,x,y))
    _,x,y=max(candidates)
    return int(x.to_integral_value(rounding=decimal.ROUND_FLOOR))+1,int(y.to_integral_value(rounding=decimal.ROUND_FLOOR))+1
rng=random.Random(21592026)
angles=[1e-20,-1e-20,1e-14,-1e-14,math.nextafter(90,0),math.nextafter(90,180),math.nextafter(180,0),math.nextafter(-90,0),45,math.nextafter(45,0),math.nextafter(45,90),-45,0,90,-90,180,-180,0.1,13.37,44.999,45.001,89.99]
cases=[]
for w,h in [(1,1),(1,17),(17,1),(2,3),(3,2),(9,9),(2,127),(127,2),(100,1),(101,100),(100,101),(4096,193),(193,4096),(16384,1),(1024,1024)]:
    for a in angles:
        for mode in ['expand','crop']:cases.append([w,h,a,mode])
for _ in range(700):cases.append([rng.randrange(2,500),rng.randrange(2,500),rng.uniform(-179.9,179.9),rng.choice(['expand','crop'])])
js="const C=require(process.argv[1]);let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(s).map(([w,h,a,m])=>{try{return C.plan(w,h,{version:1,angle:a,mode:m}).outputSize}catch(e){return {error:e.message}}}))));"
r=subprocess.run(['node','-e',js,TARGET],input=json.dumps(cases),text=True,capture_output=True,check=True)
actual=json.loads(r.stdout);fail=[];checked=0
for case,got in zip(cases,actual):
    w,h,a,mode=case;wanted=oracle(*case)
    if max(wanted)>16384 or wanted[0]*wanted[1]>64*1024*1024:
        if 'error' not in got: fail.append({'input':case,'expected':'reject edge/pixel limit '+str(wanted),'actual':got})
        continue
    checked+=1
    if got.get('width')!=wanted[0] or got.get('height')!=wanted[1]:fail.append({'input':case,'expected':wanted,'actual':got})
report={'target':TARGET,'checked':checked,'failures':fail}
(Path(__file__).parent/'decimal-results.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'checked':checked,'failureCount':len(fail),'firstFailures':fail[:15]},indent=2))
