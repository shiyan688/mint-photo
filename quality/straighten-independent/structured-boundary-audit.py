"""Construct rational-triangle angles near integer crop spans; binary64 limitation evidence."""
import json,math,subprocess
from pathlib import Path
exec((Path(__file__).parent/'decimal-geometry-audit.py').read_text().split('rng=random.Random')[0])
# TARGET is resolved by the shared oracle prelude.
cases=[]
for a,b,hyp in [(3,4,5),(5,12,13),(8,15,17),(7,24,25),(20,21,29),(12,35,37),(9,40,41)]:
    ang=math.degrees(math.atan2(a,b))
    for sign in [1,-1]:
        for scale in range(1,50):
            size=(a+b)*scale+1
            for angle in [ang*sign,math.nextafter(ang*sign,0),math.nextafter(ang*sign,180)]:cases.append([size,size,angle,'crop'])
js="const C=require(process.argv[1]);let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(s).map(([w,h,a,m])=>C.plan(w,h,{version:1,angle:a,mode:m}).outputSize))));"
got=json.loads(subprocess.run(['node','-e',js,TARGET],input=json.dumps(cases),text=True,capture_output=True,check=True).stdout)
allrows=[];fail=[]
for case,out in zip(cases,got):
    w=oracle(*case);row=dict(input=case,highPrecisionExpected=list(w),binary64Actual=out);allrows.append(row)
    if [out['width'],out['height']]!=list(w):fail.append(row)
report={'checked':len(cases),'quantizationDifferences':len(fail),'policy':'Documented binary64/libm tolerance contract, not strict real-number floor; differences are recorded, not hidden.','cases':allrows,'differences':fail}
(Path(__file__).parent/'structured-boundary-results.json').write_text(json.dumps(report,indent=2))
print(json.dumps({k:v for k,v in report.items() if k not in ['cases','differences']},indent=2))
