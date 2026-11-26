# Alibaba Open Code Review for DeepSeek Harness

[English](README.en.md) | 简体中文

本项目是**针对 [alibaba/open-code-review](https://github.com/alibaba/open-code-review) 开发的 DeepSeek Harness（dsh）插件**，由社区维护。审查核心直接复用官方 `@alibaba-group/open-code-review` CLI；上游的原生审查和委托审查技能及其资源随插件一起分发。

本插件使用 **Apache-2.0** 许可证，保留上游版权与许可。具体归属见 [NOTICE](NOTICE)、[LICENSE](LICENSE) 和 [上游版本记录](vendor/open-code-review/UPSTREAM.json)。

## 功能

| 能力 | 在 dsh 中的入口 |
| --- | --- |
| OCR 专用 agent 的完整原生管线：变更选择、文件分组、规则匹配、审查、定位、反思 | `/open-code-review`、`open_code_review` 工具 |
| 用当前 dsh 模型审查，复用 OCR 的文件选择、规则分组与覆盖要求 | `/open-code-review-delegate` |
| 工作区、分支比较、单提交审查；行为与影响分析 | `review` 子命令及全部上游参数 |
| 整库、目录和文件扫描；计划、去重、汇总、批处理 | `scan` 子命令 |
| GitHub PR 的固定版本快照、审查产物与新鲜度记录 | 原生技能、`open_code_review_pr` 工具 |
| 自定义规则、多模型配置、身份验证与连接测试 | `rules`、`config`、`auth`、`llm` 子命令 |
| 会话管理与恢复、结果比较、text / JSON / SARIF、离线 HTML 与 Web viewer | `session`、`viewer` 及审查输出参数 |
| 上游 MCP 客户端与 OpenTelemetry 配置 | 原版 OCR 配置 |

CLI 子命令和参数通过插件透传。完整功能、限制和源码对应关系见 [功能复用说明](docs/FEATURES.md)。

**两种审查方式的凭据不同：**原生模式使用 OCR 自己配置的模型端点与凭据，运行完整上游管线；委托模式使用当前 dsh 模型，OCR 负责文件选择与规则解析，审查和定位由宿主 agent 完成。委托模式无需额外 OCR API key，宿主模型的认证与计费仍然生效。

## 安装

需要 DeepSeek Harness **0.2.2-rc.5 或兼容版本**、Node.js **22.19 及以上的 22.x，或 24 及以上版本**（`^22.19.0 || >=24.0.0`）和 Git **2.41+**。GitHub PR 模式另外需要 Python 3 与已登录的 GitHub CLI（`gh`）。

在插件源码目录安装依赖，然后加入选定的 dsh profile：

```sh
npm ci
dsh plugin --profile code-review add --ignore-scripts .
dsh --profile code-review --dump-config
dsh --profile code-review
```

把 `code-review` 换成你实际使用的 profile；安装、更新或移除后重启该 profile。插件分发的是可直接执行的 ESM JavaScript，无需本插件的编译或 `prepare` 脚本。`--ignore-scripts` 跳过官方 OCR 依赖的 `postinstall`，避免 DSH 的严格依赖脚本策略阻止安装；对应平台的 optional npm 包已携带原生二进制，插件会检查它是否存在。保留 optional dependencies，二进制缺失时会明确报错。

也可以分发 tarball：

```sh
npm pack
dsh plugin --profile code-review add --ignore-scripts ./dsh-ali-open-code-review-0.1.0.tgz
```

发布到 npm 后，安装命令为：

```sh
dsh plugin --profile code-review add --ignore-scripts dsh-ali-open-code-review
```

公开仓库发布后，也可直接从 GitHub 源码安装：

```sh
dsh plugin --profile code-review add --ignore-scripts github:listky/dsh-ali-open-code-review
```

## 使用

在 dsh 对话中调用技能并给出审查目标：

```text
/open-code-review 审查当前工作区的修改
/open-code-review 审查当前分支相对 main 的提交，分析行为变化
/open-code-review-delegate 使用当前模型审查工作区的所有修改
```

插件向 agent 提供 `open_code_review` 工具。参数是 CLI 参数数组；每个参数独立传递，例如：

```json
{"args":["review","--preview"]}
```

```json
{"args":["delegate","preview","--format","json"]}
```

```json
{"args":["scan","--path","src","--audience","agent","--format","json","--output","scan.json"]}
```

工具可传 `args`、`cwd`、`timeoutMs`。运行目录默认取当前 dsh 会话的项目；`cwd` 可为绝对路径或相对此项目的路径，并沿用会话原有的可写边界。`timeoutMs` 是整个调用的时限，与 OCR 每组的 `--timeout` 分开。

工具返回 `kind`（`ocr` / `pr`）、`ok`、`exitCode`、`timedOut`、`aborted`、`durationMs`，并分别记录 `stdout` 与 `stderr`。输出超出展示上限时，先检查 `complete`；完整输出可用时，读取 `spillPath` 后再报告结果。原生报告建议用 `--output` 保存，保留其中的覆盖率、失败文件和 Analysis 状态。

在源码目录还可直接运行随包提供的终端入口，使用交互式配置、viewer 和任意上游命令：

```sh
node ./bin/dsh-ocr.js config provider
node ./bin/dsh-ocr.js config model
node ./bin/dsh-ocr.js llm test
node ./bin/dsh-ocr.js review --from main --analysis --audience agent --format json --output review.json
node ./bin/dsh-ocr.js session list
node ./bin/dsh-ocr.js viewer
```

原生模式读取 OCR 的 `~/.opencodereview/config.json`，其中已有的 provider 与凭据按上游行为使用。也可在调用参数中传 `--provider deepseek --model <账号可用模型名>`；用 `config model` 选择模型、`llm providers` 查看内置 provider，模型名须在该 provider 的账号中实际可用。

`open_code_review_pr` 的 `args` 直接传上游脚本参数，例如 PR URL、`--repo OWNER/REPO` 与 `--background`。适配器将字面 `ocr` 绑定到官方原生二进制，并在 POSIX 上保持 OCR 位于 DSH 受管进程组内，以支持取消；上游脚本原文保留。工作流使用固定 SHAs，保留 `run.json`、结果和快照，清理须遵循上游技能的规则。

## 插件配置

使用环境变量凭据时，在 **DSH 启动前**于本机设置 `DEEPSEEK_API_KEY`，并在当前 profile 的 `cordis.patch.yml`（默认 `~/.dsh/profiles/code-review/cordis.patch.yml`）加入：

```yaml
- id: ali-open-code-review
  name: dsh-ali-open-code-review
  config:
    forwardEnv:
      - DEEPSEEK_API_KEY
```

`forwardEnv` 默认是空数组；只有本机配置明确列出的环境变量名会转发到 agent 工具启动的 OCR。凭据也可直接在本机通过终端入口配置到 OCR。上述 patch 替换该插件行的完整 `config`；已有其他自定义配置时，将它们一起写入。凭据在本机设置，不要输入到聊天中。

| 配置项 | 默认值 | 用途 |
| --- | --- | --- |
| `executable` | 官方 npm 平台二进制 | 可选的原生 OCR 绝对路径或 PATH 名；不接受 `.cmd` / `.bat` / `.ps1`。 |
| `pythonExecutable` | Windows 为 `python`，其他平台为 `python3` | PR 辅助脚本的 Python 3 可执行文件。 |
| `timeoutMs` | `3600000`（1 小时） | 整个工具调用的时限，单位毫秒。 |
| `maxOutputBytes` | `262144`（256 KiB） | stdout / stderr 各自的展示上限。 |
| `maxSpillBytes` | `67108864`（64 MiB） | 每个输出流的完整文件上限，须不小于 `maxOutputBytes`。 |
| `graceMs` | `5000` | 进程终止宽限时间，单位毫秒。 |
| `forwardEnv` | `[]` | 由本机配置明确选择的环境变量名。 |
| `skills` | `true` | 注册两个上游技能。 |

工具沿用当前会话的沙箱策略。OCR 的配置与会话存储位于 `~/.opencodereview`，在 read-only 或仅允许工作区写入的策略下，写入可能被拒绝；可通过本机终端完成配置，或按 DSH 正常审批流程对同一调用传 `sandbox_permissions` 与 `justification`，申请一次更宽模式。拒绝或后端不可用会报告失败，工具不会自动绕过沙箱。

## 验证与维护

```sh
npm run check
npm test
npm pack --dry-run
```

检查覆盖插件入口、打包合同、上游资源 SHA-256 和无需模型凭据的 CLI 行为；真实原生模型审查需要配置有效 OCR provider 后另行运行。

当前复用版本为 **Open Code Review v1.14.4**，源码 commit 为 `d4f568f71d3a9d5c5ec972791b1509e40cd31ad1`。升级应同时更新 CLI 依赖与技能资源，并复核行为合同，见 [贡献指南](CONTRIBUTING.md)。

## 排查

- 工具或技能未出现：确认安装进当前 profile，检查 `--dump-config` 是否包含本插件的 bundle，然后重启 profile；精简组合需提供 tools、skills 及执行服务。
- `ERR_PNPM_IGNORED_BUILDS`：按上述 `add --ignore-scripts` 命令安装。先前失败的 profile 可能已写入依赖但尚未加入 bundle；使用新的验证 profile，或先执行 `dsh plugin --profile code-review remove dsh-ali-open-code-review` 再重新安装，并核对 `--dump-config`。
- OCR 二进制缺失：检查是否关闭了 optional dependencies；恢复官方平台包，或自行安装官方 OCR 并将 `executable` 指向原生二进制。Windows 的 `.cmd` 启动脚本不能作为 `executable`。保留上游错误信息，勿把安装失败当成空审查结果。
- 原生审查连接失败：在本机运行 `node ./bin/dsh-ocr.js llm test`，核对 OCR provider、模型、网络和凭据；也可主动选择委托技能。
- 覆盖不完整或 Analysis 失败：读取完整产物中的状态。审查退出成功不代表 Analysis 已成功，也不代表每个文件均完成审查。

## 开源与插件商店

本插件包名为 `dsh-ali-open-code-review`，计划发布到 [listky/dsh-ali-open-code-review](https://github.com/listky/dsh-ali-open-code-review)。本仓库提供 npm bundle、许可与归属文件以及发布说明。实际 npm 发布、GitHub 公开仓库和商店收录是独立步骤；操作方法见 [开源与上架指南](docs/PUBLISHING.md)。

社区插件商店通过 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 收录，要求公开仓库创建满一天、添加 `dsh-plugin` topic，并提交一个插件 YAML 条目。完成代码与打包验证后，再按商店当前规则申请收录。

## 致谢

审查引擎、规则、原生与委托技能、GitHub PR 工作流由 [alibaba/open-code-review](https://github.com/alibaba/open-code-review) 提供。插件的 dsh bundle、工具注册、执行适配与发布集成由本项目维护。DeepSeek Harness 的插件接口见 [官方项目](https://github.com/deepseek-ai/deepseek-harness)。
