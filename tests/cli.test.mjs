// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 listky and dsh-ali-open-code-review Contributors

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { packageRoot, prAdapter, prScript, resolveOcr } from '../src/ocr.js';

const { executable } = resolveOcr();
function command(program, args, cwd = packageRoot) {
  const result = spawnSync(program, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 30_000, env: { ...process.env, OCR_NO_UPDATE: '1' } });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  return result.stdout;
}

test('official CLI and terminal wrapper expose the pinned version and all command groups', () => {
  assert.match(command(executable, ['version']), /1\.14\.4/u);
  assert.match(command(process.execPath, [join(packageRoot, 'bin', 'dsh-ocr.js'), 'version']), /1\.14\.4/u);
  const help = command(executable, ['--help']);
  for (const name of ['review', 'scan', 'delegate', 'session', 'config', 'auth', 'llm', 'rules', 'viewer', 'completion', 'version']) {
    assert.match(help, new RegExp(`\\b${name}\\b`, 'u'));
  }
  assert.match(command(executable, ['review', '--help']), /--analysis/u);
  assert.match(command(executable, ['scan', '--help']), /--resume/u);
});

test('real upstream delegate selection, rules, and review preview work without model credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ali-real-cli-'));
  try {
    command('git', ['init', '-q'], root);
    command('git', ['config', 'user.name', 'OCR Test'], root);
    command('git', ['config', 'user.email', 'ocr-test@example.invalid'], root);
    const path = join(root, 'sample.js');
    await writeFile(path, 'export function value() { return 1; }\n');
    command('git', ['add', 'sample.js'], root);
    command('git', ['-c', 'core.hooksPath=', 'commit', '-qm', 'fixture'], root);
    await writeFile(path, 'export function value() { return 2; }\n');
    const preview = JSON.parse(command(executable, ['delegate', 'preview', '--format', 'json'], root));
    assert.ok(preview.schema_version);
    assert.equal(preview.mode, 'workspace');
    assert.ok(preview.reviewable_files.some(file => file.path === 'sample.js'));
    const rules = JSON.parse(command(executable, ['delegate', 'rule', '--format', 'json', 'sample.js'], root));
    assert.ok(rules.schema_version);
    assert.ok(JSON.stringify(rules).includes('sample.js'));
    assert.match(command(executable, ['review', '--preview'], root), /sample\.js/u);
  } finally {
    assert.ok(root.startsWith(join(tmpdir(), 'dsh-ali-real-cli-')), 'cleanup stays in its named temporary fixture directory');
    await rm(root, { recursive: true, force: true });
  }
});

test('Python adapter keeps the upstream PR-helper interface without a global ocr command', context => {
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const probe = spawnSync(python, ['--version'], { encoding: 'utf8', windowsHide: true });
  if (probe.status !== 0) return context.skip('Python 3 is an optional prerequisite for PR mode');
  const help = command(python, [prAdapter, prScript, executable, '--help']);
  for (const option of ['--cleanup', '--repo', '--background']) assert.ok(help.includes(option));
});

test('PR binding preserves arguments and keeps POSIX OCR children in the managed group', async context => {
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const probe = spawnSync(python, ['--version'], { encoding: 'utf8', windowsHide: true });
  if (probe.status !== 0) return context.skip('Python 3 is an optional prerequisite for PR mode');
  const root = await mkdtemp(join(tmpdir(), 'dsh-ali-pr-binding-'));
  try {
    const script = join(root, 'fixture_helper.py');
    await writeFile(script, [
      'import json, os, subprocess, sys',
      'code = "import json, os, sys; print(json.dumps({\\\"args\\\": sys.argv[1:], \\\"group\\\": os.getpgrp() if os.name == \\\"posix\\\" else None}))"',
      'child = subprocess.Popen(["ocr", "-c", code, *sys.argv[1:]], stdout=subprocess.PIPE, text=True, start_new_session=os.name == "posix")',
      'stdout, _ = child.communicate()',
      'assert child.returncode == 0',
      'print(json.dumps({"parent_group": os.getpgrp() if os.name == "posix" else None, "child": json.loads(stdout)}))',
    ].join('\n') + '\n');
    const pythonPath = command(python, ['-c', 'import sys; print(sys.executable)']).trim();
    const args = ['spaces 中文', '$(echo untrusted); `literal` "quote"'];
    const output = JSON.parse(command(python, [prAdapter, script, pythonPath, ...args]));
    assert.deepEqual(output.child.args, args);
    if (process.platform !== 'win32') assert.equal(output.child.group, output.parent_group);
  } finally {
    assert.ok(root.startsWith(join(tmpdir(), 'dsh-ali-pr-binding-')), 'cleanup stays in its named temporary fixture directory');
    await rm(root, { recursive: true, force: true });
  }
});

test('vendored resources remain exact upstream bytes', async () => {
  const { createHash } = await import('node:crypto');
  const manifest = JSON.parse(await readFile(join(packageRoot, 'vendor', 'open-code-review', 'UPSTREAM.json'), 'utf8'));
  for (const entry of manifest.files) {
    const bytes = await readFile(join(packageRoot, 'vendor', 'open-code-review', entry.path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, entry.path);
  }
});
