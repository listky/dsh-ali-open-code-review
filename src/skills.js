// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 listky and dsh-ali-open-code-review Contributors

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill';
import { packageRoot } from './ocr.js';

export const providerName = 'dsh-ali-open-code-review';
export const skillNames = Object.freeze(['open-code-review', 'open-code-review-delegate']);

const integration = `# DeepSeek Harness integration

These are the original Apache-2.0 skills from alibaba/open-code-review v1.14.4,
loaded by the independent dsh-ali-open-code-review plugin.

The plugin already supplies the official OCR executable. Translate every
\`ocr <arguments>\` instruction below to the \`open_code_review\` tool, passing
only the arguments as an array of strings. Keep each argument unchanged; a
background paragraph is one argument, without shell quoting. Example:
\`{"args":["review","--audience","agent","--background","business context"]}\`.
Use the calling session's workspace; specify \`cwd\` only to select another
directory. Never change the requested target or drop unsupported flags.

For the native skill's Python PR-helper instructions, use
\`open_code_review_pr\` with the same script arguments, e.g.
\`{"args":["https://github.com/OWNER/REPO/pull/42","--background","context"]}\`.
The original helper is unmodified; a small adapter binds its OCR subprocess
to the plugin's executable, including on Windows. Python 3 and authenticated
GitHub CLI are still required. Cleanup via \`["--cleanup","/path/to/run.json"]\`
still requires the explicit consent described in the original skill.

Both tools are noninteractive. Run interactive OCR configuration, authentication,
and the foreground viewer in a human terminal using \`dsh-ocr\` (after a global
plugin install), or \`node <plugin-directory>/bin/dsh-ocr.js\` (local install).
All upstream commands and flags pass through this terminal entry point.
Native OCR uses its own provider configuration, independently of the DSH model.
If the user chooses delegation, the DSH model performs the review and OCR only
provides file selection and rules. Do not silently switch between these modes.

Check \`ok\`, \`exitCode\`, \`timedOut\`, \`aborted\`, and the original output.
When a stream is truncated, read its complete \`spillPath\` in full; if
\`complete\` is false, report the gap. Prefer upstream \`--output\` for large
reports and preserve the original Review and Analysis artifacts. Sandbox
restrictions apply to every process, and an explicit \`cwd\` does not widen them.
Credentials stored in OCR's configuration remain OCR's credentials. Environment
credentials must be opted in by the user through the plugin's \`forwardEnv\`
configuration; never ask the user to paste secrets into chat.

The substitutions above only adapt executable access to DSH. Follow the complete
upstream workflow, coverage requirements, verification, and reporting below.

---

`;

async function loadSkill(name, signal) {
  const path = join(packageRoot, 'vendor', 'open-code-review', 'skills', name, 'SKILL.md');
  const raw = await readFile(path, { encoding: 'utf8', signal });
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw);
  if (!header) throw new Error(`Upstream skill ${name} has no YAML metadata`);
  const data = parse(header[1]);
  if (data.name !== name || typeof data.description !== 'string' || data.license !== 'Apache-2.0') {
    throw new Error(`Invalid upstream metadata in ${path}`);
  }
  return {
    name,
    description: data.description.trim(),
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'bundled',
    provider: providerName,
    path,
    resourceBase: { kind: 'directory', path: dirname(path) },
    metadata: { ...data.metadata, license: data.license, dshAdapter: providerName },
    content: integration + raw.slice(header[0].length),
  };
}

/** Retain upstream skill bodies and resources; add only the DSH execution guide. */
export function createSkillProvider(control) {
  return {
    name: providerName,
    async list(options = {}) {
      const signal = options.signal === undefined ? control.signal : AbortSignal.any([control.signal, options.signal]);
      signal.throwIfAborted();
      const skills = await Promise.all(skillNames.map(name => loadSkill(name, signal)));
      return skills.map(({ content: _content, ...skill }) => ({
        ...skill,
        rank: BUNDLED_SKILL_RANK,
        locator: skill.name,
      }));
    },
    async get(candidate, options = {}) {
      if (!skillNames.includes(candidate.locator)) return undefined;
      const signal = options.signal === undefined ? control.signal : AbortSignal.any([control.signal, options.signal]);
      signal.throwIfAborted();
      return loadSkill(candidate.locator, signal);
    },
  };
}
