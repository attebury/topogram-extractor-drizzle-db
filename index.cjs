const manifest = require("./topogram-extractor.json");
const fs = require("node:fs");
const path = require("node:path");

const drizzleExtractor = {
  id: "db.drizzle-package",
  track: "db",
  detect(context = {}) {
    const configFiles = findConfigFiles(context);
    const schemaFiles = findSchemaFiles(context, configFiles);
    if (configFiles.length === 0 && schemaFiles.length === 0) return { score: 0, reasons: [] };
    const hasTables = schemaFiles.some((filePath) => /\b(pgTable|sqliteTable|mysqlTable)\s*\(/.test(readText(filePath) || ""));
    return {
      score: hasTables ? 95 : 55,
      reasons: [
        configFiles.length > 0 ? `Found ${configFiles.length} Drizzle config file(s).` : "",
        hasTables ? "Found Drizzle table declarations." : ""
      ].filter(Boolean)
    };
  },
  extract(context = {}) {
    const configFiles = findConfigFiles(context);
    const schemaFiles = findSchemaFiles(context, configFiles);
    const parsed = parseDrizzleSchemas(context, schemaFiles);
    const migrationsPath = findDrizzleMigrationsPath(context, configFiles);
    const maintainedSeam = schemaFiles.length > 0
      ? buildMaintainedDbSeam(context, {
          schemaFile: schemaFiles[0],
          migrationsPath,
          migrationEvidence: migrationsPath ? listFilesRecursive(path.resolve(rootDir(context), migrationsPath), (filePath) => filePath.endsWith(".sql")) : [],
          configFiles
        })
      : null;

    return {
      findings: [],
      candidates: {
        entities: parsed.entities,
        enums: parsed.enums,
        relations: parsed.relations,
        indexes: parsed.indexes,
        maintained_seams: maintainedSeam ? [maintainedSeam] : []
      },
      diagnostics: []
    };
  }
};

module.exports = {
  manifest,
  extractors: [drizzleExtractor]
};

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "app",
  "dist",
  "build",
  "coverage",
  ".tmp",
  ".topogram"
]);

function rootDir(context) {
  return path.resolve(context?.paths?.inputRoot || context?.paths?.workspaceRoot || process.cwd());
}

function repoRoot(context) {
  return path.resolve(context?.paths?.repoRoot || rootDir(context));
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function listFilesRecursive(dirPath, predicate, result = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) listFilesRecursive(absolutePath, predicate, result);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!predicate || predicate(absolutePath)) result.push(absolutePath);
  }
  return result;
}

function findPrimaryFiles(context, predicate) {
  return listFilesRecursive(rootDir(context), (filePath) => {
    if (!isPrimarySource(context, filePath)) return false;
    return predicate(filePath);
  }).sort();
}

function isPrimarySource(context, filePath) {
  const relativePath = normalizeRelative(rootDir(context), filePath);
  const segments = relativePath.split("/").filter(Boolean);
  if (segments.some((segment) => IGNORED_DIRS.has(segment))) return false;
  if (segments.includes("__fixtures__") || segments.includes("__tests__") || segments.includes("fixtures") || segments.includes("tests")) return false;
  if (segments[0] === "docs" || segments[0] === "examples") return false;
  if (segments.some((segment) => /^(fixtures?|test-fixtures|snapshots?|generated)$/i.test(segment))) return false;
  return true;
}

function findConfigFiles(context) {
  return findPrimaryFiles(context, (filePath) => /(^|\/)drizzle\.config\.(js|cjs|mjs|ts)$/i.test(filePath.split(path.sep).join("/")));
}

