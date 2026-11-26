// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 listky and dsh-ali-open-code-review Contributors

import { isAbsolute, resolve } from 'node:path';
import {
  approveEscalation,
  classifyRunnerFailure,
  isRunnerSpawnFailure,
  matchesSignature,
  SandboxUnavailableError,
  validateEscalationArgs,
} from '@deepseek-ai/dsh-sandbox';
import { prAdapter, prScript, resolveOcr, validateArgv, validateExecutable } from './ocr.js';

export const MAX_TIMEOUT_MS = 2_147_483_647;
export const defaults = Object.freeze({
  timeoutMs: 3_600_000,
  maxOutputBytes: 262_144,
  maxSpillBytes: 67_108_864,
  graceMs: 5_000,
  forwardEnv: [],
  pythonExecutable: process.platform === 'win32' ? 'python' : 'python3',
  skills: true,
});

function positiveInteger(value, name, max = MAX_TIMEOUT_MS) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) {
    throw new TypeError(`${name} must be an integer between 1 and ${max}`);
  }
}

export function normalizeConfig(input = {}) {
  const config = { ...defaults, ...input };
  for (const name of ['timeoutMs', 'maxOutputBytes', 'maxSpillBytes', 'graceMs']) {
    positiveInteger(config[name], name);
  }
  if (config.maxSpillBytes < config.maxOutputBytes) {
    throw new TypeError('maxSpillBytes must be at least maxOutputBytes');
  }
  if (!Array.isArray(config.forwardEnv) || config.forwardEnv.some(name => !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name))) {
    throw new TypeError('forwardEnv must contain environment variable names');
  }
  if (typeof config.skills !== 'boolean') throw new TypeError('skills must be a boolean');
  if (config.executable !== undefined) validateExecutable(config.executable);
  validateExecutable(config.pythonExecutable);
  return config;
}

export function forwardedEnvironment(names, ambient = process.env) {
  const env = {};
  for (const name of names) {
    if (ambient[name] !== undefined) env[name] = ambient[name];
  }
  return env;
}

function captured(reader) {
  if (reader === undefined) throw new Error('The subprocess provider did not collect the requested output stream');
  const read = reader.readFrom(0);
  return {
    text: read.text,
    truncated: read.lossy,
    complete: !read.lossy || read.spillPath !== undefined,
    ...(read.spillPath !== undefined ? { spillPath: read.spillPath } : {}),
  };
}

/** Own each complete invocation, including preparation and process teardown. */
export class OcrRunner {
  constructor(ctx, config = {}) {
    this.ctx = ctx;
    this.config = normalizeConfig(config);
    this.active = new Set();
    this.closed = false;
  }

