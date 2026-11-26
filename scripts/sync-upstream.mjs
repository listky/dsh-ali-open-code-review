#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 dsh-open-code-review Contributors

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendorRoot = join(projectRoot, "vendor", "open-code-review");
const manifestPath = join(vendorRoot, "UPSTREAM.json");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function targetPath(sourcePath) {
  if (
    typeof sourcePath !== "string" ||
    sourcePath.length === 0 ||
    sourcePath.includes("\\") ||
    sourcePath.includes(":") ||
    sourcePath.includes("\0") ||
    sourcePath.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`Invalid upstream file path: ${sourcePath}`);
  }
  const target = resolve(vendorRoot, sourcePath);
  const within = relative(vendorRoot, target);
  if (!within || within.startsWith("..") || isAbsolute(within)) {
    throw new Error(`Upstream file is outside the vendor directory: ${sourcePath}`);
  }
  if (target === manifestPath) {
    throw new Error("UPSTREAM.json cannot be downloaded from upstream.");
  }
  return target;
}

async function readManifest() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    manifest.repository !== "https://github.com/alibaba/open-code-review" ||
    !/^[a-f0-9]{40}$/.test(manifest.commit) ||
    manifest.npmPackage !== "@alibaba-group/open-code-review" ||
    !/^\d+\.\d+\.\d+$/.test(manifest.npmVersion) ||
    manifest.tag !== `v${manifest.npmVersion}` ||
    manifest.license !== "Apache-2.0" ||
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0
  ) {
    throw new Error("UPSTREAM.json must contain a fixed Alibaba release and file checksums.");
  }
  const seen = new Set();
  for (const entry of manifest.files) {
    if (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error("Each upstream file needs a SHA-256 checksum.");
    }
    targetPath(entry.path);
    if (seen.has(entry.path)) {
      throw new Error(`Duplicate upstream file: ${entry.path}`);
    }
    seen.add(entry.path);
  }
  return manifest;
}

async function checkFiles(manifest) {
  const failures = [];
  for (const entry of manifest.files) {
    try {
      const actual = sha256(await readFile(targetPath(entry.path)));
      if (actual !== entry.sha256) {
        failures.push(`${entry.path}: SHA-256 mismatch (expected ${entry.sha256}, got ${actual})`);
      }
    } catch (error) {
      failures.push(`${entry.path}: ${error.message}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }
  console.log(`Verified ${manifest.files.length} unchanged upstream files at ${manifest.tag} (${manifest.commit}).`);
}

async function downloadFile(manifest, entry) {
  const sourcePath = entry.path.split("/").map(encodeURIComponent).join("/");
  const url = `${manifest.repository}/raw/${manifest.commit}/${sourcePath}`;
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    throw new Error(`${entry.path}: ${error.message}${error.cause?.message ? ` (${error.cause.message})` : ""}`);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`${entry.path}: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== entry.sha256) {
    throw new Error(`${entry.path}: downloaded SHA-256 mismatch (expected ${entry.sha256}, got ${actual})`);
  }
  return { entry, bytes };
}

async function syncFiles(manifest) {
  const downloads = await Promise.allSettled(
    manifest.files.map((entry) => downloadFile(manifest, entry)),
  );
  const failures = downloads.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    throw new Error(failures.map((result) => result.reason.message).join("\n"));
  }

  // Validate every download before replacing any source file.
  for (const result of downloads) {
    const { entry, bytes } = result.value;
    const target = targetPath(entry.path);
    await mkdir(dirname(target), { recursive: true });
    const staging = `${target}.ocr-sync-${process.pid}-${randomUUID()}`;
    try {
      await writeFile(staging, bytes, { flag: "wx", mode: 0o644 });
      await rename(staging, target);
    } finally {
      await rm(staging, { force: true });
    }
  }
  await checkFiles(manifest);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    console.log("Usage: node scripts/sync-upstream.mjs [--check | --sync]\n\n--check  Verify the pinned vendor files offline (default).\n--sync   Download the exact pinned commit and verify hashes before replacement.\n\nThis command never changes UPSTREAM.json or installs/upgrades the OCR CLI.");
    return;
  }
  if (args.length > 1 || (args.length === 1 && !["--check", "--sync"].includes(args[0]))) {
    throw new Error("Usage: node scripts/sync-upstream.mjs [--check | --sync]");
  }
  const manifest = await readManifest();
  if (args[0] === "--sync") {
    await syncFiles(manifest);
  } else {
    await checkFiles(manifest);
  }
}

main().catch((error) => {
  console.error(`[upstream] ${error.message}`);
  process.exitCode = 1;
});
