# 安卓 HTTPS 模拟服务闭环证据

2026-10-24；[完整成功运行](https://github.com/shiyan688/mint-photo/actions/runs/40029036284)，源码 `b4b3f75ed57320c5097d2f137012e35121a1753a`。Android API35 / x86_64 模拟器，540×1200、density210；不是实体手机。

使用应用内公开NASA照片（512×512不透明PNG），测试填写虚构接口/模型/密钥，实际触屏涂抹，通过原生HTTPS发multipart。模拟服务返回明显的洋红图案，**不是AI模型出图，不作AI效果宣传**。分别保存512×512消除图和716×716扩图，系统DocumentsUI实际写入并重新打开；等待源图片安装标识改变且处理完成，避免拿旧画面冒充重开成功。另验证401、比例错误、取消后重试与首页示例。

- `ai-e2e-result.json`：原始Android报告，34项检查通过；API、ABI、模拟服务/非真机标记明确保留。
- `report.json`：Pillow/numpy独立核对实际保存PNG的7项检查与所有PNG的SHA256，均通过。
- `saved-erase.png`、`saved-outpaint.png`：设备真正写出的文件；请求图片、蒙版与模拟输出一同保留，便于独立复查。
- `ai-e2e-*.png`：实际运行窗口截图；不是设计稿。配置由测试填写，软键盘输入体验未验收。

消除257545个保护像素与实际发送PNG一致，扩图原中心512×512与前一次保存图一致；新增边缘与合成模拟输出一致。该次预览/发送/保存/重开检查为零像素差异，不能推广为全部透明图、大图、JPEG或所有手机无损。12次亮度输入到两帧的中位数53.75ms、p95约125.79ms，受模拟器/自动化影响，不能当真机帧率或性能提升倍数。

照片来源与授权说明见[第三方声明](../../THIRD-PARTY-NOTICES.md)，不表示NASA或人物为应用背书。普通ARM包的签名、资源及不含测试CA证明见[构建记录](../workbench-build-20261024.json)。真实供应商出图、实体手机、弱网、进程恢复、内存峰值和修肤/抠图审美质量仍未验收。

复查：安装Pillow和numpy后，在项目根运行 `python tools/verify-ai-e2e-evidence.py docs/quality/android-ai-e2e-20261024 --output .work/rechecked.json --commit b4b3f75ed57320c5097d2f137012e35121a1753a --run-url https://github.com/shiyan688/mint-photo/actions/runs/40029036284`。
