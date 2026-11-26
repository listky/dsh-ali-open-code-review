#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 listky and dsh-ali-open-code-review Contributors

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { parse } from 'yaml';
import { packageRoot, resolveOcr } from '../src/ocr.js';

const read = relative => readFile(join(packageRoot, relative));
const manifest = JSON.parse(await read('package.json'));
const upstream = JSON.parse(await read('vendor/open-code-review/UPSTREAM.json'));
assert.equal(manifest.name, 'dsh-ali-open-code-review');
assert.equal(manifest.license, 'Apache-2.0');
assert.equal(manifest.type, 'module');
assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
assert.equal(manifest.dependencies[upstream.npmPackage], upstream.npmVersion, 'CLI and skill versions must match');
assert.equal(manifest.bin['dsh-ocr'], './bin/dsh-ocr.js');
assert.equal(manifest.exports['.'], './src/index.js');
const patch = parse((await read('cordis.patch.yml')).toString());
assert.equal(patch[0].insert[0].name, manifest.name);
assert.equal(patch[0].insert[0].id, 'ali-open-code-review');
assert.equal((await read('LICENSE')).toString(), (await read('vendor/open-code-review/LICENSE')).toString());
for (const entry of upstream.files) {
  const actual = createHash('sha256').update(await read(`vendor/open-code-review/${entry.path}`)).digest('hex');
  assert.equal(actual, entry.sha256, `Unmodified upstream file: ${entry.path}`);
}
for (const locale of ['en', 'zh']) {
  const metadata = JSON.parse(await read(`locale/${locale}.json`));
  assert.ok(metadata.meta.title && metadata.meta.description);
}
for (const path of ['NOTICE', 'README.md', 'README.en.md', 'docs/PUBLISHING.md', 'docs/FEATURES.md', 'src/pr_adapter.py', 'assets/icon.svg']) {
  assert.ok((await read(path)).length > 0, `Required distribution file: ${path}`);
}
assert.ok((await read('README.md')).toString().includes('针对 [alibaba/open-code-review]'));
assert.ok((await read('NOTICE')).toString().includes(upstream.commit));
for (const dir of ['src', 'bin', 'scripts', 'tests']) {
  for (const file of await readdir(join(packageRoot, dir))) {
    if (!/\.(?:js|mjs)$/u.test(file)) continue;
    const checked = spawnSync(process.execPath, ['--check', join(packageRoot, dir, file)], { encoding: 'utf8', windowsHide: true });
    assert.equal(checked.status, 0, checked.stderr || `${dir}/${file} failed syntax validation`);
  }
}
const cli = resolveOcr();
assert.equal(cli.version, upstream.npmVersion);
const version = spawnSync(cli.executable, ['version'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
assert.equal(version.status, 0, version.stderr || 'Official CLI failed to start');
assert.ok(version.stdout.includes(upstream.npmVersion), `Unexpected OCR version: ${version.stdout}`);
const plugin = await import('../src/index.js');
assert.equal(typeof plugin.apply, 'function');
assert.ok(plugin.inject.includes('sandbox') && plugin.inject.includes('sandboxPolicy'));
console.log(`Checked DSH bundle, source syntax, Apache-2.0 attribution, ${upstream.files.length} upstream hashes, and official OCR ${cli.version}.`);
