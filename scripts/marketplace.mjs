#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 listky and dsh-ali-open-code-review Contributors

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { packageRoot } from '../src/ocr.js';

const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
const args = process.argv.slice(2);
if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  console.log('Usage: npm run marketplace -- [--repository https://github.com/OWNER/REPO]\n\nWrites the community store entry to release/OWNER__REPO.yml. Does not publish or submit a PR.');
} else {
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--repository')) {
    throw new Error('Expected --repository https://github.com/OWNER/REPO');
  }
  const repository = (args[1] ?? manifest.repository.url.replace(/^git\+/u, '').replace(/\.git$/u, '')).replace(/\/$/u, '');
  const match = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)$/u.exec(repository);
  if (!match || ['.', '..'].includes(match[2])) throw new Error('A canonical GitHub repository URL is required');
  const entry = {
    url: repository,
    name: `${match[1]}/${match[2]}`,
    category: 'git',
    description: {
      en: 'Reuses Alibaba Open Code Review in DeepSeek Harness for native and host-model reviews, scanning, rules, sessions, and reports.',
      zh: '针对 Alibaba Open Code Review 开发的 DeepSeek Harness 插件，复用原生与宿主模型审查、扫描、规则、会话和报告。',
    },
    tarball: `${repository}/releases/download/v${manifest.version}/${manifest.name}-${manifest.version}.tgz`,
  };
  const directory = join(packageRoot, 'release');
  await mkdir(directory, { recursive: true });
  const target = join(directory, `${match[1]}__${match[2]}.yml`);
  await writeFile(target, stringify(entry, { lineWidth: 0 }), 'utf8');
  console.log(`Wrote ${target}\nSubmit it as data/plugins/${match[1]}__${match[2]}.yml to awesome-dsh-plugin/awesome-dsh-plugin after the public repository is at least one day old and has the dsh-plugin topic.`);
}
