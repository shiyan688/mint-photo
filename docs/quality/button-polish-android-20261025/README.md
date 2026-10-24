# 0.3.2 按钮细化 Android 回归

[运行记录](https://github.com/shiyan688/mint-photo/actions/runs/40114441017)全部通过。应用源码608c61a，测试源码964486e，0.3.2-dev / versionCode 7。

- [原始报告](ai-e2e-result.json)：97条流程与布局检查记录；使用API35 / x86_64模拟器。
- [真实点击痕迹](ai-e2e-click-trace.json)：27次触摸均命中预定元素，记录结构/位置/事件，不记录API字段。
- [归零检查](ai-e2e-adjustments-neutral-after-measurement.json)：4项参数全0、亮度选中、应用栏隐藏、预览像素等于最初导入。
- [独立保存PNG核对](report.json)：7项通过，检查实际发送PNG、蒙版、设备保存文件与重开流程。
- [实际按钮预览截图](ai-e2e-parameter-retained.png)。

保留[之前失败记录](../button-polish-native-failure-20261025.json)：旧自动点击在归零收起应用栏后，误点对比度滑杆。修复只修改测试的稳定定位和断言，没有放宽产品的脏预览保护，也没有修改修图算法。

这是模拟器、HTTPS模拟服务与系统文件保存验证，不是真实AI效果、实体手机、性能对比或全部功能验收。普通ARM包不含测试CA。97条检查记录不代表97项功能。
