import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workRoot = path.join(root, ".tmp", "package-smoke");
const npmCache = path.join(workRoot, "npm-cache");
const cliPackageSpec = process.env.TOPOGRAM_CLI_PACKAGE_SPEC || defaultCliPackageSpec();

fs.rmSync(workRoot, { recursive: true, force: true });
fs.mkdirSync(npmCache, { recursive: true });

const tarball = packPackage();
assertNoRestrictedFiles(tarball);

const consumerRoot = path.join(workRoot, "consumer");
fs.mkdirSync(consumerRoot, { recursive: true });
fs.writeFileSync(path.join(consumerRoot, "package.json"), JSON.stringify({ name: "extractor-drizzle-smoke", private: true }, null, 2));
run("npm", ["install", "--prefix", consumerRoot, "--silent", "--no-audit", "--ignore-scripts", "--package-lock=false", cliPackageSpec, tarball]);

const topogramBin = path.join(consumerRoot, "node_modules", ".bin", process.platform === "win32" ? "topogram.cmd" : "topogram");
run(topogramBin, ["extractor", "check", "@topogram/extractor-drizzle-db"], { cwd: consumerRoot });

const outputRoot = path.join(workRoot, "extracted");
const result = run(topogramBin, [
  "extract",
  path.join(root, "fixtures", "drizzle"),
  "--out",
  outputRoot,
  "--from",
  "db",
  "--extractor",
  "@topogram/extractor-drizzle-db",
  "--json"
], { cwd: consumerRoot });

const json = JSON.parse(result.stdout);
if (json.candidateCounts?.dbEntities < 2) throw new Error(`Expected at least two DB entities, got ${json.candidateCounts?.dbEntities ?? 0}.`);
if (json.candidateCounts?.dbMaintainedSeams !== 1) throw new Error("Expected one maintained DB seam candidate.");

const candidatesPath = path.join(outputRoot, "topo", "candidates", "app", "db", "candidates.json");
const candidates = JSON.parse(fs.readFileSync(candidatesPath, "utf8"));
assert(candidates.entities.some((entry) => entry.id_hint === "entity_users"), "Expected entity_users candidate.");
assert(candidates.entities.some((entry) => entry.id_hint === "entity_tasks"), "Expected entity_tasks candidate.");
assert(candidates.enums.some((entry) => entry.id_hint === "users_role"), "Expected users.role enum candidate.");
assert(candidates.relations.some((entry) => entry.from === "entity_tasks" && entry.to === "entity_users"), "Expected tasks -> users relation candidate.");
const seam = candidates.maintained_seams.find((entry) => entry.tool === "drizzle");
assert(seam, "Expected Drizzle maintained seam candidate.");
assert(seam.schemaPath === "src/db/schema.ts", `Unexpected schemaPath: ${seam.schemaPath}`);
assert(seam.migrationsPath === "drizzle", `Unexpected migrationsPath: ${seam.migrationsPath}`);
assert(Array.isArray(seam.missing_decisions) && seam.missing_decisions.length === 0, "Expected complete seam without missing decisions.");

const receiptPath = path.join(outputRoot, ".topogram-extract.json");
const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
const extractorProvenance = JSON.stringify(receipt.extractors || receipt.provenance || receipt);
assert(extractorProvenance.includes("@topogram/extractor-drizzle-db"), "Expected extractor provenance to mention package.");
assert(extractorProvenance.includes("db.drizzle-package"), "Expected extractor provenance to mention extractor id.");

console.log("Drizzle extractor package smoke passed.");

function packPackage() {
  const result = run("npm", ["pack", "--silent", "--pack-destination", workRoot], { cwd: root });
  const tarballName = result.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  if (!tarballName) throw new Error("npm pack did not print a tarball name.");
  return path.join(workRoot, tarballName);
}

function assertNoRestrictedFiles(tarballPath) {
  const result = run("tar", ["-tf", tarballPath], { cwd: workRoot });
  const entries = result.stdout.split(/\r?\n/).filter(Boolean);
  const restricted = entries.filter((entry) => {
    const base = path.posix.basename(entry);
    return /^\.env($|\.)/.test(base)
      || base === ".npmrc"
      || /\.(pem|key|p8|p12)$/i.test(base)
      || /^id_(rsa|ed25519|ecdsa|dsa)$/i.test(base)
      || /^secrets?(\.|$)/i.test(base)
      || /^credentials?(\.|$)/i.test(base);
  });
  if (restricted.length > 0) throw new Error(`Package contains restricted files:\n${restricted.join("\n")}`);
}

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd || workRoot,
    encoding: "utf8",
    env: childEnv()
  });
  if (result.status !== 0) {
    throw new Error([
      `Command failed: ${command} ${args.join(" ")}`,
      result.stdout,
      result.stderr
    ].filter(Boolean).join("\n"));
  }
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

function childEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("npm_package_") || key.startsWith("npm_lifecycle_")) delete env[key];
  }
  delete env.INIT_CWD;
  delete env.npm_config_local_prefix;
  delete env.npm_config_prefix;
  env.npm_config_cache = npmCache;
  return env;
}

function defaultCliPackageSpec() {
  const version = fs.readFileSync(path.join(root, "topogram-cli.version"), "utf8").trim();
  if (!version) throw new Error("topogram-cli.version must contain the Topogram CLI version used by extractor verification.");
  return `@topogram/cli@${version}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
