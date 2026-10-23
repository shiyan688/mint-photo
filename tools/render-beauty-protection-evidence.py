#!/usr/bin/env python3
"""Lay out existing, verified native-Canvas exports. No retouch or new inference."""
from pathlib import Path
import hashlib
import json

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "quality/beauty-protection-evidence"
REPORT = json.loads((OUT / "public-pixel-report.json").read_text())
FONT_DIR = Path("/usr/share/fonts/opentype/noto")
BG, INK, MUTED, MINT, LINE = "#f3f7f5", "#16312b", "#536a61", "#dceee5", "#d4dfda"


def font(size, bold=False):
    # TTC index 2 is Simplified Chinese in this installed Noto collection.
    suffix = "Bold" if bold else "Regular"
    return ImageFont.truetype(str(FONT_DIR / f"NotoSansCJK-{suffix}.ttc"), size, index=2)


def text(draw, xy, value, size=26, bold=False, fill=INK, max_width=None):
    f = font(size, bold)
    if max_width is not None:
        assert draw.textbbox((0, 0), value, font=f)[2] <= max_width, value
    draw.text(xy, value, font=f, fill=fill)


def canvas(height):
    im = Image.new("RGB", (1680, height), BG)
    return im, ImageDraw.Draw(im)


images = []
for name in ("source", "candidate", "protected"):
    image = Image.open(OUT / f"public-{name}.png").convert("RGBA")
    assert image.size == (900, 500), (name, image.size)
    assert hashlib.sha256(image.tobytes()).hexdigest() == REPORT[f"{name}Rgba"], name
    images.append(image)

source, candidate, protected = [np.asarray(im).astype(np.int16) for im in images]
delta = np.abs(protected[:, :, :3] - candidate[:, :, :3])
changed = np.any(delta, axis=2)
assert int(changed.sum()) == REPORT["attenuatedPixels"]
assert np.array_equal(source[:, 450:], candidate[:, 450:])
assert np.array_equal(source[:, 450:], protected[:, 450:])
assert REPORT["inactiveChangedPixels"] == 0
assert REPORT["originalFileUnchanged"] and REPORT["actualOriginalPngMatchesCore"]
assert REPORT["controls"]["smooth"] == 18 and REPORT["controls"]["brighten"] == 35
strokes = REPORT["operation"]["protection"]["faces"]
assert len(strokes) == 1 and len(strokes[0]["strokes"]) == 1
assert strokes[0]["faceId"] == "face-1"
assert strokes[0]["strokes"][0]["mode"] == "erase"

labels = ("01  原图", "02  当前美颜完整效果", "03  局部保护结果")
subtitles = ("保留导入内容", "只调整左侧人物", "在左侧脸颊擦回本轮美颜")
xs = (40, 590, 1140)


def header(draw, title, subtitle):
    text(draw, (40, 28), title, 44, True)
    text(draw, (40, 94), subtitle, 24, fill=MUTED, max_width=1600)
    text(draw, (40, 132), "合成测试拼图 · SYNTHETIC COMPOSITE · 非真实合影", 23, True, fill=MUTED)


def columns(draw, y, detail=False):
    for x, title, subtitle in zip(xs, labels, subtitles):
        text(draw, (x, y), title, 29, True, max_width=500)
        if not detail:
            text(draw, (x, y + 43), subtitle, 24, fill=MUTED, max_width=500)


def paste_resized(sheet, image, box, target):
    # Only a common crop and geometric resize, never a color or contrast operation.
    image = image.crop(box) if box else image
    sheet.paste(image.resize(target[2:], Image.Resampling.LANCZOS).convert("RGB"), target[:2])


sheet, d = canvas(1060)
header(d, "逐人美颜 · 手工保护局部", "原图 → 本轮美颜 → 擦回选区；保护只减弱本轮美颜，不覆盖原文件。")
columns(d, 196)
for x, image in zip(xs, images):
    paste_resized(sheet, image, None, (x, 282, 500, 278))

d.rounded_rectangle((40, 594, 1640, 884), 18, fill=MINT)
# An explicitly separate locator, never an overlay on the comparison/export pixels.
locator_box, locator_xy, locator_size = (20, 58, 440, 478), (64, 618), 240
paste_resized(sheet, images[0], locator_box, (*locator_xy, locator_size, locator_size))
scale = locator_size / (locator_box[2] - locator_box[0])


