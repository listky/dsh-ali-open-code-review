// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 listky and dsh-ali-open-code-review Contributors

import assert from 'node:assert/strict';
import test from 'node:test';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { OcrRunner, forwardedEnvironment } from '../src/runner.js';
import { renderResult } from '../src/index.js';

const workspace = resolve(tmpdir());
const execution = signal => ({ signal, callId: 'fixture-call', name: 'open_code_review', agent: { session: { id: 'fixture-session', header: { cwd: workspace } } } });

function fixture({ mode = 'workspace-write', stdout = {}, stderr = {}, outcome = { exitCode: 0, signal: null }, manual = false, confineError, spawnError, approval } = {}) {
  const events = [];
  let finish;
  const done = new Promise(resolveDone => { finish = resolveDone; });
  const reader = patch => ({ readFrom: () => ({ text: '', nextOffset: 0, lossy: false, ...patch }) });
  let spawnSpec;
  const handle = {
    done,
    collected: { stdout: reader(stdout), stderr: reader(stderr) },
    terminate() { events.push('terminate'); finish({ exitCode: null, signal: 'SIGTERM' }); },
    async waitForExit() { events.push('join'); await done; return true; },
  };
  const ctx = {
    get: name => name === 'approval' ? approval : undefined,
    sandboxPolicy: { resolve: () => ({ mode, workspaceRoot: workspace, sessionId: 'fixture-session' }) },
    sandbox: {
      async confine(argv, policy, signal) {
        events.push({ confine: [...argv], policy });
        signal.throwIfAborted();
        if (confineError) throw confineError;
        return { argv: ['runner', '--', ...argv], enforcement: 'full', denialSignatures: ['permission denied'], runnerFailureRules: [{ fatalSignatures: ['sandbox runner broken'] }] };
      },
    },
    subprocess: {
      async resolveExecutable(command, _env, signal) { signal.throwIfAborted(); return command; },
      spawn(spec) {
        events.push('spawn');
        spawnSpec = spec;
        if (spawnError) throw spawnError;
        spec.signal.addEventListener('abort', () => handle.terminate(), { once: true });
        if (!manual) queueMicrotask(() => finish(outcome));
        return handle;
      },
    },
  };
  return { runner: new OcrRunner(ctx, { executable: process.execPath }), events, handle, spec: () => spawnSpec };
}

test('argv cannot inject shell code and a cwd override preserves the sandbox boundary', async () => {
  const { runner, events, spec } = fixture();
  const args = ['review', '--background', 'quotes " ; $(Get-Content secrets) `echo`\n中文', '--output', 'report with spaces.json'];
  const result = await runner.run({ args, cwd: 'repo with spaces' }, execution(new AbortController().signal));
  assert.deepEqual(spec().argv, ['runner', '--', process.execPath, ...args]);
  assert.equal(spec().cwd, join(workspace, 'repo with spaces'));
  assert.equal(events[0].policy.workspaceRoot, workspace);
  assert.equal(result.ok, true);
  assert.equal(spec().stdio.stdin, 'ignore');
  assert.ok(events.includes('join'));
  await runner.dispose();
});

test('confinement failure never starts an unconfined child', async () => {
  const error = new Error('sandbox unavailable');
  const { runner, events } = fixture({ confineError: error });
  await assert.rejects(runner.run({ args: ['review'] }, execution(new AbortController().signal)), error);
  assert.ok(!events.includes('spawn'));
  await runner.dispose();
});

test('nonzero OCR exit is reported with its original stdout and stderr', async () => {
  const { runner } = fixture({ outcome: { exitCode: 7, signal: null }, stdout: { text: 'partial original report' }, stderr: { text: 'model connection failed' } });
  const result = await runner.run({ args: ['scan'] }, execution(new AbortController().signal));
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 7);
  assert.equal(result.stdout.text, 'partial original report');
  assert.equal(result.stderr.text, 'model connection failed');
  assert.match(renderResult({}, result)[0].text, /failed.*exitCode=7/u);
  await runner.dispose();
});

test('truncated output identifies whether the full stream can be recovered', async () => {
  for (const spillPath of [undefined, join(workspace, 'full-report.log')]) {
    const { runner } = fixture({ stdout: { text: 'tail', lossy: true, ...(spillPath ? { spillPath } : {}) } });
    const result = await runner.run({ args: ['session', 'show', 'id'] }, execution(new AbortController().signal));
    assert.equal(result.stdout.truncated, true);
    assert.equal(result.stdout.complete, spillPath !== undefined);
    assert.match(renderResult({}, result)[0].text, spillPath ? /COMPLETE stream/u : /complete stream is unavailable/u);
    await runner.dispose();
  }
});

test('deadline terminates and joins the entire process range before returning', async () => {
  const { runner, events } = fixture({ manual: true });
  const result = await runner.run({ args: ['review'], timeoutMs: 20 }, execution(new AbortController().signal));
  assert.equal(result.timedOut, true);
  assert.equal(result.aborted, false);
  assert.equal(result.ok, false);
  assert.deepEqual(events.filter(event => typeof event === 'string'), ['spawn', 'terminate', 'join']);
  await runner.dispose();
});

test('caller cancellation is distinguished from a deadline and awaits range exit', async () => {
  const { runner, events } = fixture({ manual: true });
  const controller = new AbortController();
  const pending = runner.run({ args: ['scan'] }, execution(controller.signal));
  await new Promise(resolveReady => setImmediate(resolveReady));
  controller.abort();
  const result = await pending;
  assert.equal(result.aborted, true);
  assert.equal(result.timedOut, false);
  assert.equal(result.ok, false);
  assert.ok(events.includes('terminate') && events.includes('join'));
  await runner.dispose();
});

test('sandbox runner diagnostics are reported as unavailable rather than OCR success', async () => {
  const { runner } = fixture({ outcome: { exitCode: 1, signal: null }, stderr: { text: 'sandbox runner broken' } });
  await assert.rejects(runner.run({ args: ['review'] }, execution(new AbortController().signal)), error => error.code === 'SANDBOX_UNAVAILABLE');
  await runner.dispose();
});

test('a wider mode requires a human grant before spawn', async () => {
  const { runner, events } = fixture({ approval: { async request() { events.push('approval'); return 'rejected'; } } });
  await assert.rejects(runner.run({ args: ['review'], sandbox_permissions: 'danger-full-access', justification: 'OCR needs its configured session storage' }, execution(new AbortController().signal)), /rejected/u);
  assert.deepEqual(events, ['approval']);
  await runner.dispose();
});

test('only explicitly selected credential names are forwarded', () => {
  const ambient = { DEEPSEEK_API_KEY: 'fixture', GITHUB_TOKEN: 'private', DSH_HOME: '/user/dsh' };
  assert.deepEqual(forwardedEnvironment([], ambient), {});
  assert.deepEqual(forwardedEnvironment(['DEEPSEEK_API_KEY'], ambient), { DEEPSEEK_API_KEY: 'fixture' });
  assert.deepEqual(forwardedEnvironment(['NOT_DEFINED'], ambient), {});
});

test('invalid argv and deadlines cannot start a child', async () => {
  for (const params of [{ args: ['review', 'bad\0arg'] }, { args: 'review' }, { args: ['review'], timeoutMs: 0 }, { args: ['review'], timeoutMs: 2 ** 32 }]) {
    const { runner, events } = fixture();
    await assert.rejects(runner.run(params, execution(new AbortController().signal)));
    assert.equal(events.length, 0);
    await runner.dispose();
  }
});
