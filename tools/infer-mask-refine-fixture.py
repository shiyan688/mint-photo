"""Public local QA only. Executes the already-bundled official MediaPipe model; no network."""
from pathlib import Path
import argparse,base64,hashlib,json
import numpy as np
from PIL import Image,ImageOps
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
p=argparse.ArgumentParser();p.add_argument('--output',required=True,type=Path);a=p.parse_args()
root=Path(__file__).resolve().parents[1];src=root/'quality/sharpness-evidence/fixture-portrait.jpg';model=root/'app/src/main/assets/models/selfie_segmenter.tflite';a.output.mkdir(parents=True,exist_ok=True)
original=ImageOps.exif_transpose(Image.open(src)).convert('RGB');small=ImageOps.contain(original,(256,256),Image.Resampling.BILINEAR)
options=vision.ImageSegmenterOptions(base_options=python.BaseOptions(model_asset_path=str(model)),running_mode=vision.RunningMode.IMAGE,output_confidence_masks=True,output_category_mask=False)
with vision.ImageSegmenter.create_from_options(options) as detector:
 result=detector.segment(mp.Image(image_format=mp.ImageFormat.SRGB,data=np.asarray(small)))
 assert len(result.confidence_masks)==1,'Pinned single-selfie tensor expected'
 values=result.confidence_masks[0].numpy_view().copy();assert np.isfinite(values).all()
 values=np.floor(np.clip(values,0,1)*255+.5).astype(np.uint8)
 height,width=values.shape[:2]
 doc={'source':'NASA S97-00568 public adult portrait, derived informational QA fixture','sourceSha256':hashlib.sha256(src.read_bytes()).hexdigest(),'sourceSize':original.size,'inputSize':small.size,'modelSha256':hashlib.sha256(model.read_bytes()).hexdigest(),'runtime':'Official MediaPipe0.10.21 CPU host; NOT Android inference parity','mask':{'width':width,'height':height,'data':base64.b64encode(values.tobytes()).decode('ascii')}}
 (a.output/'public-host-model-mask.json').write_text(json.dumps(doc,indent=2));Image.fromarray(values.reshape(height,width)).save(a.output/'public-host-model-mask.png');print(json.dumps({k:v for k,v in doc.items() if k!='mask'},ensure_ascii=False))