  async run(params, exec, kind = 'ocr') {
    if (this.closed) throw new Error('The Open Code Review plugin has been unloaded');
    validateArgv(params.args);
    if (!['ocr', 'pr'].includes(kind)) throw new TypeError('Unknown OCR invocation kind');
    const timeoutMs = params.timeoutMs ?? this.config.timeoutMs;
    positiveInteger(timeoutMs, 'timeoutMs');
    validateEscalationArgs(params.sandbox_permissions, params.justification);
    exec.signal.throwIfAborted();

    const controller = new AbortController();
    const signal = AbortSignal.any([exec.signal, controller.signal]);
    let settle;
    const job = { controller, handle: undefined, settled: new Promise(resolveSettled => { settle = resolveSettled; }) };
    this.active.add(job);
    const started = Date.now();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error(`OCR exceeded its ${timeoutMs} ms invocation deadline`));
    }, timeoutMs);
    let confined;
    let cwd;
    let policy;
    try {
      const policyRequest = exec.agent === undefined ? {} : { session: exec.agent.session };
      policy = this.ctx.sandboxPolicy.resolve(policyRequest);
      if (params.sandbox_permissions !== undefined) {
        const mode = await approveEscalation({
          requestedMode: params.sandbox_permissions,
          justification: params.justification,
          effectiveMode: policy.mode,
          subject: 'OCR command',
        }, {
          approver: this.ctx.get('approval'),
          agent: exec.agent,
          callId: exec.callId,
          toolName: exec.name,
          signal,
        });
        policy = { ...policy, mode };
      }
      if (!['read-only', 'workspace-write', 'danger-full-access'].includes(policy.mode)) {
        throw new Error(`Unsupported DSH sandbox mode: ${policy.mode}`);
      }
      const sessionCwd = exec.agent?.session.header.cwd ?? policy.workspaceRoot;
      if (!isAbsolute(sessionCwd)) throw new Error('The calling DSH workspace must have an absolute cwd');
      if (params.cwd !== undefined && (typeof params.cwd !== 'string' || params.cwd.length === 0 || params.cwd.includes('\0'))) {
        throw new TypeError('cwd must be a non-empty directory path');
      }
      // Changing the process cwd never widens the session's writable boundary.
      cwd = params.cwd === undefined ? sessionCwd : resolve(sessionCwd, params.cwd);
      const env = forwardedEnvironment(this.config.forwardEnv);
      const configuredOcr = this.config.executable ?? resolveOcr().executable;
      const executable = await this.ctx.subprocess.resolveExecutable(configuredOcr, env, signal);
      validateExecutable(executable);
      let argv = [executable, ...params.args];
      if (kind === 'pr') {
        const python = await this.ctx.subprocess.resolveExecutable(this.config.pythonExecutable, env, signal);
        validateExecutable(python);
        argv = [python, prAdapter, prScript, executable, ...params.args];
      }
      signal.throwIfAborted();
      if (policy.mode !== 'danger-full-access') {
        confined = await this.ctx.sandbox.confine(argv, policy, signal);
        argv = confined.argv;
      }
      signal.throwIfAborted();
      const collect = { maxBytes: this.config.maxOutputBytes, spill: { maxBytes: this.config.maxSpillBytes } };
      job.handle = this.ctx.subprocess.spawn({
        argv,
        cwd,
        stdio: { stdin: 'ignore', stdout: collect, stderr: collect },
        graceMs: this.config.graceMs,
        signal,
        env,
      });
      const outcome = await job.handle.done;
      // A direct process exit does not prove that its descendants have stopped.
      if (await job.handle.waitForExit() !== true) {
        throw new Error('The subprocess provider could not confirm that the OCR process range exited');
      }
      const stdout = captured(job.handle.collected.stdout);
      const stderr = captured(job.handle.collected.stderr);
      if (confined !== undefined) {
        const failure = classifyRunnerFailure(outcome.exitCode, stderr.text, confined.runnerFailureRules);
        if (failure !== undefined) throw new SandboxUnavailableError(policy.mode, failure.detail);
      }
      const denied = confined !== undefined && matchesSignature(outcome.exitCode, stderr.text, confined.denialSignatures);
      const aborted = exec.signal.aborted || (controller.signal.aborted && !timedOut);
      return {
        kind,
        ok: outcome.exitCode === 0 && !timedOut && !aborted && !denied,
        args: [...params.args],
        cwd,
        exitCode: outcome.exitCode,
        signal: outcome.signal,
        timedOut,
        aborted,
        durationMs: Date.now() - started,
        stdout,
        stderr,
        sandbox: {
          mode: policy.mode,
          denied,
          ...(confined !== undefined ? { enforcement: confined.enforcement } : {}),
        },
      };
    } catch (error) {
      if (job.handle !== undefined) {
        job.handle.terminate();
        const teardown = await Promise.allSettled([job.handle.done, job.handle.waitForExit()]);
        const wait = teardown[1];
        if (wait.status === 'rejected') throw new AggregateError([error, wait.reason], 'OCR failed and process teardown could not be observed');
      }
      if (!signal.aborted && confined !== undefined && isRunnerSpawnFailure(error, confined.argv[0], cwd)) {
        throw new SandboxUnavailableError(policy.mode, String(error));
      }
      throw error;
    } finally {
      clearTimeout(timer);
      this.active.delete(job);
      settle();
    }
  }

  async dispose() {
    this.closed = true;
    const jobs = [...this.active];
    for (const job of jobs) {
      job.controller.abort(new Error('The Open Code Review plugin was unloaded'));
      job.handle?.terminate();
    }
    await Promise.all(jobs.map(job => job.settled));
  }
}
