# Android 构建与安装

当前应用名为「薄荷修图」，开发分支显示版本 `0.3.3-dev`，Android `versionCode` 为 8。安装包下载以仓库 README 和对应 Release 为准，0.2 为历史预览。
包名保留为 `com.qingyan.editor.portrait`，Java 命名空间为 `com.qingyan.editor`。

2026-10-25 最终应用源码 `1058180` 的两 ABI 调试包通过构建、lint、签名、16 KiB 对齐与 95 个资源逐字节核对，见[构建报告](quality/surfaces-build-20261025.json)。[本轮原生报告](quality/surfaces-android-20261025/report.json)来自 API35 / x86_64 模拟器和 HTTPS 模拟服务，包含实际 WebView 操作、系统文件保存和重开；它不代表 ARM 实体手机、真实 AI 生成效果或设备性能验收。界面与范围见[首页与弹窗记录](SURFACE-STYLE-QUALITY.md)。

## 工具链

- JDK 17
- Gradle 8.9，使用仓库 Wrapper，已固定分发包 SHA-256
- Android Gradle Plugin 8.7.3
- Android platform 35、build-tools 35.0.0
- `minSdk 26`、`targetSdk 35`
- `com.google.mediapipe:tasks-vision:1.0.0`，离线模型与第三方声明随 APK 打包

配置 `JAVA_HOME` 和 `ANDROID_HOME`，或在未跟踪的 `local.properties` 中设置 `sdk.dir`。
首次构建需要联网获取官方依赖，开发分支增加 INTERNET 普通权限供用户主动确认的原生HTTPS图像编辑使用；日常修图与模型仍离线，WebView网络封锁、禁止明文传输保持开启。密钥由用户在应用内填写，不内置、不保存。

```sh
./gradlew -PportraitAbiSplits :app:assembleDebug :app:lintDebug
python3 tests/verify-apk.py
```

Windows 使用 `gradlew.bat` 和 `python`。ARM64 与 ARM32 APK 位于
`app/build/outputs/apk/debug/`。默认不启用分包时生成四 ABI 的通用调试包。

## 调试安装包

标准 debug 构建使用 Android 调试证书，可供测试安装；release 构建没有配置生产签名。
`MINT_TEST_KEYSTORE` 可指定已有的标准 Android debug keystore，私钥不应提交到仓库。

优先使用 ARM64 包；只有 32 位 ARM 设备使用 ARM32 包，无需同时安装两种包。
最低系统版本为 Android 8.0，还需要支持应用所用 Canvas 功能的系统 WebView。

调试证书不是正式发布身份，CI 每次使用的证书也可能不同。
若之前的安装包签名不同，不能直接覆盖安装；卸载前应先导出重要工程。
保持包名只保留应用身份，并不能绕过 Android 的签名校验。

GitHub Actions 会运行纯逻辑及 JVM 边界测试、编译、lint、签名检查、
资产逐字节核对、ZIP/ELF 16 KiB 对齐检查，并提供测试 APK 与 SHA-256 下载。
具体测试范围及缺失的历史夹具见 [CI 说明](CI.md)。

编译和签名验证不替代手机上的触摸、输入法、系统文件选择器、真实数据库恢复、
内存/速度或照片效果验收。测试 APK 不应标为已通过这些项目的正式版本。
