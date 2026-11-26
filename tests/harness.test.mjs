// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 dsh-ali-open-code-review Contributors

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Context, Service } from "@deepseek-ai/cordis";
import ToolsService, { validateJsonSchemaValue } from "@deepseek-ai/dsh-tools";
import SkillRegistry, { renderSkillContent } from "@deepseek-ai/dsh-skill";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import * as OpenCodeReview from "../src/index.js";

const vendorRoot = fileURLToPath(new URL("../vendor/open-code-review/", import.meta.url));
const toolNames = ["open_code_review", "open_code_review_pr"];
const skillNames = ["open-code-review", "open-code-review-delegate"];

/** Managed-process fixture implementing the public DSH subprocess methods. */
class FixtureSubprocess extends Service {
  constructor(ctx, config) {
    super(ctx, "subprocess");
    this.observed = config.observed;
    this.manual = config.manual;
  }

  async resolveExecutable(command, _env, signal) {
    signal?.throwIfAborted();
    this.observed.resolved.push(command);
    return isAbsolute(command) ? command : process.execPath;
  }

  async terminalEnvironment(signal) {
    signal?.throwIfAborted();
    return { platform: process.platform === "win32" ? "windows" : "posix" };
  }

  spawn(spec) {
    spec.signal?.throwIfAborted();
    this.observed.spawns.push(spec);
    let settle;
    let finished = false;
    const done = new Promise((resolve) => { settle = resolve; });
    const finish = (outcome) => {
      if (finished) return;
      finished = true;
      spec.signal?.removeEventListener("abort", abort);
      settle(outcome);
    };
    const handle = {
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      control: undefined,
      collected: {
        stdout: {
          readFrom: () => ({ text: "upstream review output\n", nextOffset: 23, lossy: false }),
        },
        stderr: {
          readFrom: () => ({ text: "", nextOffset: 0, lossy: false }),
        },
      },
      done,
      terminate: () => {
        this.observed.lifecycle.push("terminate");
        finish({ exitCode: null, signal: "SIGTERM" });
      },
      waitForExit: async (signal) => {
        this.observed.lifecycle.push("waitForExit");
        if (signal?.aborted) return false;
        await done;
        return true;
      },
    };
    const abort = () => handle.terminate();
    spec.signal?.addEventListener("abort", abort, { once: true });
    this.observed.handles.push(handle);
    this.observed.onSpawn();
    if (!this.manual) queueMicrotask(() => finish({ exitCode: 0, signal: null }));
    return handle;
  }
}

/** Confinement fixture records the exact argv and preserves the returned wrapper. */
class FixtureSandbox extends Service {
  constructor(ctx, config) {
    super(ctx, "sandbox");
    this.observed = config.observed;
  }

  async confine(argv, policy, signal) {
    signal?.throwIfAborted();
    this.observed.confinements.push({ argv: [...argv], policy });
    return {
      argv: ["fixture-sandbox-runner", "--", ...argv],
      enforcement: "full",
      denialSignatures: ["fixture file access denied"],
      runnerFailureRules: [],
    };
  }
}

class FixtureSandboxPolicy extends Service {
  constructor(ctx, config) {
    super(ctx, "sandboxPolicy");
    this.observed = config.observed;
    this.workspaceRoot = config.workspaceRoot;
    this.defaultMode = config.mode;
  }

  resolve(request = {}) {
    this.observed.policies.push(request);
    return {
      mode: request.mode ?? this.defaultMode,
      workspaceRoot: request.session?.header.cwd ?? this.workspaceRoot,
      ...(request.session === undefined ? {} : { sessionId: request.session.id }),
    };
  }
}

