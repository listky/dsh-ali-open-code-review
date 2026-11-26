// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 listky and dsh-ali-open-code-review Contributors

import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { escalationHintMarker, sandboxDenialMarker } from '@deepseek-ai/dsh-sandbox';
import { defaults, MAX_TIMEOUT_MS, OcrRunner } from './runner.js';
import { createSkillProvider } from './skills.js';

export const name = 'ali-open-code-review';
export const inject = ['tools', 'skills', 'subprocess', 'sandbox', 'sandboxPolicy'];

export const Config = z.object({
  executable: z.string().description('Optional native OCR executable path or PATH name. Defaults to the pinned official npm binary.'),
  pythonExecutable: z.string().default(defaults.pythonExecutable).description('Python 3 executable for the original GitHub PR helper.'),
  timeoutMs: z.number().min(1).max(MAX_TIMEOUT_MS).step(1).default(defaults.timeoutMs).description('Whole invocation deadline in milliseconds; separate from OCR per-group --timeout.'),
  maxOutputBytes: z.number().min(1).max(MAX_TIMEOUT_MS).step(1).default(defaults.maxOutputBytes).description('Maximum retained bytes per stdout/stderr stream.'),
  maxSpillBytes: z.number().min(1).max(MAX_TIMEOUT_MS).step(1).default(defaults.maxSpillBytes).description('Maximum complete spill-file bytes per stream.'),
  graceMs: z.number().min(1).max(MAX_TIMEOUT_MS).step(1).default(defaults.graceMs).description('Managed process termination grace period.'),
  forwardEnv: z.array(z.string()).default([]).description('Environment variable names explicitly forwarded to OCR; configure credential names locally.'),
  skills: z.boolean().default(true).description('Register both unmodified upstream skills with DSH execution guidance.'),
});

const streamSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    text: { type: 'string', required: true },
    truncated: { type: 'boolean', required: true },
    complete: { type: 'boolean', required: true },
    spillPath: { type: 'string' },
  },
};

export const resultSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['ocr', 'pr'], required: true },
    ok: { type: 'boolean', required: true },
    args: { type: 'array', items: { type: 'string' }, required: true },
    cwd: { type: 'string', required: true },
    exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
    signal: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
    timedOut: { type: 'boolean', required: true },
    aborted: { type: 'boolean', required: true },
    durationMs: { type: 'integer', required: true },
    stdout: { ...streamSchema, required: true },
    stderr: { ...streamSchema, required: true },
    sandbox: {
      type: 'object', additionalProperties: false, required: true,
      properties: {
        mode: { type: 'string', enum: ['read-only', 'workspace-write', 'danger-full-access'], required: true },
        denied: { type: 'boolean', required: true },
        enforcement: { type: 'string', enum: ['full', 'partial'] },
      },
    },
  },
};

export function renderResult(_args, value) {
  const lines = [
    `Open Code Review ${value.kind}: ${value.ok ? 'completed' : 'failed'} (exitCode=${value.exitCode}, signal=${value.signal}, timedOut=${value.timedOut}, aborted=${value.aborted})`,
    `cwd: ${value.cwd}`,
  ];
  for (const name of ['stdout', 'stderr']) {
    const stream = value[name];
    if (stream.text) lines.push(`\n${name}:\n${stream.text}`);
    if (stream.truncated) {
      lines.push(stream.complete
        ? `${name} is truncated here. Read the COMPLETE stream from ${stream.spillPath}.`
        : `${name} is truncated and its complete stream is unavailable. Report incomplete output; rerun with an upstream --output file or a larger configured spill limit.`);
    }
  }
  if (value.sandbox.denied) {
    lines.push(sandboxDenialMarker(value.sandbox.mode), escalationHintMarker('OCR command'));
  }
  return [{ type: 'text', text: lines.join('\n') }];
}

const parameters = {
  args: { type: 'array', items: { type: 'string' }, required: true, description: 'Exact upstream arguments, each as one string. No shell escaping. For open_code_review include the subcommand, e.g. ["review","--audience","agent","--from","main","--analysis","--format","json"].' },
  cwd: { type: 'string', description: 'Process working directory, absolute or relative to the current DSH session workspace. Defaults to that workspace.' },
  timeoutMs: { type: 'integer', description: 'Optional whole invocation deadline in milliseconds. Defaults to plugin configuration (one hour). OCR --timeout is a separate per-group setting.' },
  sandbox_permissions: { type: 'string', enum: ['workspace-write', 'danger-full-access'], description: 'For an exact retry after a sandbox denial, request the narrowest wider mode. Requires justification and human approval.' },
  justification: { type: 'string', description: 'Reason for the requested one-call sandbox escalation.' },
};

/** Register tools and skills in the caller's Cordis lifecycle. */
export function apply(ctx, config = {}) {
  const runner = new OcrRunner(ctx, config);
  const register = (toolName, kind, description) => ctx.effect(() => ctx.tools.register(defineTool({
    name: toolName,
    description,
    parameters,
    // The runner owns the configurable per-invocation deadline.
    timeoutMs: MAX_TIMEOUT_MS,
    output: { schema: resultSchema, render: renderResult },
    execute: (args, exec) => runner.run(args, exec, kind),
  })));

  ctx.effect(() => () => runner.dispose());
  register('open_code_review', 'ocr', 'Run the complete official Alibaba Open Code Review CLI with exact argv. Supports review, scan, delegate, rules, session, viewer, config, auth, llm, completion, version, and help without flag filtering. Native review uses OCR provider credentials; delegate preview/rule use no OCR model. Noninteractive: use the dsh-ocr terminal entry for interactive setup or the long-running viewer. Check ok/exitCode and preserve full output or spill files.');
  register('open_code_review_pr', 'pr', 'Run the original Alibaba native GitHub PR snapshot helper. args are the helper arguments (PR URL/number, optional --repo OWNER/REPO and --background; or --cleanup RUN_JSON after explicit consent; or --help). Reuses upstream exact revision checks, policies, artifacts and freshness. Requires Python 3 and authenticated gh. This is native mode and uses OCR provider configuration.');
  if (runner.config.skills) ctx.effect(() => ctx.skills.registerProvider(createSkillProvider));
}