function findSchemaFiles(context, configFiles) {
  const files = new Set();
  for (const configFile of configFiles) {
    const text = readText(configFile) || "";
    for (const match of text.matchAll(/\bschema\s*:\s*["'`]([^"'`*]+)["'`]/g)) {
      const absoluteSchemaPath = path.resolve(path.dirname(configFile), match[1]);
      if (readText(absoluteSchemaPath) !== null && isPrimarySource(context, absoluteSchemaPath)) files.add(absoluteSchemaPath);
    }
  }
  const conventional = [
    "src/db/schema.ts",
    "src/db/schema.js",
    "db/schema.ts",
    "db/schema.js",
    "schema.ts",
    "schema.js"
  ];
  for (const relativePath of conventional) {
    const absolutePath = path.join(rootDir(context), relativePath);
    if (readText(absolutePath) !== null && isPrimarySource(context, absolutePath)) files.add(absolutePath);
  }
  return [...files].sort();
}

function findDrizzleMigrationsPath(context, configFiles) {
  for (const configFile of configFiles) {
    const text = readText(configFile) || "";
    const outMatch = text.match(/\bout\s*:\s*["'`]([^"'`]+)["'`]/);
    if (outMatch) {
      const absolutePath = path.resolve(path.dirname(configFile), outMatch[1]);
      if (hasSqlFiles(absolutePath)) return normalizeRelative(rootDir(context), absolutePath);
    }
  }
  const conventional = path.join(rootDir(context), "drizzle");
  if (hasSqlFiles(conventional)) return "drizzle";
  return "";
}

function hasSqlFiles(dirPath) {
  return listFilesRecursive(dirPath, (filePath) => filePath.endsWith(".sql")).length > 0;
}

function parseDrizzleSchemas(context, schemaFiles) {
  const entities = [];
  const enums = [];
  const relations = [];
  const indexes = [];
  const variableToEntityId = new Map();
  const tableDeclarations = [];

  for (const schemaFile of schemaFiles) {
    const text = readText(schemaFile) || "";
    for (const declaration of findTableDeclarations(text)) {
      const tableName = declaration.tableName;
      const entityId = `entity_${idHintify(tableName)}`;
      variableToEntityId.set(declaration.variableName, entityId);
      tableDeclarations.push({ ...declaration, schemaFile, entityId });
    }
  }

  for (const declaration of tableDeclarations) {
    const fields = [];
    for (const field of declaration.fields) {
      fields.push({
        name: field.columnName,
        type: mapDrizzleType(field.typeName),
        required: field.required,
        unique: field.unique,
        primary: field.primary,
        evidence: [`drizzle column ${declaration.tableName}.${field.columnName}`]
      });
      if (field.enumValues.length > 0) {
        enums.push(candidateRecord({
          id_hint: `${idHintify(declaration.tableName)}_${idHintify(field.columnName)}`,
          name: `${declaration.tableName}.${field.columnName}`,
          values: field.enumValues,
          evidence: [candidateEvidence(context, declaration.schemaFile, `enum values for ${declaration.tableName}.${field.columnName}`)],
          confidence: 0.8
        }));
      }
      if (field.unique) {
        indexes.push(candidateRecord({
          id_hint: `index_${idHintify(declaration.tableName)}_${idHintify(field.columnName)}_unique`,
          entity: declaration.entityId,
          fields: [field.columnName],
          unique: true,
          evidence: [candidateEvidence(context, declaration.schemaFile, `.unique() ${declaration.tableName}.${field.columnName}`)],
          confidence: 0.8
        }));
      }
      if (field.referencesVariable && variableToEntityId.has(field.referencesVariable)) {
        relations.push(candidateRecord({
          id_hint: `rel_${idHintify(declaration.tableName)}_${idHintify(field.referencesVariable)}`,
          from: declaration.entityId,
          to: variableToEntityId.get(field.referencesVariable),
          fields: [field.columnName],
          references: [field.referencesColumn || "id"],
          evidence: [candidateEvidence(context, declaration.schemaFile, `.references() ${declaration.tableName}.${field.columnName}`)],
          confidence: 0.82
        }));
      }
    }
    for (const index of declaration.indexes) {
      indexes.push(candidateRecord({
        id_hint: `index_${idHintify(declaration.tableName)}_${index.fields.map(idHintify).join("_")}${index.unique ? "_unique" : ""}`,
        entity: declaration.entityId,
        fields: index.fields,
        unique: index.unique,
        evidence: [candidateEvidence(context, declaration.schemaFile, `${index.unique ? "unique" : "index"} ${index.name || index.fields.join(", ")}`)],
        confidence: 0.82
      }));
    }
    entities.push(candidateRecord({
      id_hint: declaration.entityId,
      name: declaration.tableName,
      source: "drizzle",
      fields,
      evidence: [candidateEvidence(context, declaration.schemaFile, `drizzle table ${declaration.tableName}`)],
      confidence: 0.88
    }));
  }

  return {
    entities: dedupe(entities, (entry) => entry.id_hint),
    enums: dedupe(enums, (entry) => entry.id_hint),
    relations: dedupe(relations, (entry) => entry.id_hint),
    indexes: dedupe(indexes, (entry) => entry.id_hint)
  };
}

function findTableDeclarations(text) {
  const declarations = [];
  const regex = /\b(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*(pgTable|sqliteTable|mysqlTable)\s*\(/g;
  for (const match of text.matchAll(regex)) {
    const variableName = match[1];
    const argsStart = match.index + match[0].length;
    const extracted = extractBalanced(text, argsStart - 1, "(", ")");
    if (!extracted) continue;
    const args = splitTopLevel(extracted.content);
    const tableName = stripQuotes(args[0] || "") || variableName;
    const fields = parseFieldObject(args[1] || "");
    const indexes = parseIndexBlock(args[2] || "");
    declarations.push({ variableName, tableName, fields, indexes });
  }
  return declarations;
}

function parseFieldObject(text) {
  const objectText = stripOuter(text.trim(), "{", "}");
  const fields = [];
  for (const entry of splitTopLevel(objectText)) {
    const match = entry.match(/^\s*([A-Za-z0-9_]+)\s*:\s*([\s\S]+)$/);
    if (!match) continue;
    const propertyName = match[1];
    const expression = match[2].trim();
    const typeMatch = expression.match(/^([A-Za-z0-9_]+)\s*\(/);
    const columnMatch = expression.match(/\(\s*["'`]([^"'`]+)["'`]/);
    const enumValues = [];
    const enumMatch = expression.match(/\benum\s*:\s*\[([^\]]+)\]/);
    if (enumMatch) {
      for (const valueMatch of enumMatch[1].matchAll(/["'`]([^"'`]+)["'`]/g)) enumValues.push(valueMatch[1]);
    }
    const referencesMatch = expression.match(/\.references\(\s*\(\)\s*=>\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/);
    fields.push({
      propertyName,
      columnName: columnMatch ? columnMatch[1] : propertyName,
      typeName: typeMatch ? typeMatch[1] : "text",
      required: /\.notNull\(\)/.test(expression),
      unique: /\.unique\(\)/.test(expression),
      primary: /\.primaryKey\(\)/.test(expression),
      enumValues,
      referencesVariable: referencesMatch ? referencesMatch[1] : "",
      referencesColumn: referencesMatch ? referencesMatch[2] : ""
    });
  }
  return fields;
}

function parseIndexBlock(text) {
  const indexes = [];
  for (const match of text.matchAll(/\b(unique|index)\s*\(\s*["'`]([^"'`]+)["'`]\s*\)\s*\.on\(([^)]*)\)/g)) {
    const fields = [...match[3].matchAll(/table\.([A-Za-z0-9_]+)/g)].map((fieldMatch) => fieldMatch[1]);
    if (fields.length === 0) continue;
    indexes.push({
      name: match[2],
      unique: match[1] === "unique",
      fields
    });
  }
  return indexes;
}

function extractBalanced(text, startIndex, openChar, closeChar) {
  let depth = 0;
  let quote = "";
  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    const previous = text[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") quote = "";
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === openChar) depth += 1;
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return {
          content: text.slice(startIndex + 1, index),
          end: index
        };
      }
    }
  }
  return null;
}

function splitTopLevel(text) {
  const result = [];
  let current = "";
  let quote = "";
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const previous = text[index - 1];
    if (quote) {
      current += char;
      if (char === quote && previous !== "\\") quote = "";
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(") paren += 1;
    if (char === ")") paren -= 1;
    if (char === "{") brace += 1;
    if (char === "}") brace -= 1;
    if (char === "[") bracket += 1;
    if (char === "]") bracket -= 1;
    if (char === "," && paren === 0 && brace === 0 && bracket === 0) {
      if (current.trim()) result.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

function stripOuter(value, openChar, closeChar) {
  const trimmed = value.trim();
  if (trimmed.startsWith(openChar) && trimmed.endsWith(closeChar)) return trimmed.slice(1, -1);
  return trimmed;
}

function stripQuotes(value) {
  const match = String(value || "").trim().match(/^["'`]([^"'`]+)["'`]$/);
  return match ? match[1] : "";
}

function mapDrizzleType(typeName) {
  const lowered = typeName.toLowerCase();
  if (["text", "varchar", "uuid", "char"].includes(lowered)) return "string";
  if (["integer", "bigint", "serial", "bigserial", "numeric", "decimal", "real", "doubleprecision"].includes(lowered)) return "number";
  if (["boolean"].includes(lowered)) return "boolean";
  if (["timestamp", "date", "time"].includes(lowered)) return "datetime";
  if (["json", "jsonb"].includes(lowered)) return "json";
  return "string";
}

function buildMaintainedDbSeam(context, options) {
  const schemaPath = normalizeRelative(rootDir(context), options.schemaFile);
  const migrationsPath = options.migrationsPath || "";
  const evidence = [
    ...options.configFiles.map((filePath) => candidateEvidence(context, filePath, "Drizzle config file")),
    candidateEvidence(context, options.schemaFile, "Drizzle schema module"),
    ...options.migrationEvidence.slice(0, 5).map((filePath) => candidateEvidence(context, filePath, "Drizzle migration SQL"))
  ].filter(Boolean);
  return candidateRecord({
    kind: "maintained_db_migration_seam",
    id_hint: "seam_drizzle_db_migrations",
    tool: "drizzle",
    ownership: "maintained",
    apply: "never",
    schemaPath,
    migrationsPath,
    snapshotPath: "topo/state/db/app_db/current.snapshot.json",
    runtime_id_hint: "app_db",
    projection_id_hint: "proj_db",
    confidence: migrationsPath ? 0.88 : 0.55,
    evidence,
    match_reasons: migrationsPath
      ? ["Found Drizzle config, schema module, and migration output."]
      : ["Found Drizzle schema evidence without a migration output directory."],
    missing_decisions: migrationsPath
      ? []
      : ["Confirm the maintained migration output directory before configuring a DB seam."],
    proposed_runtime_migration: {
      kind: "database",
      id: "app_db",
      ownership: "maintained",
      migration: {
        tool: "drizzle",
        schemaPath,
        migrationsPath,
        snapshotPath: "topo/state/db/app_db/current.snapshot.json",
        apply: "manual"
      }
    },
    manual_next_steps: [
      "Review the Drizzle config, schema module, and migrations.",
      "Copy the proposed runtime migration into topogram.project.json only after review.",
      "Keep extraction review-only; do not let extraction apply migrations."
    ],
    project_config_target: "topogram.project.json topology.runtimes[]",
    maintained_modules: [schemaPath, migrationsPath].filter(Boolean),
    emitted_dependencies: ["topo/state/db/app_db/current.snapshot.json"],
    allowed_change_classes: ["migration_plan", "sql_proposal", "schema_snapshot"],
    drift_signals: ["schema_changed", "migration_directory_changed"]
  });
}

function normalizeRelative(basePath, filePath) {
  return path.relative(basePath, filePath).split(path.sep).join("/");
}

function candidateEvidence(context, filePath, note) {
  return {
    file: normalizeRelative(repoRoot(context), filePath),
    appPath: normalizeRelative(rootDir(context), filePath),
    note
  };
}

function candidateRecord(fields) {
  return {
    source: "package:@topogram/extractor-drizzle-db",
    ...fields
  };
}

function idHintify(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function dedupe(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
