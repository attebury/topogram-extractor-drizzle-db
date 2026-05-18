#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(message);
  process.exit(1);
}

for (const marker of ["package.json", "topogram-extractor.json"]) {
  if (!fs.existsSync(path.join(packageRoot, marker))) {
    fail(`Expected ${marker} under package root ${packageRoot}`);
  }
}

if (process.env.TOPOGRAM_SECRET_SCAN_ALREADY_RAN === "1") {
  console.log("Secret scan already ran in CI; skipping local Gitleaks invocation.");
  process.exit(0);
}

const version = spawnSync("gitleaks", ["version"], {
  cwd: packageRoot,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
});

if (version.error && version.error.code === "ENOENT") {
  fail([
    "Gitleaks is required for `npm run security:secrets`.",
    "Install it with `brew install gitleaks` or follow https://github.com/gitleaks/gitleaks.",
    "Package CI may set TOPOGRAM_SECRET_SCAN_ALREADY_RAN=1 only after a Gitleaks action has already passed."
  ].join("\n"));
}

if (version.status !== 0) {
  fail(`Unable to run Gitleaks: ${(version.stderr || version.stdout || "").trim()}`);
}

const args = ["git", "--redact=100", "--verbose", "."];
if (fs.existsSync(path.join(packageRoot, ".gitleaks.toml"))) {
  args.splice(1, 0, "--config", ".gitleaks.toml");
}

const result = spawnSync("gitleaks", args, {
  cwd: packageRoot,
  stdio: "inherit"
});

if (result.error) {
  fail(`Gitleaks failed to start: ${result.error.message}`);
}

process.exit(result.status ?? 1);
