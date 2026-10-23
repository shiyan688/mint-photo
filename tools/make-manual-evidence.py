#!/usr/bin/env python3
"""Render reviewed classical-core outputs only. Public QA fixture is a separate input."""
from pathlib import Path
import argparse,gzip,json
from PIL import Image,ImageDraw,ImageFont
p=argparse.ArgumentParser();p.add_argument('--qa-dir',required=True,type=Path);p.add_argument('--dot-dir',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args();q=a.qa_dir
meta=json.loads((q/'fixtures/05_mukai.json').read_text());w,h=meta['width'],meta['height'];font='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc';bold='/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
F=lambda s,b=False:ImageFont.truetype(bold if b else font,s)
def rgba(p):
 raw=p.read_bytes();raw=gzip.decompress(raw) if p.suffix=='.gz' else raw
 return Image.frombytes('RGBA',(w,h),raw).convert('RGB')
truth=rgba(q/'fixtures/05_mukai.rgba.gz');sheet=Image.new('RGB',(1080,1420),'#f3f5f3');d=ImageDraw.Draw(sheet)
d.text((36,25),'手动精修 · 实际像素对比',font=F(34,True),fill='#14392e')
d.text((36,78),'真实纹理补片与仿制图章，不是简单模糊',font=F(23),fill='#486459')
pt=meta['landmarks'][205];cx,cy=pt['x']*(w-1),pt['y']*(h-1)
rows=[('1  合成小黑点测试',['未添加测试点','叠加黑点（合成）','纹理修复'],[truth,rgba(a.dot_dir/'205-dirty.rgba'),rgba(a.dot_dir/'205-healed.rgba')],(cx,cy)),('2  柔和红色覆盖测试',['未添加覆盖色','红色覆盖（合成）','纹理修复'],[truth,rgba(q/'soft-red-patch-dirty.rgba.gz'),rgba(q/'soft-red-patch-healed.rgba.gz')],(cx,cy)),('3  原图中的测试选点',['原始自然色差点','手动取样 · 修复','同一供体 · 仿制'],[truth,rgba(q/'natural-selected-heal.rgba.gz'),rgba(q/'natural-selected-clone.rgba.gz')],(289,537))]
for i,(title,labels,images,center) in enumerate(rows):
 y=132+i*382;d.text((36,y),title,font=F(25,True),fill='#14392e');x0,y0=int(round(center[0]-40)),int(round(center[1]-40))
 for j,(label,im) in enumerate(zip(labels,images)):
  x=36+j*340;d.text((x,y+42),label,font=F(20),fill='#304e42');patch=im.crop((x0,y0,x0+80,y0+80)).resize((288,288),Image.Resampling.NEAREST);sheet.paste(patch,(x,y+77))
d.text((36,1292),'局部放大用于观察；三组均未改动笔刷外像素。',font=F(22),fill='#304e42')
d.text((36,1326),'不诊断肤况；不代表所有真实痘痘、原尺寸导出或手机手感已验证。',font=F(20),fill='#53645b')
d.text((36,1362),'公开 NASA 肖像，仅供本次测试核对。非人物背书，不作宣传或训练。',font=F(19),fill='#53645b')
a.output.parent.mkdir(parents=True,exist_ok=True);sheet.save(a.output,quality=93,subsampling=0);print(a.output)
