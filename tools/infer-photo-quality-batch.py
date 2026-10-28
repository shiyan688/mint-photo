"""Fresh local MediaPipe inference on pinned public QA inputs. Never uploads photos."""
from pathlib import Path
import argparse,hashlib,json,base64,time
import numpy as np
from PIL import Image,ImageOps
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
p=argparse.ArgumentParser();p.add_argument('--inputs',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--pattern',default='*');p.add_argument('--max-edge',type=int,default=900);args=p.parse_args()
if not 1<=args.max_edge<=4096:p.error('--max-edge must be between 1 and 4096')
args.output.mkdir(parents=True,exist_ok=True)
root=Path(__file__).resolve().parents[1];face=root/'app/src/main/assets/models/face_landmarker.task';person=root/'app/src/main/assets/models/selfie_segmenter.tflite';digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
face_options=vision.FaceLandmarkerOptions(base_options=python.BaseOptions(model_asset_path=str(face)),running_mode=vision.RunningMode.IMAGE,num_faces=5)
mask_options=vision.ImageSegmenterOptions(base_options=python.BaseOptions(model_asset_path=str(person)),running_mode=vision.RunningMode.IMAGE,output_confidence_masks=True,output_category_mask=False)
reports=[]
with vision.FaceLandmarker.create_from_options(face_options) as fd,vision.ImageSegmenter.create_from_options(mask_options) as sd:
 for file in sorted(args.inputs.glob(args.pattern)):
  if file.suffix.lower() not in ['.png','.jpg','.jpeg']:continue
  original=ImageOps.exif_transpose(Image.open(file)).convert('RGB');work=ImageOps.contain(original,(args.max_edge,args.max_edge),Image.Resampling.LANCZOS);work.save(args.output/(file.stem+'.png'));start=time.perf_counter();f=fd.detect(mp.Image(image_format=mp.ImageFormat.SRGB,data=np.asarray(work)));small=ImageOps.contain(work,(256,256),Image.Resampling.BILINEAR);seg=sd.segment(mp.Image(image_format=mp.ImageFormat.SRGB,data=np.asarray(small)));values=np.clip(seg.confidence_masks[0].numpy_view().copy(),0,1);assert np.isfinite(values).all();values=np.floor(values*255+.5).astype(np.uint8);h,w=values.shape
  doc={'id':file.stem,'sourceSha256':digest(file),'sourceSize':original.size,'width':work.width,'height':work.height,'faces':[[{'x':v.x,'y':v.y,'z':v.z} for v in f]for f in f.face_landmarks],'mask':{'width':w,'height':h,'data':base64.b64encode(values.tobytes()).decode('ascii')},'runtime':'MediaPipe '+mp.__version__+' Windows CPU; not Android parity','newInference':True,'elapsedMs':(time.perf_counter()-start)*1000,'faceModelSha256':digest(face),'segmentationModelSha256':digest(person)}
  (args.output/(file.stem+'.json')).write_text(json.dumps(doc),encoding='utf-8');reports.append({k:v for k,v in doc.items() if k not in ['faces','mask']}|{'faceCount':len(doc['faces']),'maskSize':[w,h]});print(file.stem,len(doc['faces']),'faces',flush=True)
(args.output/'inference-summary.json').write_text(json.dumps(reports,indent=2),encoding='utf-8')
