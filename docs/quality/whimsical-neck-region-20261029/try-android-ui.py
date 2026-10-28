"""Disposable-emulator-only exploratory UI run; no claim until outputs inspected.

Requires pinned fixtures from prepare-android-fixtures.py. Android SDK adb and
uiautomator must be installed; invokes a real third-party release APK. This
script fails closed and preserves UI captures when expected controls are absent.
"""
import hashlib, json, os, re, subprocess, sys, time, xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image

ROOT=Path.cwd(); FIX=ROOT/'.work/whimsical-skin-study/ci-fixtures'; OUT=ROOT/'.work/whimsical-skin-study/android-ui';OUT.mkdir(parents=True,exist_ok=True)
SERIAL=os.environ.get('ANDROID_SERIAL','')
if SERIAL != 'emulator-5554': raise SystemExit('Only the explicitly disposable emulator-5554 is allowed')
ADB=['adb','-s',SERIAL]; PKG='codes.pepper.whimsicalart'; apk=FIX/'whimsical-v0.1.0.apk'
if hashlib.sha256(apk.read_bytes()).hexdigest()!='a840bbd7fc4063092693d7a36eefa315c1f5b285bad08d1862998089ad38f590': raise SystemExit('APK SHA mismatch')
def adb(*args,check=True): return subprocess.run(ADB+list(args),check=check,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
def sh(*args,check=True): return adb('shell',*map(str,args),check=check).stdout.decode('utf-8','replace')
def snapshot(stage):
 for attempt in range(5):
  adb('shell','rm','-f','/sdcard/window-mint-qa.xml',check=False)
  dump=adb('shell','uiautomator','dump','/sdcard/window-mint-qa.xml',check=False)
  cat=adb('exec-out','cat','/sdcard/window-mint-qa.xml',check=False)
  xml=cat.stdout
  try:
   tree=ET.fromstring(xml)
   if tree.tag!='hierarchy':raise ValueError('Unexpected hierarchy root')
  except (ET.ParseError,ValueError):
   (OUT/(stage+f'-dump-{attempt}.txt')).write_bytes(dump.stdout+b'\n'+dump.stderr+b'\n'+cat.stdout+b'\n'+cat.stderr)
   time.sleep(1);continue
  (OUT/(stage+'.xml')).write_bytes(xml)
  (OUT/(stage+'.png')).write_bytes(adb('exec-out','screencap','-p').stdout)
  return tree
 raise RuntimeError('UI hierarchy was unavailable; diagnostic dumps retained')
def node(root, text=None, desc=None, klass=None):
 for x in root.iter('node'):
  if text is not None and x.get('text')!=text:continue
  if desc is not None and x.get('content-desc')!=desc:continue
  if klass is not None and x.get('class')!=klass:continue
  b=re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]',x.get('bounds',''))
  if b and int(b[3])>int(b[1]) and int(b[4])>int(b[2]):return x,tuple(map(int,b.groups()))
 return None
def tap(item,portion=.5):
 if item is None: raise RuntimeError('Control not found')
 x0,y0,x1,y1=item[1];sh('input','tap',int(x0+(x1-x0)*portion),int((y0+y1)/2))
def wait_for(prefix, predicate, timeout=60):
 end=time.monotonic()+timeout;idx=0
 while time.monotonic()<end:
  tree=snapshot(f'{prefix}-{idx:02d}');idx+=1
  if any('Unable to open the image' in x.get('text','') for x in tree.iter('node')):
   raise RuntimeError('WhimsicalArt displayed an image-open error')
  result=predicate(tree)
  if result is not None:return result
  for text in ('Allow','While using the app','Allow access to all photos','Allow all'):
   permission=node(tree,text=text)
   if permission:tap(permission);break
  time.sleep(.5)
 raise RuntimeError('Timed out at '+prefix)
def sample(stage):
 output=sh('dumpsys','meminfo',PKG,check=False)
 (OUT/(stage+'-meminfo.txt')).write_text(output,encoding='utf-8')
