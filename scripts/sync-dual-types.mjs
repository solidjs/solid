import { cpSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);

if (args.length === 0 || args.length % 2 !== 0) {
  console.error("Usage: node sync-dual-types.mjs <src> <dest> [<src> <dest> ...]");
  process.exit(1);
}

for (let i = 0; i < args.length; i += 2) {
  const src = resolve(args[i]);
  const dest = resolve(args[i + 1]);

  if (!statSync(src).isDirectory()) {
    console.error(`Source is not a directory: ${src}`);
    process.exit(1);
  }

  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  rewriteTreeToCjsDeclarations(dest);
  writeFileSync(
    resolve(dest, "package.json"),
    JSON.stringify({ type: "commonjs" }, null, 2) + "\n"
  );
}

function rewriteTreeToCjsDeclarations(root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = resolve(root, entry.name);
    if (entry.isDirectory()) {
      rewriteTreeToCjsDeclarations(fullPath);
      continue;
    }

    if (!entry.name.endsWith(".d.ts")) continue;

    const source = readFileSync(fullPath, "utf8")
      .replace(/((?:\.{1,2}\/)[^"'`]+)\.d\.ts(["'])/g, "$1.d.cts$2")
      .replace(/((?:\.{1,2}\/)[^"'`]+)\.js(["'])/g, "$1.cjs$2");
    writeFileSync(fullPath, source);
    renameSync(fullPath, fullPath.replace(/\.d\.ts$/, ".d.cts"));
  }
}
