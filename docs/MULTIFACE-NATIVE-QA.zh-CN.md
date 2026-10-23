# 多人脸原生契约与公开样片云端验证

## 原生契约

`PortraitAnalyzer` 使用同一串行工作线程上的官方 MediaPipe Face Landmarker、CPU、IMAGE 模式，最多返回 5 张脸，不在原生端选中第一张脸。没有人脸或任何一张脸的数据不完整时，整个结果失败，不丢弃坏候选后改变编号。

成功回调结构：

```json
{
  "ok": true,
  "faces": [{"landmarks": [{"x": 0.1, "y": 0.2, "z": -0.01}]}],
  "detector": {
    "id": "mediapipe-face-landmarker",
    "modelSha256": "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
    "topology": "MediaPipe478"
  },
  "detectionSize": {"width": 900, "height": 680},
  "faceLimit": 5
}
```

上面省略展示了关键点；真实每张脸必须完整包含 478 个有限的 x/y/z。`faces` 为 1–5 个候选，顺序为模型本次输出顺序，不代表身份、跨照片跟踪或自动选中。坐标不补齐或夹断，部分脸在图外的有限坐标仍如实保留。`detectionSize` 来自实际解码、缩放后的 `MPImage`，不是原图或约定的预览尺寸。

SHA-256 在首次推理前直接读取 APK 内 `models/face_landmarker.task` 计算，再缓存在该分析器实例中，不是只报告硬编码名称。原生烟测另检查上述已验证模型哈希。模型加载、检测和关闭仍由 Activity 的单工作线程串行处理；图片构造失败也回收已解码位图。

## 真实公开照片主机推理

本轮使用现有公开成人肖像资料包中的 Jonny Kim、Kalpana Chawla、Naoko Yamazaki、Chiaki Mukai 和 Leroy Chiao 图像。成人事实来自已有官方来源资料，不由外貌估计。先检查原始像素，验证原图哈希，再裁出头部制作有清楚间距的人工拼接图。图片直接标注「SYNTHETIC」「Not a real group photograph」和 NASA 来源。

- 双人合成图：900 × 500，实际检测到 2 张脸，每张 478 点。
- 五人合成图：900 × 680，实际检测到 5 张脸，每张 478 点。
- 输入最长边均为 900，与手机前端实际预览输入尺度一致，不是用更高输入分辨率替代。
- 完整坐标为该合成图重新推理的输出，不是把单人关键点平移拼在一起。
- 官方 MediaPipe Tasks Python 0.10.21，CPU，Linux x86_64，Python 3.12.14；模型与 Android 包内字节 SHA-256 完全一致。
- 两次合成图推理分别约 25 ms、66 ms，仅为本次云端主机观察，不能换算为手机性能或时延承诺。

证据目录 `mobile-multiface-qa` 包含两张 `synthetic-*-adults-900.png`、对应完整 `.landmarks.json`、`host-inference-evidence.json` 和原始推理日志。JSON 记录原图来源/哈希、成人来源、原图裁切坐标、拼接位置、合成图哈希、模型/运行时/CPU、检测尺寸、实际脸数及每脸点数。编号标签是拼接来源的位置，不是身份识别或跨照片跟踪 ID。

仅用于已授权的本地信息性质量验证，不用作营销、训练、背书或 APK 素材；不主张肖像营销授权。没有上传用户照片，也没有新增下载或依赖。间距清晰的合成测试不代表复杂真实合照的召回率。

## 可复跑脚本

使用已经具备 MediaPipe、Pillow 和 numpy 的已批准环境：

```sh
MPLCONFIGDIR=/writable/cache XDG_CACHE_HOME=/writable/cache \
  /path/to/existing-venv/bin/python tests/native/host-multiface-qa.py \
  --model app/src/main/assets/models/face_landmarker.task \
  --source-pack /path/to/asian-portrait-qa \
  --output /path/to/mobile-multiface-qa
```

脚本不下载、不上传、不训练，不把样片复制到 app assets。它对模型哈希、来源哈希、成人记录、1–5 候选、完整有限 478 点及最终 2/5 脸数做断言。数量不符会保留真实结果并以失败退出，不制造成功输出。

## 原生与 WebView 验证边界

- 已在现有官方 JDK 17 / Android SDK / 固定依赖上离线编译生产 Java 和两个 instrumentation 源码，不签名、不安装、不创建密钥。
- `PortraitSmokeInstrumentation` 新增 48 项契约边界检查：1–5 候选、空/过量/不完整/空点/NaN/Infinity、后续坏脸整体拒绝、尺寸边界、哈希格式、SHA 已知答案及有限图外坐标保留。实际模型部分仍使用已有公开宇航员示例，并核验新返回形状、模型哈希和实际尺寸。
- `PortraitBridgeSmokeInstrumentation` 检查新原生回调，再通过生产按钮显式选择第一候选，设置非零磨皮，检查预览像素变化和已提交步骤，再做背景与证件照。
- 已移除旧的「已识别人脸」文本依赖以及捕获 UI 失败后仍 `finish(0)` 的误报。任何 UI 超时/异常应失败，只有完整流程通过才保存 PASS；失败会覆盖旧结果文件，避免读到上次成功。
- 本轮没有执行 Android instrumentation、WebView 或手机验收。主机真实推理与 Java 编译都不等于 Android 运行时结果；多脸 Android 实测、设备性能和复杂合照仍待授权设备验证。
