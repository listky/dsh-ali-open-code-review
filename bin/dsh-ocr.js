#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 listky and dsh-ali-open-code-review Contributors

import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { resolveOcr } from '../src/ocr.js';

try {
  const { launcher } = resolveOcr();
  // The original launcher retains its update notices and interactive commands.
  const child = spawn(process.execPath, [launcher, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: process.env,
    windowsHide: true,
  });
  const handlers = [];
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      if (process.platform !== 'win32' || signal !== 'SIGINT') child.kill(signal);
    };
    handlers.push([signal, handler]);
    process.on(signal, handler);
  }
  child.on('error', error => {
    console.error(`[dsh-ocr] ${error.message}`);
    process.exitCode = 1;
  });
  child.on('close', (code, signal) => {
    for (const [event, handler] of handlers) process.off(event, handler);
    process.exitCode = signal ? 128 + (constants.signals[signal] ?? 1) : (code ?? 1);
  });
} catch (error) {
  console.error(`[dsh-ocr] ${error.message}`);
  process.exitCode = 1;
}
