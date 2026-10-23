# v30 手动液化实际输出证据

comparison-zh.png 是实际生产编辑器导出的合成网格/圆形，半径25%、强度100%，明确不是界面截图。ui-output-evidence.json 记录8个实际PNG输出的RGBA摘要与原Blob不变；core生成的 grid/circle/marker 文件使用另一固定半径测试数学，参数见相应报告，不混为同一夹具。

portrait-local-comparison-zh.png 是公开 NASA 成人肖像的1000×1250测试副本；实际编辑器收缩40%、半径6%，画笔外0像素改变。public-pucker-output.png 为完整PNG，public-pixel-report.json 包含摘要/参数/来源。照片仅供非公开信息性开发QA，不是营销许可或本人认可；不评价外貌，不作自动美颜、身份保持或SOTA验收。

运行完整当前PNG回归：NODE_PATH 指向现有 @napi-rs/canvas 后，node --test tests/native-canvas/manual-deformation-pixels.test.cjs。生成中文图：node tests/native-canvas/render-manual-deformation-evidence.cjs。运行合成核心证据：MANUAL_DEFORMATION_EVIDENCE_DIR=quality/manual-deformation-evidence node --test tests/manual-deformation-core.test.cjs。

依赖均为已有批准环境；不要为了重现而绕过浏览器安全限制。此处为 NativeCanvas 真实PNG、受控DOM/选择器/桥/数据库，不是Android/WebView或真机触摸/存储性能证据。两ABI只编译未签名；未生成密钥，旧已交付APK不变。

日志中的全量入口包含独立子集，不能重复相加。档案恢复35项和打包7项是文件完整性检查，不代表图片质量或产品功能通过。完整历史像素测试需按 docs/QUALITY-ARCHIVES.md 恢复v29基线。
