# 贡献指南

本项目维护 [alibaba/open-code-review](https://github.com/alibaba/open-code-review) 的 DeepSeek Harness 适配。请将引擎功能与算法改进反馈给上游；本仓库的修改主要涉及 dsh 注册、执行、资源与分发集成。

## 本地开发

需要 Node.js `^22.19.0 || >=24.0.0` 和 Git 2.41+。从项目目录运行：

```sh
npm ci
npm run check
npm test
npm pack --dry-run
```

用独立 dsh profile 执行 `add --ignore-scripts` 安装源码或 tarball，并保留 optional 平台依赖，然后检查配置层、技能发现和无需模型凭据的 OCR 命令。插件无需 build；跳过的依赖 `postinstall` 由官方预构建平台二进制覆盖。修改进程适配时，验证参数独立传递、会话运行目录、原沙箱边界、一次审批、失败退出码、取消与完整输出。配置有效 provider 后可补充真实模型审查验证；环境凭据按本机 `forwardEnv` 明确选择转发，默认不额外转发环境变量。

## 上游升级

CLI 依赖和 vendored 技能应取自同一个官方版本。当前版本与 commit 见 [`UPSTREAM.json`](vendor/open-code-review/UPSTREAM.json)。

升级时：

1. 核对上游 release、CLI 参数、技能工作流、许可证和资源文件。
2. 同步官方 npm 依赖、lockfile、同版本技能及 SHA-256 记录。
3. 保留上游资源原文与版权；dsh 指引放在适配层。
4. 检查原生与委托模式的区别，以及 PR 快照、覆盖率、Analysis、resume 的规则。
5. 更新 README、功能映射与 NOTICE，运行检查并从 tarball 验证安装。

不要在依赖升级时默认改变用户的 OCR provider、模型、凭据或项目配置。新增公开功能与文档必须对应真实的上游或适配实现。

## 提交与许可

描述具体问题、修改后的行为与验证结果。报告真实模型测试时注明使用的 provider 和目标范围，避免在日志或附件中提交凭据、私有源码或审查产物。

提交的适配代码按本项目 Apache-2.0 分发。复用上游或第三方文件时保留原版权和许可，并更新相应归属记录。发布与插件商店收录流程见 [PUBLISHING](docs/PUBLISHING.md)。
