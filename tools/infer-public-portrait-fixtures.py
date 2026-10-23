from pathlib import Path
import hashlib,json
import numpy as np
from PIL import Image,ImageOps
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import argparse
p=argparse.ArgumentParser(description='Local public-photo QA only; no upload or download')
p.add_argument('--images',required=True,type=Path)
p.add_argument('--output',required=True,type=Path)
a=p.parse_args()
ROOT=Path(__file__).resolve().parents[1]
MODEL=ROOT/'app/src/main/assets/models/face_landmarker.task'
OUT=a.output;OUT.mkdir(parents=True,exist_ok=True)
opts=vision.FaceLandmarkerOptions(base_options=python.BaseOptions(model_asset_path=str(MODEL)),running_mode=vision.RunningMode.IMAGE,num_faces=1,output_face_blendshapes=False,output_facial_transformation_matrixes=False)
summary=[]
with vision.FaceLandmarker.create_from_options(opts) as detector:
 for src in sorted(a.images.glob('*.jpg')):
  original=ImageOps.exif_transpose(Image.open(src)).convert('RGB');test=ImageOps.contain(original,(1280,1280))
  result=detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB,data=np.asarray(test)))
  if not result.face_landmarks:summary.append({'name':src.stem,'ok':False,'stage':'full-frame'});continue
  pts=result.face_landmarks[0];xs=[p.x for p in pts];ys=[p.y for p in pts];w,h=original.size
  l,t,r,b=min(xs),min(ys),max(xs),max(ys);fw,fh=r-l,b-t
  box=[max(0,int((l-fw*.45)*w)),max(0,int((t-fh*.4)*h)),min(w,int((r+fw*.45)*w)),min(h,int((b+fh*.4)*h))]
  crop=ImageOps.contain(original.crop(box),(900,1000));result=detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB,data=np.asarray(crop)))
  if not result.face_landmarks:summary.append({'name':src.stem,'ok':False,'stage':'crop'});continue
  pts=[{'x':p.x,'y':p.y,'z':p.z} for p in result.face_landmarks[0]]
  crop.save(OUT/(src.stem+'.png'));rgba=crop.convert('RGBA');(OUT/(src.stem+'.rgba')).write_bytes(rgba.tobytes())
  meta={'name':src.stem,'width':crop.width,'height':crop.height,'landmarks':pts,'sourceFile':src.name,'sourceSha256':hashlib.sha256(src.read_bytes()).hexdigest(),'sourceSize':original.size,'sourceCrop':box,'modelSha256':hashlib.sha256(MODEL.read_bytes()).hexdigest(),'detector':'Google MediaPipe0.10.21 CPU host, not Android runtime'}
  (OUT/(src.stem+'.json')).write_text(json.dumps(meta));summary.append({'name':src.stem,'ok':True,'landmarks':len(pts),'width':crop.width,'height':crop.height})
  print(summary[-1],flush=True)
(OUT/'inference-summary.json').write_text(json.dumps(summary,indent=2))
