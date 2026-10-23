"""Read-only verification of current unsigned APK assets and offline CSP."""
from pathlib import Path
import base64,hashlib,json,re,zipfile,xml.etree.ElementTree as ET
root=Path(__file__).resolve().parents[2];assets=root/'app/src/main/assets'
sha=lambda x:hashlib.sha256(x).hexdigest()
artifacts=[]
for abi in ('arm64-v8a','armeabi-v7a'):
 p=root/f'app/build/outputs/apk/release/app-{abi}-release-unsigned.apk'
 with zipfile.ZipFile(p) as z:
  names=z.namelist();assert not any(re.match(r'META-INF/.*\.(RSA|DSA|EC)$',n) for n in names)
  local={str(p.relative_to(assets)):p for p in assets.rglob('*') if p.is_file()}
  assert set(n[7:] for n in names if n.startswith('assets/') and not n.endswith('/'))==set(local)
  for name,p0 in local.items(): assert z.read('assets/'+name)==p0.read_bytes(),name
 artifacts.append({'abi':abi,'bytes':p.stat().st_size,'sha256':sha(p.read_bytes()),'assetFilesCompared':len(local)})
lint=ET.parse(root/'app/build/reports/lint-results-release.xml').getroot();errors=sum(i.attrib.get('severity')=='Error' for i in lint);warnings=sum(i.attrib.get('severity')=='Warning' for i in lint)
assert errors==0
manifests=list((root/'app/build/intermediates/merged_manifests/release').rglob('AndroidManifest.xml'));assert len(manifests)==2
permissions=[]
for item in manifests:
 manifest=ET.parse(item).getroot();permissions += [i.attrib for i in manifest if i.tag.startswith('uses-permission')]
assert not permissions
preview=root/'preview/薄荷修图-离线预览.html';html=preview.read_text();scripts=re.findall(r'<script>(.*?)</script>',html,re.S);assert len(scripts)==59;assert not re.search(r'<script[^>]+src=',html)
for script in scripts: assert "'sha256-"+base64.b64encode(hashlib.sha256(script.encode()).digest()).decode()+"'" in html
out={'artifacts':artifacts,'lintErrors':errors,'lintWarnings':warnings,'permissions':permissions,'signature':'absent; not installable; apksigner negative result also checked separately','preview':{'inlineScripts':len(scripts),'cspHashesVerified':True,'renderedBrowser':False,'bytes':preview.stat().st_size,'sha256':sha(preview.read_bytes())},'sourceModules':{p.name:sha(p.read_bytes()) for p in [assets/'project-library.js',assets/'project-library-controller.js',assets/'project-library-ui.js',assets/'editor.js']},'testBoundary':'NativeCanvas PNG execution is real; all IndexedDB and DOM tests are controlled/fault-injected, no browser persistence or Android cold-start pass.'}
(root/'quality/project-library-evidence/build-byte-validation.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps(out,ensure_ascii=False,indent=2))
