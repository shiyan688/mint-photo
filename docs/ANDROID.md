# Android 构建与安装

当前应用名为「薄荷修图」，显示版本 `0.2.0-preview`，Android `versionCode` 为 4。
包名保留为 `com.qingyan.editor.portrait`，Java 命名空间为 `com.qingyan.editor`。

## 工具链

- JDK 17
- Gradle 8.9，使用仓库 Wrapper，已固定分发包 SHA-256
- Android Gradle Plugin 8.7.3
- Android platform 35、build-tools 35.0.0
- `minSdk 26`、`targetSdk 35`
- `com.google.mediapipe:tasks-vision:1.0.0`，离线模型与第三方声明随 APK 打包

配置 `JAVA_HOME` 和 `ANDROID_HOME`，或在未跟踪的 `local.properties` 中设置 `sdk.dir`。
首次构建需要联网获取官方依赖，应用运行本身不申请网络权限。

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
