"""Fetch pinned NASA informational QA photos into a local, untracked input directory."""
import argparse,hashlib,json,urllib.request
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,default=Path('.work/public-photo-qa/inputs'));args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True);root=Path(__file__).resolve().parents[1]
for source in json.loads((root/'docs/quality/photo-batch-20261024/sources.json').read_text(encoding='utf-8')):
 suffix='.png' if source['id']=='collins' else '.jpg';dest=args.output/(source['id']+suffix)
 data=(root/'app/src/main/assets/demo/astronaut.png').read_bytes() if source['id']=='collins' else urllib.request.urlopen(source['url'],timeout=60).read(20000001)
 if len(data)>20000000 or hashlib.sha256(data).hexdigest()!=source['sha256']:raise ValueError('Pinned source changed: '+source['id'])
 dest.write_bytes(data);print(source['id'],len(data),'bytes, SHA256 verified')
