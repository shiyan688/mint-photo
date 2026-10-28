# 真实 7.2MP 照片：主机性能与像素证据

本目录保留 2026-10-28 最终冻结实现的主机验证。原图是 NASA 发布的 Leland Melvin 照片，2400×3000、7,200,000 像素，未放大。**本轮优化前后成片逐字节一致，效果没有改善。** 这里不是 Android 实机性能、真实 AI 模型效果或供应商兼容性报告。

## 结果与材料

| 检查 | 优化前中位数 | 优化后中位数 | 测量范围 |
| --- | ---: | ---: | --- |
| detail-v2 修肤 | 273.32 ms | 118.41 ms | 原生 2400×3000，5 次交替测量 |
| guided 边缘贴合 | 68.49 ms | 62.28 ms | 原生 2400×3000，5 次交替测量 |
| AI 消除结果合成 | 194.26 ms | 59.46 ms | 2048×2560 工作图，3 次有效样本 |
| AI 扩图结果合成 | 227.31 ms | 93.35 ms | 2458×3072 输出，3 次有效样本 |
| 独立画布复制／PNG 往返微基准 | 1020.63 ms | 3.43 ms | 去除一次 PNG 编解码；不是整个 AI 弹窗的打开时间 |

运行环境为 Windows x64、Node v25.7.0、`@napi-rs/canvas` 0.1.100。计时不含照片下载、模型检测、网络、DOM、图片输出和哈希检查。修肤／抠图在 900、2560、3000 三档长边均保留原始样本；900 档 guided 的 33.64→33.83 ms 基本持平，不能宣称所有尺寸都有收益。

- [修肤与抠图完整性能数据](portrait-performance.json)：最终无坐标缓存表版本；原输入路径已改为通用生成路径，计时及哈希未改。
- [AI 性能数据](ai-performance.json)：合成使用固定颜色的模拟返回图，只检验本地合成与复制。前后 RGBA 一致，源图未修改。
- [来源与原始 JPEG 摘要](source.json)、[新推理元数据](inference/melvin-original.json)、[推理摘要](inference/inference-summary.json)：本轮以完整 2400×3000 图运行人脸检测，检出 1 人；分割仍遵循既有 205×256 输入。Windows CPU MediaPipe 0.10.21，不代表 Android 模型运行。性能脚本随后复用该次推理，因此性能 JSON 中的 `newInference: false` 表示计时阶段未再检测。
- [图像检查与完整成片摘要](visual-report.json)：修肤 RGBA、guided Float32 蒙版及最终抠图 RGBA 均前后完全相同；保留原图与成片哈希，没有打包全部全尺寸图片。
- [100% 脸部对照](face-100pct-comparison.png)、[100% 头发对照](hair-100pct-comparison.png)：每一列一个原图像素对应一个 PNG 像素。浏览器可能缩小显示；各单列 PNG 也保存在本目录，可按 100% 查看。
- [文件与源码摘要清单](manifest.json)。不包含已放弃的缓存表方案或放大照片压力基准。

## 基线与当前冻结源码

基线可从提交 `ac552bde84029176fe7ad726d0113ffa0ae807fd` 提取。当前优化实现以以下文件 SHA-256 为准，**该基线提交不是当前优化源码提交**。

| 模块 | 基线 SHA-256 | 当前 SHA-256 |
| --- | --- | --- |
| `portrait-detail-engine.js` | `1559fa74818ece4d99c78b565720072a8284f1eda865949ac62191cf00ceb620` | `4d392822405f2466d067e32d5c915c0c325cae0c204a7d4cd2e96be7ec0305df` |
| `edge-refine.js` | `ba467e0f7391dec1cb1b1f88086e15cba5da201a61b01ae5cfac2b9865a417fa` | `490bf77545b3cc1beba5f1bb20f4347251ed798ad177ff128b62c035e3a28959` |
| `ai-edit-core.js` | `5ba1e2a9c307422dacdfc600124c4ceca605c0bd8e76cd4dabe177e9b4bc0011` | `8f8f0d90a1805a95f9b7aeb6ef7b060712bc030f489fe272cd66fda75f08da80` |

旧 `portrait-engine.js` 未修改，SHA-256 为 `5cde7dcd60aab1d68e1ec5fb026c6396c2f395c1597dd03113c34674ba57d524`。最终 guided 仅复用 A/B 插值坐标，没有额外坐标表，也未改变插值运算次序和算法版本。

