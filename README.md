# @topogram/extractor-drizzle-db

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
