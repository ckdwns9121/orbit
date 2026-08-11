import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dir, "..");
const src = join(root, "src");
const layerRank = new Map([
  ["shared", 0],
  ["entities", 1],
  ["features", 2],
  ["widgets", 3],
  ["pages", 4],
  ["app", 5],
]);
const allowedTopLevel = new Set(["app", "assets", "entities", "features", "main.tsx", "pages", "shared", "tests", "vite-env.d.ts", "widgets"]);
const allowedSegments = new Set(["api", "components", "hooks", "lib", "model", "schema", "ui", "utils"]);
const rootFiles = new Set(["index.ts", "index.tsx", "README.md"]);
const violations: string[] = [];

function walk(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

for (const entry of readdirSync(src)) {
  if (!allowedTopLevel.has(entry)) violations.push(`src/${entry}: 허용되지 않은 최상위 경로`);
}

const features = join(src, "features");
for (const group of readdirSync(features)) {
  const groupPath = join(features, group);
  if (!statSync(groupPath).isDirectory()) continue;
  for (const slice of readdirSync(groupPath)) {
    const slicePath = join(groupPath, slice);
    if (!statSync(slicePath).isDirectory()) continue;
    for (const child of readdirSync(slicePath)) {
      const childPath = join(slicePath, child);
      if (statSync(childPath).isDirectory() && !allowedSegments.has(child)) {
        violations.push(`${relative(root, childPath)}: 허용되지 않은 feature segment`);
      }
      if (statSync(childPath).isFile() && /\.[jt]sx?$/.test(child) && !rootFiles.has(child)) {
        violations.push(`${relative(root, childPath)}: feature root에는 public API만 허용`);
      }
    }
  }
}

function resolveImport(source: string, specifier: string) {
  const base = resolve(dirname(source), specifier);
  return [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")].find(existsSync);
}

for (const file of walk(src).filter((path) => [".ts", ".tsx"].includes(extname(path)) && !path.includes(`${sep}tests${sep}`) && !path.endsWith(".test.ts") && !path.endsWith(".test.tsx"))) {
  const sourceLayer = relative(src, file).split(sep)[0];
  const sourceRank = layerRank.get(sourceLayer);
  if (sourceRank === undefined) continue;
  const content = readFileSync(file, "utf8");
  const imports = [...content.matchAll(/(?:from\s+|import\s*\(\s*)["'](\.[^"']+)["']/g)];
  for (const match of imports) {
    const target = resolveImport(file, match[1]);
    if (!target) continue;
    const targetLayer = relative(src, target).split(sep)[0];
    const targetRank = layerRank.get(targetLayer);
    if (targetRank !== undefined && targetRank > sourceRank) {
      violations.push(`${relative(root, file)} -> ${relative(root, target)}: ${sourceLayer}가 상위 ${targetLayer} 계층을 참조`);
    }
  }
}

if (violations.length) {
  console.error(`[FSD] FAIL (${violations.length})`);
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("[FSD] PASS: 폴더 구조와 계층 의존 방향을 모두 만족합니다.");
