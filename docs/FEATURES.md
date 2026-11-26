# 上游功能复用说明

本插件针对 [alibaba/open-code-review](https://github.com/alibaba/open-code-review)，固定复用官方 npm 包 `@alibaba-group/open-code-review@1.14.4`。技能资源取自同版本 tag，精确 commit 为 `d4f568f71d3a9d5c5ec972791b1509e40cd31ad1`；文件 SHA-256 记录在 [`UPSTREAM.json`](../vendor/open-code-review/UPSTREAM.json)。

`open_code_review` 将参数数组交给官方 CLI。引擎的文件选择、规则、模型调用、专用 agent、定位、反思、报告和会话逻辑由上游执行。dsh 适配负责工具与技能注册、运行目录、进程执行和结果交付。下表的源码路径相对于 [固定版本的上游仓库](https://github.com/alibaba/open-code-review/tree/d4f568f71d3a9d5c5ec972791b1509e40cd31ad1)。

| 功能 | 原版入口 | 上游依据与使用范围 |
| --- | --- | --- |
| 工作区审查 | `review` | `cmd/opencodereview/review_cmd.go`；包含 staged、unstaged、untracked 修改。 |
| 单提交与分支审查 | `review --commit`、`review --from [--to]` | `cmd/opencodereview/shared_flags.go`；range 按 merge-base 比较，`--from` 未传 `--to` 时默认 `HEAD`。 |
| 行为、影响与维护决策分析 | `review --analysis` | `review_cmd.go`、`internal/behaviortask/`；支持 commit / range 的 text / JSON。 |
| 预览与审查范围控制 | `review --preview`、`--rule`、`--exclude`、`--background`、`--background-file` | `shared_flags.go`、`internal/agent/selection.go`、`internal/config/rules/`。 |
| 专用审查 agent 与完整管线 | `review` | `internal/agent/`、`internal/reviewtask/`、`internal/config/template/`；包含文件分组、规则、计划、审查、定位与反思。 |
| 并发、effort、工具、Git 与 token 预算 | `review` / `scan` 对应参数 | `shared_flags.go`；预算可能产生部分结果，应读取覆盖状态。 |
| 全文件扫描 | `scan [--path]` | `cmd/opencodereview/scan_cmd.go`、`shared_flags.go`；计划、批处理、去重与项目汇总，支持恢复。 |
| 宿主模型委托审查 | `delegate preview`、`delegate rule` | `cmd/opencodereview/delegate_cmd.go`、`skills/open-code-review-delegate/SKILL.md`；文件选择与规则解析由 OCR 执行，审查与定位由 dsh agent 执行。 |
| GitHub PR 审查 | 原生技能及 `open_code_review_pr` | `skills/open-code-review/scripts/review_pr.py`；解析 PR、固定 SHAs、创建快照、记录产物与 freshness。 |
| 规则检查与自定义规则 | `rules`、`--rule` | `cmd/opencodereview/rules_cmd.go`、`internal/config/rules/`；保留项目、用户与内置规则的优先级。 |
| 会话与审查恢复 | `session list/show/comments/compare/export/rm`、`review/scan --resume` | `cmd/opencodereview/session_cmd.go`；comments 支持 severity / category，compare 区分 new / persisting / resolved / not-reviewed。 |
| 报告格式与离线 viewer | `--format`、`--output`、`session export`、`viewer` | `shared_flags.go`、`session_cmd.go`、`viewer_cmd.go`、`internal/viewer/`；支持原版 text / JSON / SARIF 与离线 HTML。 |
| 模型配置、认证与连接测试 | `config`、`auth`、`llm` | `cmd/opencodereview/config_cmd.go`、`auth_cmd.go`、`llm_cmd.go`、`internal/llm/`。 |
| DeepSeek 与其他 provider | `--provider`、`--model`、OCR 配置 | `internal/llm/providers.go`；DeepSeek provider 读取 `DEEPSEEK_API_KEY`，其他 provider 保留上游行为。 |
| MCP 外部业务上下文 | OCR `mcp_servers` 配置 | `pages/src/content/docs/en/mcp.md`、`internal/mcp/`；上游在 `review` 接入 MCP，`scan` 不接入。 |
| OpenTelemetry | OCR `telemetry` 配置与环境变量 | `pages/src/content/docs/en/telemetry.md`、`internal/telemetry/`；上游默认关闭。 |
| 终端操作与帮助 | `dsh-ocr` / `node bin/dsh-ocr.js` | 官方 CLI 的所有参数与子命令；适用于交互式配置、认证、补全和长期运行的 viewer。 |

## 技能与资源

以下文件保留上游内容和相对目录关系：

- `vendor/open-code-review/skills/open-code-review/SKILL.md`
- `vendor/open-code-review/skills/open-code-review/scripts/review_pr.py`
- `vendor/open-code-review/skills/open-code-review-delegate/SKILL.md`
- `vendor/open-code-review/LICENSE`

dsh provider 将完整上游技能正文与必要的宿主执行指引交给 agent，资源基址指向对应的技能目录。PR 适配器将字面 `ocr` 绑定到插件的官方原生二进制，并在 POSIX 上保持该子进程位于 DSH 受管进程组内，以支持取消；上游 Python 文件原文保留。维护时先校验 `UPSTREAM.json`，以便确认资源对应固定的官方版本。

## 上游约束

- 原生模式需要 OCR provider；委托模式使用当前 dsh 模型，覆盖要求保留，但 OCR 的原生审查、定位和反思 agent 不运行。
- `--analysis` 适用于 commit / range 的 text / JSON；workspace、preview、resume 和 SARIF 有上游兼容性约束。Review 的退出码与 Analysis 状态应分别检查。
- workspace 审查不支持 resume；range / commit 恢复必须保持原目标。`scan` 的恢复遵循原版会话记录。
- 委托模式输出 text / JSON，覆盖清单以 `(path, status)` 为身份；每个预览出的文件都要记录 reviewed 或带原因的 skipped。
- GitHub PR 模式需要 Python 3 和已认证的 `gh`。上游脚本会检查 MCP 与 Git 过滤元数据，并保留快照；策略停止与清理要求沿用上游。
- 交互式配置、登录、删除确认和常驻 viewer 适合在终端入口运行。agent 工具调用以可完成的非交互任务为主。
- 工具执行沿用当前会话沙箱，`cwd` 不改变会话的可写边界。`sandbox_permissions` 与 `justification` 走 DSH 对同一调用的一次审批；后端不可用或拒绝会报告失败。
- OCR 的 `~/.opencodereview` 配置与会话写入可能受 read-only / workspace-write 限制。终端入口用于本机配置；工具不会自行拓宽沙箱。
- 工具只转发本机 `forwardEnv` 明确列出的环境变量名，默认 `[]`；OCR 中已有的凭据仍按上游配置读取。环境凭据需要在 DSH 启动前于本机设置并选择转发。
- 结果中的 `ok`、退出码、stdout / stderr 和完整性字段用于区分执行成功、失败与输出缺失。使用完整报告核对覆盖，不能把进程或 provider 错误视为没有发现问题。

完整参数以随包官方 CLI 的 `--help` 为准。固定版本参考：[CLI 命令](https://github.com/alibaba/open-code-review/blob/d4f568f71d3a9d5c5ec972791b1509e40cd31ad1/pages/src/content/docs/en/cli-reference.md)、[委托模式](https://github.com/alibaba/open-code-review/blob/d4f568f71d3a9d5c5ec972791b1509e40cd31ad1/pages/src/content/docs/en/integrations/delegate.md)、[模型配置](https://github.com/alibaba/open-code-review/blob/d4f568f71d3a9d5c5ec972791b1509e40cd31ad1/pages/src/content/docs/en/configuration.md)。
