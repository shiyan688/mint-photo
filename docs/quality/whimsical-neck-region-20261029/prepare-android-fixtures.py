"""Pinned, research-only APK and photos. Does not install anything."""
from pathlib import Path
from urllib.request import Request, urlopen
from PIL import Image, ImageOps
import hashlib, io

ROOT=Path.cwd(); OUT=ROOT/'.work/whimsical-skin-study/ci-fixtures'; OUT.mkdir(parents=True,exist_ok=True)
def digest(data): return hashlib.sha256(data).hexdigest()
def fetch(url, expected, cap, name):
 path=OUT/name
 if path.is_file() and digest(path.read_bytes())==expected: return path
 with urlopen(Request(url,headers={'User-Agent':'MintPhotoQA/1.0 informational research'}),timeout=120) as r: data=r.read(cap+1)
 if len(data)>cap or digest(data)!=expected: raise ValueError('bad length or SHA for '+name)
 path.write_bytes(data);return path
fetch('https://github.com/whimsicalart/whimsicalart/releases/download/v0.1.0/app-release.apk',
 'a840bbd7fc4063092693d7a36eefa315c1f5b285bad08d1862998089ad38f590',130000000,'whimsical-v0.1.0.apk')
fixtures=[
 ('sherman','https://upload.wikimedia.org/wikipedia/commons/0/01/Portrait-of-a-woman.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original','69f714d739d92c4db6ee7a4d7a019f2c12eaf6809814f2f036f60e830087ca57',900000,'4d41f0f7a496b985eb74f58c5837ad7d21f9627a943a87e72b958d9fa1e3b9cb'),
 ('wilson','https://images-assets.nasa.gov/image/NHQ201907110001/NHQ201907110001~medium.jpg','e6bf36675ac168de1a34754e095b5153bf349b4776d6ca34f8e092a89a3b7c1e',150000,'d5d80e39e2182c6a77f189e03ec617ee94ac66d2036e7b78efc2bf9dcaf8869b'),
]
for name,url,source_sha,cap,pixel_sha in fixtures:
 p=fetch(url,source_sha,cap,name+'.jpg')
 image=ImageOps.contain(ImageOps.exif_transpose(Image.open(p)).convert('RGB'),(900,900),Image.Resampling.LANCZOS)
 if digest(image.tobytes()) != pixel_sha: raise ValueError(name+': scaled RGB bytes differ from existing baseline')
 image.save(OUT/(name+'.png'));print(name,image.size,pixel_sha)
print('APK and two research inputs verified; no device installed.')
