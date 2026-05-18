#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildLlmsFullText, localMarkdownLinksFromLlms } from "./build-llms-full.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(packageRoot, relativePath), "utf8");
}

function verifyLlmsTxt() {
  const text = read("llms.txt");
  assert.match(text, /^# .+$/m, "llms.txt must include a package title");
  assert.match(text, /^> /m, "llms.txt must include a summary blockquote");
  assert.match(text, /^## Optional$/m, "llms.txt must include an Optional section");
  for (const link of localMarkdownLinksFromLlms(text, { includeOptional: true })) {
    assert.equal(fs.existsSync(path.join(packageRoot, link)), true, `llms.txt link must exist: ${link}`);
  }
}

function verifyLlmsFull() {
  const expected = buildLlmsFullText();
  const actual = read("llms-full.txt");
  assert.equal(actual, expected, "llms-full.txt is stale; run npm run docs:rag:build");
}

function verifyPrimaryDocs() {
  for (const file of ["README.md", "AGENTS.md"]) {
    const text = read(file);
    assert.match(text, /^# .+/m, `${file} must include an H1`);
    assert.match(text, /^> .+/m, `${file} must include a summary blockquote`);
    assert.match(text, /^Status: current$/m, `${file} must include Status: current`);
    assert.match(text, /^Audience: .+/m, `${file} must include Audience metadata`);
    assert.match(text, /^Use when: .+/m, `${file} must include Use when metadata`);
  }
}

verifyLlmsTxt();
verifyLlmsFull();
verifyPrimaryDocs();
console.log("Package docs RAG check passed.");