`manifest.json` 的 `toolsSha256` 对工具源码先将 CRLF 换行规范化为 LF，再计算 UTF-8 字节的 SHA-256，与提交 `a14ab5b7f896070ed757507371e4e65d610550a4` 中的 Git 源文件一致，避免不同检出环境造成换行差异。该规则只用于工具哈希；算法核心的哈希和本目录 `files` 清单仍按原始文件字节计算，原始证据中的 CRLF 不转换，实际算法核心字节也未改变。

## 复现

从仓库根目录运行；以下使用 POSIX shell（Windows 可用 Git Bash）。准备 Node v25.7.0、可解析的 `@napi-rs/canvas@0.1.100`，以及 `tools/portrait-qa-requirements.txt` 中的 Python 依赖。先确认当前三个模块哈希与上表一致；时间会随硬件和系统负载变化。

```sh
mkdir -p qa-run/large-photo/inputs qa-run/large-photo/inference qa-run/large-photo/baseline
curl --fail --location 'https://images-assets.nasa.gov/image/jsc2007e036047/jsc2007e036047~orig.jpg' -o qa-run/large-photo/inputs/melvin-original.jpg
node -e "const fs=require('fs'),c=require('crypto');if(c.createHash('sha256').update(fs.readFileSync('qa-run/large-photo/inputs/melvin-original.jpg')).digest('hex')!=='34471604e6f19bdbc31e8a556caa9d20bab29c417a7817a1c352740458dcf0eb')throw Error('Original SHA mismatch');"
node -e "const fs=require('fs'),cp=require('child_process');for(const n of ['portrait-detail-engine.js','edge-refine.js','ai-edit-core.js'])fs.writeFileSync('qa-run/large-photo/baseline/'+n,cp.execFileSync('git',['show','ac552bde84029176fe7ad726d0113ffa0ae807fd:app/src/main/assets/'+n]));"
python -c "from PIL import Image,ImageOps; ImageOps.exif_transpose(Image.open('qa-run/large-photo/inputs/melvin-original.jpg')).convert('RGB').save('qa-run/large-photo/inference/melvin-original.png')"
cp docs/quality/20261028-large-photo/host/inference/melvin-original.json qa-run/large-photo/inference/melvin-original.json
MINT_BENCH_PHOTOS=melvin-original MINT_BENCH_EDGES=900,2560,3000 MINT_BENCH_REPEATS=5 node --expose-gc tools/benchmark-portrait-detail.cjs qa-run/large-photo/inference qa-run/large-photo/portrait-performance.json qa-run/large-photo/baseline
node tools/render-detail-performance-evidence.cjs qa-run/large-photo/inference/melvin-original qa-run/large-photo/visual qa-run/large-photo/baseline
node tools/measure-large-ai.cjs qa-run/large-photo/baseline/ai-edit-core.js qa-run/large-photo/inputs/melvin-original.jpg qa-run/large-photo/ai-performance.json
```

上面的像素回放使用随附的固定推理 JSON。若需重新检测，可另运行 `python tools/infer-photo-quality-batch.py --inputs qa-run/large-photo/inputs --output qa-run/large-photo/fresh-inference --pattern melvin-original.jpg --max-edge 3000`，另存其模型及输出摘要，不把新检测混作已归档的那次推理。

## 效果与权限边界

100% 局部实看中，强度 65 的修肤变化轻微，眼眉与胡须仍可见；面部探针 389,880 像素中 89,781 发生变化，最大通道差为 8。颈部探针 22,908 像素完全未变，自动脸部蒙版本来不覆盖颈部。头发外缘仍有灰／青光晕与折线；整图检查中，头盔、手套和下摆仍有主体误删或半透明。这些旧问题没有因本轮提速而改善。没有审美评分或抠图真值，不能称为发丝级抠图、所有肤质均自然，或达到醒图效果。

照片来源为 NASA，人物为 Leland Melvin；本目录仅作信息性软件质量验证。原图来源信用归 NASA，处理结果、检测和评价由本项目产生，不代表 NASA 或人物认可本软件。没有获得用于人物广告、产品背书或模型训练的额外许可，也不因公开可下载而授予这类权利；NASA 标识及可识别人物有各自使用边界，复用须核对 [NASA 官方图片与媒体使用指南](https://www.nasa.gov/nasa-brand-center/images-and-media/)。本目录没有用户私人照片、参考截图、接口密钥或个人本机路径。
