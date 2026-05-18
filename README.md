# @topogram/extractor-drizzle-db

> Package-backed Topogram extractor for Drizzle database schemas and migrations.

Status: current
Audience: extractor package authors and maintainers
Use when: you need to change extractor evidence recovery, manifests, package metadata, or release proof.

Package-backed Topogram extractor for Drizzle database schemas and migrations.

This package extracts review-only database candidates from Drizzle projects:

- `drizzle.config.*` schema and migration output hints
- Drizzle table, enum, relation, and index candidates
- maintained database seam candidates for manual `topogram.project.json` review

Extractor packages run only during `topogram extract`, emit review-only candidates, and never mutate the source app or write canonical `topo/**` directly.

## Usage

```bash
topogram extract ./brownfield-app --out ./topogram-review --from db --extractor @topogram/extractor-drizzle-db
```

## Verification

```bash
npm run check
```

## Release Preflight

```bash
npm run release:preflight
```

The preflight runs package checks, docs/RAG verification, `npm pack --dry-run`,
and Gitleaks secret scanning before publish or broad sharing.