async function fixture({ manual = false, mode = "workspace-write", config = {} } = {}) {
  const root = await mkdtemp(join(tmpdir(), "dsh-ali-harness-"));
  const workspace = join(root, "repo with spaces 中文");
  await mkdir(workspace);
  let onSpawn;
  const spawned = new Promise((resolve) => { onSpawn = resolve; });
  const observed = {
    resolved: [], spawns: [], handles: [], confinements: [], policies: [], lifecycle: [], onSpawn,
  };
  const ctx = new Context();
  try {
    await ctx.plugin(SystemPrompt);
    await ctx.plugin(ToolsService);
    await ctx.plugin(SkillRegistry);
    await ctx.plugin(FixtureSubprocess, { observed, manual });
    await ctx.plugin(FixtureSandbox, { observed });
    await ctx.plugin(FixtureSandboxPolicy, { observed, workspaceRoot: workspace, mode });
    const fiber = await ctx.plugin(OpenCodeReview, config);
    return {
      ctx, fiber, workspace, observed, spawned,
      async dispose() {
        await ctx.fiber.dispose();
        await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await ctx.fiber.dispose();
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

function tool(ctx, name) {
  const definition = ctx.tools.definitions().find((entry) => entry.name === name);
  assert.ok(definition, `${name} is registered in the real DSH tool registry`);
  return definition;
}

function execution(workspace, signal = new AbortController().signal) {
  return {
    agent: { session: { id: "harness-fixture-session", header: { cwd: workspace } } },
    callId: "harness-fixture-call",
    rootCallId: "harness-fixture-call",
    token: Symbol("harness-fixture"),
    name: "open_code_review",
    arguments: {},
    signal,
    deferContext() {},
    concludeTurn() {},
  };
}

test("the real DSH registries expose both tools and unchanged upstream skill bodies", { timeout: 10_000 }, async () => {
  const host = await fixture();
  try {
    assert.deepEqual(host.ctx.tools.schemas().map((entry) => entry.name).sort(), toolNames);
    const catalog = await host.ctx.skills.list();
    assert.deepEqual(catalog.map((entry) => entry.name).sort(), skillNames);
    for (const name of skillNames) {
      const loaded = await host.ctx.skills.get(name);
      assert.ok(loaded);
      assert.deepEqual(loaded.invocation, { modelInvocable: true, userInvocable: true });
      assert.equal(loaded.metadata.author, "alibaba");
      assert.equal(loaded.metadata.license, "Apache-2.0");
      const directory = join(vendorRoot, "skills", name);
      assert.deepEqual(loaded.resourceBase, { kind: "directory", path: directory });
      assert.equal(isAbsolute(loaded.resourceBase.path), true);
      const raw = await readFile(join(directory, "SKILL.md"), "utf8");
      const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, "").trim();
      assert.ok(loaded.content.includes(body), `${name} retains the complete upstream instructions`);
      assert.match(loaded.content, /open_code_review/u);
      assert.match(loaded.content, /DeepSeek Harness|\bDSH\b|\bdsh\b/u);
      const rendered = renderSkillContent(loaded);
      assert.ok(rendered.includes(directory), "the actual DSH renderer advertises packaged resources");
    }
    await host.fiber.dispose();
    assert.deepEqual(host.ctx.tools.definitions(), []);
    assert.deepEqual(await host.ctx.skills.list(), []);
  } finally {
    await host.dispose();
  }
});

test("a tool preserves argument boundaries and the caller's workspace through confinement", { timeout: 10_000 }, async () => {
  const host = await fixture();
  try {
    const args = ["scan", "--path", "src with spaces; $HOME & 中文", "--format", "json"];
    const definition = tool(host.ctx, "open_code_review");
    const value = await definition.execute({ args }, execution(host.workspace));
    assert.deepEqual(validateJsonSchemaValue(definition.output.schema, value), []);
    const rendered = definition.output.render({ args }, value);
    assert.ok(rendered.some((entry) => entry.type === "text" && entry.text.includes("upstream review output")));
    assert.equal(host.observed.spawns.length, 1);
    assert.equal(host.observed.confinements.length, 1);
    const confinement = host.observed.confinements[0];
    assert.deepEqual(confinement.argv.slice(-args.length), args);
    assert.equal(confinement.policy.mode, "workspace-write");
    const spawn = host.observed.spawns[0];
    assert.deepEqual(spawn.argv, ["fixture-sandbox-runner", "--", ...confinement.argv]);
    assert.equal(spawn.cwd, host.workspace);
    assert.equal(spawn.stdio.stdin, "ignore");
    assert.ok(spawn.stdio.stdout.maxBytes > 0);
    assert.ok(spawn.stdio.stderr.maxBytes > 0);
    assert.ok(spawn.stdio.stdout.spill.maxBytes >= spawn.stdio.stdout.maxBytes);
  } finally {
    await host.dispose();
  }
});

test("the PR tool runs the packaged original helper and returns the declared canonical output", { timeout: 10_000 }, async () => {
  const host = await fixture();
  try {
    const args = ["https://github.com/alibaba/open-code-review/pull/42", "--background", "context with spaces 中文"];
    const definition = tool(host.ctx, "open_code_review_pr");
    const value = await definition.execute({ args }, {
      ...execution(host.workspace), name: "open_code_review_pr",
    });
    assert.deepEqual(validateJsonSchemaValue(definition.output.schema, value), []);
    assert.equal(value.kind, "pr");
    assert.equal(value.ok, true);
    assert.deepEqual(value.args, args);
    const argv = host.observed.confinements[0].argv;
    assert.equal(argv[0], process.execPath, "the configured Python executable is resolved before spawn");
    assert.equal(argv[1], fileURLToPath(new URL("../src/pr_adapter.py", import.meta.url)));
    assert.equal(argv[2], join(vendorRoot, "skills", "open-code-review", "scripts", "review_pr.py"));
    assert.equal(isAbsolute(argv[3]), true, "the adapter receives the resolved OCR binary");
    assert.deepEqual(argv.slice(4), args);
    assert.equal(host.observed.spawns[0].cwd, host.workspace);
    assert.ok(definition.output.render({ args }, value).some((entry) => entry.type === "text"));
  } finally {
    await host.dispose();
  }
});

test("skill registration can be disabled while both upstream command tools remain available", { timeout: 10_000 }, async () => {
  const host = await fixture({ config: { skills: false } });
  try {
    assert.deepEqual(await host.ctx.skills.list(), []);
    assert.deepEqual(host.ctx.tools.schemas().map((entry) => entry.name).sort(), toolNames);
  } finally {
    await host.dispose();
  }
});

test("danger-full-access uses the exact process argv without a confinement wrapper", { timeout: 10_000 }, async () => {
  const host = await fixture({ mode: "danger-full-access" });
  try {
    const args = ["--version"];
    await tool(host.ctx, "open_code_review").execute({ args }, execution(host.workspace));
    assert.deepEqual(host.observed.confinements, []);
    assert.deepEqual(host.observed.spawns[0].argv.slice(-args.length), args);
    assert.equal(host.observed.spawns[0].cwd, host.workspace);
  } finally {
    await host.dispose();
  }
});

test("unloading the plugin stops its running process and awaits managed-range exit", { timeout: 10_000 }, async () => {
  const host = await fixture({ manual: true });
  try {
    const running = tool(host.ctx, "open_code_review")
      .execute({ args: ["review", "--preview"] }, execution(host.workspace))
      .then((value) => ({ value }), (error) => ({ error }));
    await host.spawned;
    await host.fiber.dispose();
    await running;
    assert.ok(host.observed.lifecycle.includes("terminate"));
    assert.ok(host.observed.lifecycle.includes("waitForExit"));
    assert.ok(host.observed.lifecycle.indexOf("waitForExit") > host.observed.lifecycle.indexOf("terminate"));
    assert.deepEqual(host.ctx.tools.definitions(), []);
    assert.deepEqual(await host.ctx.skills.list(), []);
  } finally {
    await host.dispose();
  }
});
