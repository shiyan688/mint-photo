# 公开分发范围

本仓库公开当前薄荷修图的软件源码和开发入口。原工作区的私人 QA 素材、会话交付记录与设备凭据不属于此次发布内容，仍保留在本地，不因加入 `.gitignore` 被删除。

## 保留的内容

- `app/` 产品代码、Android 资源、模型及原始许可声明。
- `tests/` 核心、交互状态、原生/JVM 边界测试，以及生成合成画面的代码。
- `quality/` 中的数学对照、测试 harness、Java 审计和不包含原照片像素的元数据。
- `tests/fixtures/project-backup/minimal-v2.mintproject` 与 `legacy-v1.mintproject`：这两份微小格式夹具只包含合成 PNG，JavaScript 与 JVM 测试均依赖它们。
- `tests/audit/image-overlay/fixtures/`：用于图片格式、透明度和方向测试的合成图。
- `tests/model-fixture-results/host-astronaut-analysis.json`：随应用公共领域示例获得的历史检测夹具，当前纯测试读取其关键点；保留它不表示本次运行了模型。
- 当前使用说明、CI 配置、真实应用截图和本次准备的宣传材料。

应用随附模型、依赖与演示素材按 [第三方声明](THIRD-PARTY-NOTICES.md) 处理。历史私人 QA 人像包与应用的独立示例来源不能混为一谈。

## 不发布的本地内容

| 路径或类型 | 原因与处理 |
| --- | --- |
| `quality/**/*.png/jpg/jpeg/webp/...` | 历史 QA 媒体混有仅限私人信息性 QA 的人物照片和衍生图，统一从公开 Git 跟踪中排除；合成输出可由保留的代码重建 |
| `quality/**/*.rgba/gz/npy/npz` 及压缩档案 | 可能保存完整照片像素或历史素材集合，不作为源码发布 |
| `quality/mask-refine-evidence/` 中 `comparison-zh.json`、`public-host-model-mask.json`、`public-refinement-recipe.json` | 包含私人 QA 照片派生的完整蒙版像素；其他纯参数与数学元数据继续保留 |
| 两份 v29/v30 档案 manifest、Library 交付报告 | 含原会话中的私有交付标识，公开构建不需要 |
| 普通 `.mintproject` 文件 | 包含完整原照片和历史；仅显式豁免上述两份合成格式夹具 |
| `docs/LEGACY-CHECKPOINTS.md`、旧验证/构建报告、日志 | 含历史工作区和会话背景，且不是当前版本的测试结论 |
| 历史 `package-source.py`、`restore-quality-baseline.py` 及其两份专用测试 | 面向私有档案交付，包含固定的原交付信息或不遵循公开 Git 范围的打包流程；仅在本地保留 |
| `.tools/`、`.work/`、`verification/`、密钥、凭据、构建输出 | 本机工具、运行结果、账号/签名材料，不属于产品源代码 |

确切匹配规则见仓库根目录 `.gitignore`。不是忽略整个 `tests/` 或 `quality/`；CI 所需的合成夹具、核心模块和 Java 审计均继续跟踪。需要历史照片的可选审计源码保留，但没有相应原夹具时不能将其标记为通过。

## 公开验证与打包

公开回归入口是 `node tests/run-ci.cjs`，另有 `sh tests/native/run.sh`；依赖与覆盖范围见 [CI 说明](CI.md)。照片缺失的历史审计会明确说明没有运行，不会换用合成图冒充同一份照片验证。

2026-10-24 已将 Git 可跟踪候选文件复制到独立目录，在未复制上述被排除文件的条件下运行 `node tests/run-ci.cjs`：Node.js 25.7.0 / JDK 17，1645 个测试入口通过、0 失败。历史照片审计明确不在该运行清单内；这项检查验证的是公开文件集合可运行默认回归，不代表手机验收或全部可选照片审计通过。

发布源码 ZIP 时使用已经审查并提交的 Git 内容，例如：

```sh
git archive --format=zip --output=../mint-photo-source.zip HEAD
```

不要对整个工作目录直接压缩，或使用保留在本地的旧档案打包器。`.gitignore` 不会自动移除已经跟踪的文件；发布前仍应检查 `git ls-files` 中的实际清单。

## 代码许可状态

此次发布为公开源码预览，未给原代码新增 MIT、Apache 或其他项目级开源许可证。第三方组件、模型、字体和素材继续适用各自原有许可；查看仓库不代表获得这些材料以外的额外授权。