def locate(x, y):
    return (locator_xy[0] + (x - locator_box[0]) * scale,
            locator_xy[1] + (y - locator_box[1]) * scale)


stroke = strokes[0]["strokes"][0]
point = stroke["points"][0]
cx, cy = locate(point["x"] * 900, point["y"] * 500)
radius = stroke["radius"] * 500 * scale
d.rectangle((*locate(100, 267), *locate(190, 327)), outline="#08795d", width=3)
d.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), outline="#ffffff", width=5)
d.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), outline="#b83f19", width=2)
d.ellipse((cx - 3, cy - 3, cx + 3, cy + 3), fill="#b83f19")
text(d, (344, 611), "定位示意 · 已选人物 1（左侧）", 30, True, max_width=1250)
text(d, (344, 664), "圆点／圆圈：实际落笔与笔刷范围；绿框：A 行放大区。", 25, fill=MUTED, max_width=1250)
text(d, (344, 707), "仅此小图叠加定位标记；上方三幅与局部对照不叠加标记。", 25, fill=MUTED, max_width=1250)
text(d, (344, 755), "选区减弱本轮美颜，右侧人物逐像素未变。", 29, True, max_width=1250)
text(d, (344, 808), "变化较轻，需看局部；不代表整体美颜质量通过验收。", 25, fill=MUTED, max_width=1250)
text(d, (40, 908), "磨皮 18 / 提亮 35：为展示保护范围设置，不是推荐审美参数。", 24, fill=MUTED)
text(d, (40, 952), "NASA 公开成人肖像：Jonny Kim、Kalpana Chawla。仅本地信息性 QA，非训练、应用素材或背书。", 22, fill=MUTED, max_width=1600)
text(d, (40, 992), "现有编辑器 + 本机 Canvas 像素导出；不是 Android / WebView 实机截图，也不是新的手机推理。", 22, fill=MUTED, max_width=1600)
sheet.save(OUT / "public-comparison-overview.zh-CN.png")

sheet, d = canvas(1720)
header(d, "局部对照 · 保留哪些细节", "三个固定局部使用同一组真实导出；等比例放大，没有额外调色或差异增强。")
columns(d, 191, detail=True)
regions = [
    ("A  脸颊手工保护区", "这一笔减弱当前美颜，不是自动去瑕疵。", (100, 267, 190, 327), 250),
    ("B  点状纹理观察", "与上行同一笔；不识别或判断痣／雀斑，也没有另做去斑。", (125, 250, 185, 290), 692),
    ("C  眼睑边缘观察", "这里没有另画保护笔；用于查看边缘，不能当作眼睑保护演示。", (130, 195, 220, 255), 1134),
]
for title, subtitle, crop, y in regions:
    text(d, (40, y), title, 29, True)
    text(d, (40, y + 45), subtitle, 24, fill=MUTED, max_width=1600)
    for x, image in zip(xs, images):
        paste_resized(sheet, image, crop, (x, y + 93, 500, 333))

text(d, (40, 1602), "目视：脸颊变化细微；未见明显新增硬边或光晕。放大后的像素感来自源图分辨率。", 24, fill=MUTED, max_width=1600)
text(d, (40, 1646), "公开 NASA 成人肖像合成测试拼图；仅本地 QA。真实导出，不等于 Android / WebView 实机验证。", 22, fill=MUTED, max_width=1600)
sheet.save(OUT / "public-comparison-closeups.zh-CN.png")

