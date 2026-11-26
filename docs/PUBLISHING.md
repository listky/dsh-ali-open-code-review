# 开源、npm 发布与商店收录

本插件使用 Apache-2.0，并明确基于 [alibaba/open-code-review](https://github.com/alibaba/open-code-review) 为 DeepSeek Harness 开发。源码已公开于 [listky/dsh-ali-open-code-review](https://github.com/listky/dsh-ali-open-code-review)，通过 GitHub Release 提供 `.tgz` 分发。npm 发布与商店收录各有独立操作，商店收录以目录 PR 合并为准。

## 准备公开仓库

1. 核对公开仓库 `listky/dsh-ali-open-code-review`，对应 URL 为 `https://github.com/listky/dsh-ali-open-code-review`。
2. 将代码、`LICENSE`、`NOTICE`、上游版本记录和 README 提交到该仓库。README 开头必须保留本插件与上游的关系和功能复用说明。
3. 核对 `package.json` 的 `repository.url`、`homepage` 与 `bugs.url` 指向该仓库，包名为 `dsh-ali-open-code-review`，与 `cordis.patch.yml` 一致。
4. 保持仓库为 public，保留 [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic。

发布前再次确认 `dsh-ali-open-code-review` 的 npm 名称可用性及当前账号的发布权限。

## 验证分发包

```sh
npm ci
npm run check
npm test
npm pack --dry-run
npm pack
```

检查 tarball 包含可执行入口、`cordis.patch.yml`、本地化与图标、上游技能资源、`LICENSE` 和 `NOTICE`。包应声明：

```json
{"dsh":{"bundle":{"patch":"./cordis.patch.yml"}}}
```

该项目直接分发 ESM JavaScript，无需用户运行插件自身的 build 或 `prepare`。DSH 的 pnpm 严格脚本策略可能因官方 OCR 依赖的 `postinstall` 报 `ERR_PNPM_IGNORED_BUILDS`；安装使用 `--ignore-scripts`，并保留 optional dependencies。官方平台包已经携带二进制，插件在运行前检查它是否存在。

在一个验证用 profile 安装生成的 `.tgz`，检查配置层，并实际加载插件：

```sh
dsh plugin --profile ocr-package-check add --ignore-scripts ./dsh-ali-open-code-review-0.1.0.tgz
dsh --profile ocr-package-check --dump-config
```

确认两个技能与工具出现，执行 `review --preview`、`delegate preview --format json` 等无需模型 key 的调用。配置有效 OCR provider 后再验证原生审查。验证用 profile 可与日常 profile 分开。

先前安装失败的 profile 可能已经写入依赖但没有加入 bundle；使用新 profile 验证，或先移除 `dsh-ali-open-code-review`，再用 `add --ignore-scripts` 安装。optional 平台包缺失时，恢复 optional dependencies 或自行安装官方 OCR 并配置原生 `executable`，不要把二进制缺失当成成功。

## 发布到 npm

GitHub 账号与 npm 账号分别认证。`npm whoami` 返回未登录或 `ENEEDAUTH` 时，先在本机终端完成：

```sh
npm login
npm whoami
```

也可为公开仓库配置 npm trusted publishing。使用有权发布该包名的账号并按 npm 当前要求启用认证。凭据与一次性验证码在本机处理。完成检查后发布已确认内容：

```sh
npm publish --access public
```

记录发布版本与 Git commit；在 GitHub 创建同版本 tag / Release，并可附上经检查的 `.tgz`。从 npm 或 GitHub Release 安装相同版本时，使用同一个固定 OCR 依赖和技能快照。

发布后用户可运行：

```sh
dsh plugin --profile code-review add --ignore-scripts dsh-ali-open-code-review
```

GitHub 分发也可用于商店收录，无需先完成 npm 发布。固定版本 tarball 的安装方式为：

```sh
dsh plugin --profile code-review add --ignore-scripts https://github.com/listky/dsh-ali-open-code-review/releases/download/v0.1.0/dsh-ali-open-code-review-0.1.0.tgz
```

公开 GitHub 仓库可提供直接源码安装：

```sh
dsh plugin --profile code-review add --ignore-scripts github:listky/dsh-ali-open-code-review
```

## 提交社区插件商店

[awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 是社区插件目录；dshmarket 等店面读取该目录。请先阅读其当前 [贡献指南](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/CONTRIBUTING.md)。以下要求于 2026-11-26 核对：

- 公开 GitHub 仓库创建至少 **1 天**，包含可用代码与 `dsh.bundle`。
- 添加 `dsh-plugin` topic，保持维护。
- 提交描述与实际功能一致的插件条目。CI 通过后仍需维护者审核。

生成对应本仓库的收录条目：

```sh
npm run marketplace -- --repository https://github.com/listky/dsh-ali-open-code-review
```

脚本写入 `release/listky__dsh-ali-open-code-review.yml`，只生成本地文件。Fork 目录仓库，将该文件放到 `data/plugins/listky__dsh-ali-open-code-review.yml`，内容如下：

```yaml
url: https://github.com/listky/dsh-ali-open-code-review
name: listky/dsh-ali-open-code-review
category: git
tarball: https://github.com/listky/dsh-ali-open-code-review/releases/download/v0.1.0/dsh-ali-open-code-review-0.1.0.tgz
description:
  en: 'Reuses Alibaba Open Code Review in DeepSeek Harness for native and host-model reviews, scanning, rules, sessions, and reports.'
  zh: '针对 Alibaba Open Code Review 开发的 DeepSeek Harness 插件，复用原生与宿主模型审查、扫描、规则、会话和报告。'
```

按贡献指南提交目录 PR，保持这个文件为唯一必需的新增内容。商店仓库的两个 README 由条目生成，无需手工编辑。英文描述必须非空且单行，按约定以句号结尾；包含 `: ` 的内容要加引号。中文可提供，分类 `git` 适用于此插件。

可选字段：

- `icon`：GitHub 托管的 PNG / JPEG / WebP 位图；商店不接受 SVG。未提供时店面使用仓库所有者头像。本插件的 SVG 图标可用于 dsh 包元数据。
- `tarball`：GitHub Release 上的 `.tgz` 地址，适用于无法从源码安装的包；本插件的纯 JavaScript 源码可直接安装。
- 截图：在自己的仓库根目录添加 `screenshots.json`，引用实际存在的图片。截图应展示已运行的插件。

需要本地检查目录条目时，在商店仓库运行其 `npm ci` 与 `node scripts/generate-readme.mjs`。只将所需条目提交到 PR；收录完成后核对生成的目录与店面展示。

仓库创建满一天是目录 CI 的要求。未满一天时可先创建 **draft PR**，明确说明等待仓库年龄门槛、不请求审核，并保持年龄要求的 checkbox 未勾选。draft 仍会触发 CI，不能豁免年龄检查。满一天后再切换为 ready，等待检查重跑与维护者审核；满足年龄要求不表示立即上架。draft 与待审 PR 都是收录申请，商店上架完成以维护者合并目录 PR 为准。上游或商店规范变更时，以对应项目的当前规则为准。
