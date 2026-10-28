# 0.3.3 三处界面 Android 验证

[最终运行](https://github.com/shiyan688/mint-photo/actions/runs/40120891206)通过。应用与测试源码为`1058180c00b0e972ee5b5f46d04c4103aef6f6f4`，0.3.3-dev / versionCode 8，Android API35 / x86_64模拟器。

- [原生检查](ai-e2e-result.json)：278条流程、布局和图标绘制检查记录，不代表278项功能。
- [点击轨迹](ai-e2e-click-trace.json)：53次触摸均记录命中目标；通过实际触摸完成主页入口、AI表单和系统保存操作。
- [独立保存PNG核对](report.json)：7项通过，验证发送的PNG/蒙版、受保护区域、扩图中心、保存及重新打开的像素和尺寸。报告包含42张本次原始PNG的SHA256。
- [首页实际图标像素](ai-e2e-home-icon-pixels.json)：同一张原生截图中，五个主入口图标中央区域分别含87、202、143、188、190个深色像素。
- [Python独立图标复核](home-icon-paint-positive.json)：同样通过。[负对照](home-icon-paint-negative-control.json)使用旧版`591b883`的[空图标截图](home-icons-before-fix.png)，五个区域全为0，预期失败。负对照与最终截图尺寸、主页布局一致。此检查识别空白绘制，不评价图标造型。

当前实录：[首页](ai-e2e-home-actions.png)、[AI设置](ai-e2e-home-ai-opened.png)、[保存弹窗](ai-e2e-erase-save-reachable.png)。旧版流程虽通过，但图标未绘制，未作为最终界面验收；本次将首屏SVG预先写入HTML并补了实际截图像素检查。底层WebView绘制原因尚未确定。

复核命令（项目根目录）：

```sh
python tools/verify-ai-e2e-evidence.py docs/quality/surfaces-android-20261025 --output report-local.json --commit 1058180c00b0e972ee5b5f46d04c4103aef6f6f4 --run-url https://github.com/shiyan688/mint-photo/actions/runs/40120891206
python tools/verify-home-icon-paint.py docs/quality/surfaces-android-20261025 --output icons-local.json
python tools/verify-home-icon-paint.py docs/quality/surfaces-android-20261025 --screenshot docs/quality/surfaces-android-20261025/home-icons-before-fix.png --output negative-local.json
```

最后一条应退出1并显示FAIL，仅表示负对照被正确识别。图标脚本需Pillow和NumPy；独立保存脚本的依赖见文件顶部。

这是HTTPS模拟服务、真实WebView和系统文件保存验证。真实AI效果、实体手机性能/键盘及供应商兼容性仍未验收。普通ARM APK不含测试CA；构建、签名和资源一致性见[构建报告](../surfaces-build-20261025.json)。截图中的人像是随包公开NASA示例，未使用用户提供的私人参考照片。
