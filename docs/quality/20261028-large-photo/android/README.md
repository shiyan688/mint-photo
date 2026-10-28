# Android 大图工作流证据

[CI 40637600164](https://github.com/shiyan688/mint-photo/actions/runs/40637600164) 全部成功，运行源码为 `a14ab5b7f896070ed757507371e4e65d610550a4`。三组均使用 Android API 35、x86_64 模拟器中的真实 WebView 和系统文件保存／重新打开流程；不是实体机验收。

三组计数、成片尺寸与计时汇总见 [native-summary.json](native-summary.json)。其中 `artifactZipSha256` 指原始 CI 下载包；本目录 `archive.json` 记录的是筛选后发布复核包的摘要，两者不是同一个 ZIP。

| 流程 | 原生检查 | 命中预期目标的触摸轨迹 | 独立复核 |
| --- | ---: | ---: | --- |
| 小图 AI 模拟服务 | 278 | 53 | [7 项保存 PNG 检查通过](independent-small.json) |
| 真实 7.2MP 大图 AI 模拟服务 | 266 | 56 | [8 项保存 PNG 检查通过](independent-large.json) |
| 真实 7.2MP 本地人像模型 | 30 | 26 | [分辨率、文件、透明度及保护区检查通过](independent-portrait.json) |

“7／8 项”是独立检查数量，不是图片数量。AI 流程使用 HTTPS 模拟服务与合成返回图，验证上传、保护区合成、保存和重开，不验证真实生成效果、费用或供应商兼容性。人像流程运行 APK 中的真实本地检测／分割模型；强度 65 使用 detail-v2，抠图使用 edge-aware v2 和透明背景。滑杆精确值由生产输入事件派发，其余主要动作使用真实触摸或系统无障碍操作，不能把 26 条轨迹解释为所有操作均由手指拖动完成。

## 保存结果与关键截图

大图来源是未放大的 2400×3000 NASA 照片。AI 原图另存 PNG 仍为 2400×3000；AI 消除保存为 2048×2560 工作尺寸，扩图保存为 2458×3072。人像修肤及透明背景两个保存 PNG **均为 2400×3000**，不是缩小后的预览冒充原图导出。

人像两次导出的 `originalDisabled` 均为 `false`。测试代码虽存在“原图预算拒绝后选择工作尺寸”的分支，本轮没有触发，不能计为已验证通过。

- [小图消除后重开](ai-e2e-evidence/ai-e2e-erase-reopened.png)、[小图扩图后重开](ai-e2e-evidence/ai-e2e-outpaint-reopened.png)。
- [大图编辑布局](ai-e2e-large-evidence/ai-e2e-editor-layout.png)、[原图 PNG 重开](ai-e2e-large-evidence/ai-e2e-original-reopened.png)、[大图消除后重开](ai-e2e-large-evidence/ai-e2e-erase-reopened.png)、[大图扩图后重开](ai-e2e-large-evidence/ai-e2e-outpaint-reopened.png)。
- [本地人脸选择](portrait-large-evidence/portrait-large-face-selected.png)、[修肤保存后重开](portrait-large-evidence/portrait-large-skin-reopened.png)、[透明背景保存后重开](portrait-large-evidence/portrait-large-background-reopened.png)。

独立人像复核中，修肤 PNG 全部 7,200,000 像素保持不透明；透明背景 PNG 同时含透明、半透明和不透明像素，2,628,649 个受检不透明前景像素的 RGB 不匹配数为 0。这只能证明文件和像素约束，不能证明边缘位置正确。头发光晕、头盔／手套／下摆的物体误删仍存在；本轮性能优化没有改善修图效果，也不宣称发丝级抠图或所有肤质自然。JPEG 解码差异也可能计入修肤与原图的差异像素数。

## 性能与内存限制

JSON 中的安卓耗时包含触摸、系统选择器、轮询和自动化等待，不能当作纯算法耗时或实体机 FPS。三个 `app-memory-after.txt` 均返回 **`No process found`**，因此本轮**没有测得应用内存**，既没有峰值，也没有有效的结束时内存值。原样保留这些文件及 `memory-scope.txt`，不把采样命令执行过当作测量成功。

## 完整复核 ZIP

Git 中只保留报告、原生 JSON、状态文本和每组 4～5 张关键 UI 截图。完整复核包 `mint-photo-0.3.4-android-evidence.zip` 见 [v0.3.4-dev.1 附件](https://github.com/shiyan688/mint-photo/releases/tag/v0.3.4-dev.1)；下载地址、文件大小、ZIP SHA-256、内部清单 SHA-256 和本目录文件摘要见 [archive.json](archive.json)。

ZIP 内包括三组全部 JSON／PNG（含实际保存成片、请求图、蒙版和模拟响应）、`instrumentation.txt`、`display-size.txt`、`memory-scope.txt`、`app-memory-after.txt`、三份独立报告、原生汇总及 `manifest.json`。不包含 logcat、设备属性、模拟服务日志、其他日志、密钥或证书。`requests.json` 明确记录 `keyRecorded: false`。内部清单对每个载荷文件记录字节数和 SHA-256；清单自身由 `archive.json` 单独校验，避免自引用哈希。

下载后先按 `archive.json` 核验 ZIP，再解压并按内部 `manifest.json` 核对全部文件。保持三个证据子目录名称不变，可用仓库内校验器重新检查（Python 需 Pillow 与 numpy）：

```sh
python tools/verify-ai-e2e-evidence.py evidence/ai-e2e-evidence --output rechecked-small.json --commit a14ab5b7f896070ed757507371e4e65d610550a4 --run-url https://github.com/shiyan688/mint-photo/actions/runs/40637600164
python tools/verify-ai-e2e-evidence.py evidence/ai-e2e-large-evidence --output rechecked-large.json --commit a14ab5b7f896070ed757507371e4e65d610550a4 --run-url https://github.com/shiyan688/mint-photo/actions/runs/40637600164
python tools/verify-portrait-large-evidence.py evidence/portrait-large-evidence --source melvin-original.jpg --output rechecked-portrait.json --commit a14ab5b7f896070ed757507371e4e65d610550a4 --run-url https://github.com/shiyan688/mint-photo/actions/runs/40637600164
```

上述示例把 ZIP 解压到 `evidence/`。人像复核另需 [source.json](portrait-large-evidence/source.json) 指定的原始 JPEG，校验器会核对其字节摘要和尺寸；ZIP 不另外打包原始 JPEG。命令的提交和 CI 地址是来源标签，不是校验器独立证明的 Git 身份。

照片仅用于信息性软件 QA，不是用户私人照片，也不表示 NASA 或人物为应用背书。原图来源、摘要及权限范围见各大图组的 `source.json` 和[主机证据说明](../host/README.md#效果与权限边界)；这些验证不授予广告、肖像背书或训练用途的额外许可。
