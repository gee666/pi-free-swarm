import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  cwd: root,
  encoding: "utf8",
  timeout: 60_000,
});
const [pack] = JSON.parse(output);
assert.ok(pack && Array.isArray(pack.files), "npm pack did not return a file list");
const packed = new Set(pack.files.map((file) => file.path));

function requireFile(file) {
  assert.ok(packed.has(file), `Missing from package: ${file}`);
}

function sourceFiles(directory) {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(file) : [file];
  });
}

for (const file of ["index.ts", "package.json", "README.md", "LICENSE", "src/store/schema.sql", "ui_dist/index.html"]) {
  requireFile(file);
}
for (const file of [...sourceFiles("src"), ...sourceFiles("ui_dist")]) requireFile(file);

// A strict allowlist catches accidental runtime/scratch files even inside a shipped directory.
const roots = new Set(["index.ts", "package.json", "README.md", "LICENSE"]);
for (const file of packed) {
  assert.ok(
    roots.has(file) ||
      /^src\/[\w/-]+\.(ts|sql)$/.test(file) ||
      /^ui_dist\/(index\.html|assets\/[\w.-]+\.(js|css|woff2?))$/.test(file),
    `Unexpected package file: ${file}`,
  );
  assert.ok(!/(^|\/)(tmp|runtime|sessions|node_modules|\.pi)(\/|$)/.test(file), `Runtime/scratch data packed: ${file}`);
}

for (const pattern of [
  /^ui_dist\/assets\/.+\.js$/,
  /^ui_dist\/assets\/.+\.css$/,
  /\/inter-.+\.woff2$/,
  /\/jetbrains-mono-.+\.woff2$/,
]) {
  assert.ok(
    [...packed].some((file) => pattern.test(file)),
    `Missing board asset matching ${pattern}`,
  );
}

// Check the entry page and font URLs too: merely shipping some assets would miss a stale reference.
for (const file of [...packed].filter((file) => file === "ui_dist/index.html" || file.endsWith(".css"))) {
  const text = readFileSync(path.join(root, file), "utf8");
  const references = file.endsWith(".html")
    ? [...text.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1])
    : [...text.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)].map((match) => match[1]);
  for (const reference of references) {
    if (/^(data:|https?:|#)/.test(reference)) continue;
    const local = reference.startsWith("/")
      ? `ui_dist/${reference.slice(1)}`
      : path.posix.join(path.posix.dirname(file), reference);
    requireFile(local);
  }
}
console.log(`Package OK: ${packed.size} files, ${pack.size} bytes packed, ${pack.unpackedSize} bytes unpacked.`);
