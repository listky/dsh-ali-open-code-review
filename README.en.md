# Alibaba Open Code Review for DeepSeek Harness

English | [简体中文](README.md)

This is a community **DeepSeek Harness (dsh) plugin built specifically for [alibaba/open-code-review](https://github.com/alibaba/open-code-review)**. It directly reuses the official `@alibaba-group/open-code-review` CLI and bundles the upstream native and delegation skills with their resources.

The plugin is licensed under **Apache-2.0** and preserves upstream copyright and licensing. See [NOTICE](NOTICE), [LICENSE](LICENSE), and the [upstream version record](vendor/open-code-review/UPSTREAM.json).

## Capabilities

The `open_code_review` tool forwards the original CLI commands and arguments. This keeps workspace, branch, and commit reviews; behavior analysis; full-file scanning; rule resolution; session management and resume; text, JSON, SARIF, offline HTML, and the viewer; provider configuration and authentication; and OCR's MCP client and telemetry features. The `open_code_review_pr` tool uses the original GitHub PR snapshot workflow. See the [feature map](docs/FEATURES.md) for source references and upstream limits.

Two upstream skills are available:

| Skill | Reviewer and credentials |
| --- | --- |
| `/open-code-review` | OCR's specialized agent and full native pipeline, using a separately configured OCR provider. |
| `/open-code-review-delegate` | The current dsh model; OCR selects files and resolves rules, while the host agent reviews and positions findings. No separate OCR API key is required. |

The host model's authentication and usage charges still apply in delegation mode.

## Install

Requirements: DeepSeek Harness **0.2.2-rc.5 or a compatible version**, Node.js **22.x from 22.19, or 24 and later** (`^22.19.0 || >=24.0.0`), and Git **2.41+**. GitHub PR mode also requires Python 3 and an authenticated `gh` CLI.

From the plugin checkout:

```sh
npm ci
dsh plugin --profile code-review add --ignore-scripts .
dsh --profile code-review --dump-config
dsh --profile code-review
```

Replace `code-review` with your intended profile. Restart that profile after installing, updating, or removing the bundle. This plugin ships executable ESM JavaScript and needs no build or `prepare` script. `--ignore-scripts` skips the official OCR dependency's `postinstall`, avoiding DSH's strict dependency-script gate. The matching optional npm platform package already contains the native executable, which the plugin checks before running. Keep optional dependencies enabled; a missing binary produces an explicit error.

To install a tarball:

```sh
npm pack
dsh plugin --profile code-review add --ignore-scripts ./dsh-ali-open-code-review-0.1.0.tgz
```

After publication to npm:

```sh
dsh plugin --profile code-review add --ignore-scripts dsh-ali-open-code-review
```

After publishing the public repository, install directly from GitHub source:

```sh
dsh plugin --profile code-review add --ignore-scripts github:listky/dsh-ali-open-code-review
```

If an earlier install failed with `ERR_PNPM_IGNORED_BUILDS`, its profile may contain the dependency without the bundle. Use a fresh verification profile, or remove `dsh-ali-open-code-review` from that profile and install again with `add --ignore-scripts`; confirm the bundle in `--dump-config`. If optional dependencies were disabled, restore the official platform package or install OCR yourself and configure `executable` to its native binary. A Windows `.cmd` launcher is not a native executable.

## Use

Ask dsh through either skill:

```text
/open-code-review Review my workspace changes
/open-code-review Review the current branch against main and explain behavior changes
/open-code-review-delegate Review all workspace changes with the current model
```

The `open_code_review` tool takes individual CLI arguments as an array:

```json
{"args":["delegate","preview","--format","json"]}
```

```json
{"args":["review","--from","main","--analysis","--audience","agent","--format","json","--output","review.json"]}
```

The tool accepts `args`, optional `cwd`, and optional `timeoutMs`. Its default working directory is the current dsh session's project. `cwd` can be absolute or relative to that project and retains the session's writable boundary. `timeoutMs` limits the whole invocation, separately from OCR's per-group `--timeout`.

The result includes `kind` (`ocr` / `pr`), `ok`, `exitCode`, `timedOut`, `aborted`, `durationMs`, and separate `stdout` and `stderr` captures. For oversized output, check `complete` and read the complete `spillPath` when available before reporting findings. Use `--output` for native reports and preserve coverage gaps and the separate Review and Analysis outcomes.

The checkout also provides a terminal entry point for interactive configuration and all original CLI commands:

```sh
node ./bin/dsh-ocr.js config provider
node ./bin/dsh-ocr.js config model
node ./bin/dsh-ocr.js llm test
node ./bin/dsh-ocr.js scan --path src --audience agent --format json --output scan.json
node ./bin/dsh-ocr.js session list
node ./bin/dsh-ocr.js viewer
```

Native reviews use OCR's existing provider settings and credentials in `~/.opencodereview/config.json`. You can also pass `--provider deepseek --model <available-model-name>`. Use `config model` to select a model and `llm providers` to inspect built-in providers; the model must be available to your provider account.

The `open_code_review_pr` tool takes the original script arguments, including a PR URL, optional `--repo OWNER/REPO`, and `--background`. Its adapter binds the literal `ocr` subprocess to the official native executable and keeps OCR in DSH's managed process group on POSIX so cancellation can stop it; the upstream script remains unchanged. The workflow retains its snapshot and `run.json`; follow the skill's cleanup requirements.

## Configuration

To use environment credentials, set `DEEPSEEK_API_KEY` locally **before starting DSH**, then add this complete plugin row to the current profile's `cordis.patch.yml` (by default `~/.dsh/profiles/code-review/cordis.patch.yml`):

```yaml
- id: ali-open-code-review
  name: dsh-ali-open-code-review
  config:
    forwardEnv:
      - DEEPSEEK_API_KEY
```

`forwardEnv` defaults to an empty array. Only environment variable names explicitly selected in local configuration are forwarded to OCR tool processes. Credentials already saved in OCR configuration remain available. The patch replaces the row's complete `config`; include any other custom settings in the same object. Configure secrets locally; do not enter them in chat.

| Setting | Default | Purpose |
| --- | --- | --- |
| `executable` | Official npm platform binary | Optional native OCR absolute path or PATH name; `.cmd`, `.bat`, and `.ps1` are rejected. |
| `pythonExecutable` | `python` on Windows; `python3` elsewhere | Python 3 executable for the PR helper. |
| `timeoutMs` | `3600000` (one hour) | Whole invocation deadline in milliseconds. |
| `maxOutputBytes` | `262144` (256 KiB) | Display limit for each stdout / stderr stream. |
| `maxSpillBytes` | `67108864` (64 MiB) | Complete spill-file limit per stream; must be at least `maxOutputBytes`. |
| `graceMs` | `5000` | Process termination grace period in milliseconds. |
| `forwardEnv` | `[]` | Environment variable names explicitly selected locally. |
| `skills` | `true` | Register both upstream skills. |

Tool processes use the current session's sandbox policy. OCR configuration and session storage under `~/.opencodereview` may need writes outside a read-only or workspace-write boundary. Configure OCR in a local terminal, or use DSH's normal approval flow to retry the same call with `sandbox_permissions` and `justification` for one wider invocation. Denial or an unavailable backend is reported as a failure; the tool does not silently bypass confinement.

## Verify and publish

```sh
npm run check
npm test
npm pack --dry-run
```

The fixed upstream version is **v1.14.4**, commit `d4f568f71d3a9d5c5ec972791b1509e40cd31ad1`. Update the dependency and vendored skills together. See [CONTRIBUTING](CONTRIBUTING.md).

The package name is `dsh-ali-open-code-review`; its planned public repository is [listky/dsh-ali-open-code-review](https://github.com/listky/dsh-ali-open-code-review). Local packaging, npm publication, and marketplace acceptance are separate steps. See the [publishing guide](docs/PUBLISHING.md). The community storefront uses the [awesome-dsh-plugin catalog](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin); listing requires a public repository at least one day old, the `dsh-plugin` topic, and one YAML submission file.

## Attribution

[alibaba/open-code-review](https://github.com/alibaba/open-code-review) provides the review engine, rules, both skills, and the GitHub PR workflow. This project maintains the dsh bundle, tool registration, execution adapter, and publishing integration. The host plugin API is documented in [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