def parse_media_uri(output, filename):
 for line in output.splitlines():
  name=re.search(r'(?:^|,\s*)_display_name=([^,]+)',line)
  match=re.search(r'(?:^|\s|,)_id=(\d+)',line)
  if name and name.group(1).strip()==filename and match:
   return 'content://media/external/images/media/'+match.group(1)
 return None
def uri_for(filename):
 # Query without a SQL WHERE clause: adb shell may strip quotes from its
 # arguments, silently changing a string literal into an invalid SQL name.
 # Keep stdout/stderr and return code as evidence if scanning or query fails.
 for _ in range(45):
  res=adb('shell','content','query','--uri','content://media/external/images/media','--projection','_id:_display_name',check=False)
  out=res.stdout.decode('utf-8','replace');err=res.stderr.decode('utf-8','replace')
  (OUT/(filename+'-media-query-last.txt')).write_text(f'returncode={res.returncode}\nSTDOUT:\n{out}\nSTDERR:\n{err}',encoding='utf-8')
  result=parse_media_uri(out,filename)
  if result:return result
  time.sleep(1)
 raise RuntimeError('MediaStore did not expose source image')
def image_paths(): return set(sh('ls','-1','/sdcard/Pictures/WhimsicalArt',check=False).splitlines())

results={};stage='install'
try:
 adb('wait-for-device');adb('install','-r',str(apk))
 for name in ('sherman','wilson'):
  stage=name+'-input'; source=FIX/(name+'.png'); local=Image.open(source).convert('RGB')
  adb('shell','am','force-stop',PKG);adb('shell','pm','clear',PKG)
  before=image_paths();remote=f'/sdcard/Pictures/mint-qa-{name}.png'
  adb('push',str(source),remote)
  scan=adb('shell','am','broadcast','-a','android.intent.action.MEDIA_SCANNER_SCAN_FILE','-d','file://'+remote,check=False)
  (OUT/(name+'-scan.txt')).write_text(f'returncode={scan.returncode}\n'+scan.stdout.decode('utf-8','replace')+'\n'+scan.stderr.decode('utf-8','replace'),encoding='utf-8')
  if scan.returncode!=0: raise RuntimeError('Media scan request failed')
  uri=uri_for('mint-qa-'+name+'.png')
  # Normal launch through the app's real gallery. Explicitly select the exact
  # accessibility filename; no inferred grid coordinate or assumed URI grant.
  start=time.monotonic();adb('shell','am','start','-n',PKG+'/.MainActivity','-a','android.intent.action.MAIN','-c','android.intent.category.LAUNCHER')
  stage=name+'-onboarding'
  first=wait_for(stage,lambda t:node(t,text='Get Started') or node(t,text='Grant Permission') or node(t,desc='mint-qa-'+name+'.png'),90)
  if first[0].get('text')=='Get Started':tap(first)
  stage=name+'-gallery'
  for i in range(15):
   tree=snapshot(f'{stage}-{i:02d}')
   thumbnail=node(tree,desc='mint-qa-'+name+'.png')
   if thumbnail:tap(thumbnail);break
   permission=next((node(tree,text=x) for x in ('Grant Permission','Allow all','Allow access to all photos','Allow') if node(tree,text=x)),None)
   if permission:tap(permission)
   time.sleep(1)
  else:raise RuntimeError('Exact image thumbnail not found in application gallery')
  stage=name+'-editor';wait_for(stage,lambda t:node(t,desc='Save'),90);sample(name+'-loaded')
  # Beauty is at the end of a horizontal toolbar. Search visible semantics and scroll.
  stage=name+'-beauty'
  for i in range(18):
   tree=snapshot(f'{stage}-{i:02d}');item=node(tree,text='Beauty')
   if item:tap(item);break
   # Swipe only on the visible bottom toolbar, located from a known tool chip.
   chip=next((node(tree,text=x) for x in ('Crop','Transform','Brightness','Contrast','Filters','Denoise') if node(tree,text=x)),None)
   if not chip:raise RuntimeError('No known toolbar chip; refusing blind coordinate input')
   x0,y0,x1,y1=chip[1];width=int(re.search(r'(\d+)x(\d+)',sh('wm','size')).group(1));y=(y0+y1)//2
   sh('input','swipe',int(width*.82),y,int(width*.18),y,400)
  else:raise RuntimeError('Beauty entry not found')
  stage=name+'-smooth';tap(wait_for(stage,lambda t:node(t,text='Smooth'),60))
  seek=wait_for(name+'-slider',lambda t:node(t,klass='android.widget.SeekBar'),60)
  sh('dumpsys','gfxinfo',PKG,'reset',check=False)
  action=time.monotonic();tap(seek,.65)
  time.sleep(8);tree=snapshot(name+'-slider-result');sample(name+'-after-slider')
  # Preserve text for independent confirmation; sliders do not share calibrated units.
  visible=[x.get('text','') for x in tree.iter('node') if x.get('text')]
  (OUT/(name+'-visible.txt')).write_text('\n'.join(visible),encoding='utf-8')
  values=[int(v[:-1]) for v in visible if re.fullmatch(r'\d{1,3}%',v)]
  if 'Skin Smoothing' not in visible or not any(60<=v<=70 for v in values):
   raise RuntimeError('Cannot verify Skin Smoothing slider near 65%; see screenshot/XML')
  (OUT/(name+'-gfxinfo.txt')).write_text(sh('dumpsys','gfxinfo',PKG,'framestats',check=False),encoding='utf-8')
  stage=name+'-save';tap(node(tree,desc='Save'))
  tree=wait_for(name+'-dialog',lambda t: t if node(t,text='Save Photo') else None,30)
  tap(node(tree,text='PNG')); tree=snapshot(name+'-dialog-png');tap(node(tree,text='Save'))
  end=time.monotonic()+90;new=set()
  while time.monotonic()<end:
   new={p for p in image_paths()-before if p.lower().endswith('.png')}
   if len(new)==1:break
   time.sleep(1)
  if len(new)!=1:raise RuntimeError('Could not uniquely identify saved PNG')
  target=next(iter(new));data=adb('exec-out','cat','/sdcard/Pictures/WhimsicalArt/'+target).stdout
  saved=OUT/(name+'-saved.png');saved.write_bytes(data)
  output=Image.open(saved).convert('RGB')
  if output.size!=local.size:raise RuntimeError('Saved dimensions differ')
  changed=sum(a!=b for a,b in zip(output.tobytes(),local.tobytes()))
  if changed==0:raise RuntimeError('Saved RGB unchanged; cannot claim applied effect')
  sample(name+'-saved');results[name]={'outputSha256':hashlib.sha256(data).hexdigest(),'dimensions':list(output.size),'rgbChangedBytes':changed,'visiblePercentCandidates':values,'elapsedOpenToOutputSeconds':time.monotonic()-start,'elapsedSliderToOutputSeconds':time.monotonic()-action,'elapsedScope':'wall time includes UI automation, screenshots, 8-second wait and export; not isolated inference latency','savedFile':str(saved)}
 (OUT/'result.json').write_text(json.dumps({'result':'PASS_NEEDS_VISUAL_REVIEW','cases':results},indent=2),encoding='utf-8')
except Exception as e:
 try:snapshot('failure-'+stage)
 except Exception:pass
 try:(OUT/('failure-'+stage+'-logcat.txt')).write_bytes(adb('logcat','-d','-v','threadtime','-t','3000',check=False).stdout)
 except Exception:pass
 (OUT/'result.json').write_text(json.dumps({'result':'FAIL','stage':stage,'error':str(e),'completed':results},indent=2),encoding='utf-8')
 raise
