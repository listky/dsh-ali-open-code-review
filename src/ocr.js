// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 listky and dsh-ali-open-code-review Contributors

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const packageRoot = fileURLToPath(new URL('../', import.meta.url));
export const prScript = join(packageRoot, 'vendor', 'open-code-review', 'skills', 'open-code-review', 'scripts', 'review_pr.py');
export const prAdapter = join(packageRoot, 'src', 'pr_adapter.py');

/** Resolve the official platform binary using the upstream npm resolver. */
export function resolveOcr() {
  const manifestPath = require.resolve('@alibaba-group/open-code-review/package.json');
  const root = dirname(manifestPath);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const { resolveNativeBinary } = require(join(root, 'scripts', 'platform.js'));
  const binary = resolveNativeBinary();
  if (!binary || !existsSync(binary.path)) {
    throw new Error('The official OCR platform binary is missing. Reinstall this plugin with optional dependencies enabled, or set its executable to an installed native OCR binary.');
  }
  return {
    executable: binary.path,
    launcher: join(root, 'bin', 'ocr.js'),
    version: manifest.version,
  };
}

/** Validate argv without interpreting, rewriting, or filtering upstream flags. */
export function validateArgv(args) {
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) {
    throw new TypeError('args must be an array of strings without NUL characters');
  }
}

export function validateExecutable(executable) {
  if (typeof executable !== 'string' || executable.length === 0 || executable.includes('\0')) {
    throw new TypeError('executable must be an absolute native binary path or a bare executable name');
  }
  if (!isAbsolute(executable) && /[/\\]/u.test(executable)) {
    throw new TypeError('a configured executable path must be absolute');
  }
  if (/\.(?:cmd|bat|ps1)$/iu.test(executable)) {
    throw new TypeError('executable must be a native binary, not a shell script');
  }
}