hashes = "\n".join(
    f"- public-{name}.png RGBA SHA-256：`{REPORT[name + 'Rgba']}`"
    for name in ("source", "candidate", "protected")
)
ys, dxs = np.where(changed)
readme = f"""# 逐人美颜保护：中文像素证据

## 先看两张图

- `public-comparison-overview.zh-CN.png`：原图、左侧人物的完整当前美颜、脸颊局部保护结果。另设源图定位小图，标出所选人物 1、实际笔刷中心／名义半径及 A 行放大范围。标记仅在该定位小图上，不进入三幅对照或原始 PNG；圆圈不是最终羽化蒙版边缘。
- `public-comparison-closeups.zh-CN.png`：同一组三幅导出的脸颊、点状纹理、眼睑边缘固定局部。没有额外调色、锐化、差异增强或生成填补，仅裁切与相同插值缩放。

本次只有左侧人物脸颊上的一笔手工保护，不是三处独立修图。点状纹理行不识别或诊断痣／雀斑，眼睑行也没有另画保护笔。它们是观察对照，不是自动祛斑、自动识别瑕疵或眼睑保护功能的证据。

## 读图结论与边界

- 原图文件保留；保护只衰减**本轮美颜**，不是把所有既有编辑擦回最初照片。本例没有前序编辑，所以笔刷完全保护端点与本例源图一致。
- 左侧人物使用磨皮 18、提亮 35，其余美颜与形变参数为零；仅为展示保护机制，不是推荐审美参数。
- 右侧未启用人物在候选和保护结果中均与源图逐像素一致。本脚本还独立比较了整个右半幅。
- 目视可见整体变化轻微，正常总览尺寸很难分辨；放大后脸颊局部有细小亮度回退。未见明显新增的硬边或光晕，但不能据此断言所有输入都无伪影。放大显示不会创造原图没有的细节。
- 本证据仅演示保护机制和像素边界，不是整体美颜质量通过验收的结论。
- 这是现有生产 JS 编辑器配合本机 Canvas 的真实像素导出，注入 DOM 和之前真实 CPU MediaPipe 478 点结果；不是 Android / WebView 实机运行，也没有新的手机实时推理。

## 本组三幅导出的校验

直接依据 `public-pixel-report.json`，并由排版脚本重新校验输入 RGBA 哈希：

- 完全保护且本来有美颜差异的端点像素：{REPORT['protectedEndpointPixels']}。
- 保护结果相对完整候选变化的像素：{REPORT['attenuatedPixels']}；最大 RGB 单通道差值 {int(delta.max())}/255。变化包围框为 x={int(dxs.min())}…{int(dxs.max())}、y={int(ys.min())}…{int(ys.max())}。
- 未启用人物区域变化像素：{REPORT['inactiveChangedPixels']}。
- Alpha 变化像素：{REPORT['alphaChangedPixels']}。本组三幅图是不透明源图，不能代替透明源图专项测试。
- 原文件未变、实际原尺寸 PNG 与核心重放相符：报告均为 true。

局部坐标以 900×500 导出为基准，右／下边界不含：A=(100,267,190,327)，B=(125,250,185,290)，C=(130,195,220,255)。三个状态使用同一坐标和同一缩放。

## 素材与用途

输入是现有两张 NASA 公开成人肖像 Jonny Kim 与 Kalpana Chawla 的 **SYNTHETIC COMPOSITE（合成测试拼图）**，不是真实合影。保留源图中的英文来源和合成标识，版面也重复中文标识。人物姓名和成年背景来自既有来源记录，不是从图像识别或估龄。

仅用于私人、本地、信息性 QA；不是应用资产、训练数据、广告或任何人物／NASA 背书。商业发布、营销或素材再分发没有在此被清权。原始资料记录见 `../public-fixture-provenance.json`；NASA 使用说明见 https://www.nasa.gov/nasa-brand-center/images-and-media/ 。

## 复现

先由 `tests/native-canvas/beauty-protection-pixels.test.cjs` 生成原图、候选、保护图及报告，再在项目根目录运行：

`python tools/render-beauty-protection-evidence.py`

脚本只读三幅输入 PNG 和报告，写本目录两个 comparison PNG 及本说明；使用已安装 Pillow、NumPy 和 Noto Sans CJK 字体，没有下载包、模型或图片。输入哈希不匹配会停止，避免把新旧结果混排。

{hashes}
"""
(OUT / "README.zh-CN.md").write_text(readme, encoding="utf-8")
print(json.dumps({"generated": ["public-comparison-overview.zh-CN.png", "public-comparison-closeups.zh-CN.png", "README.zh-CN.md"], "inputHashesVerified": True, "changedPixels": int(changed.sum()), "maxChannelDelta": int(delta.max()), "rightHalfExact": True}, ensure_ascii=False))
