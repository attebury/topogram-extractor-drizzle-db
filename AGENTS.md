# @topogram/extractor-drizzle-db Agent Guide

> Agent operating rules for maintaining this Topogram extractor package safely.

Status: current
Audience: coding agents and humans maintaining this package
Use when: you are editing adapter code, fixtures, package metadata, workflows, docs, or release proof.

## Rules

- Extractors are read-only and emit review-only findings, candidates, diagnostics, and provenance.
- Do not mutate source app files, write canonical topo/**, install packages, use network access, or define adoption semantics.
- Package checks must prove extractor check, extraction, plan/query/adoption review, and unchanged fixture source.
- Keep evidence and diagnostics portable; do not leak machine-local paths.
- Keep `llms.txt` and `llms-full.txt` current when README or agent guidance changes.
- Run `npm run release:preflight` before publishing or broad sharing.

## Local Engine Testing

```bash
TOPOGRAM_CLI=/absolute/path/to/topogram/engine/src/cli.js npm run check
```
