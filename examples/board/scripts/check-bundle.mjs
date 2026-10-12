// The client build must carry no server code: not the store, not its rules,
// not the storage library. Run after `pnpm build` (`pnpm check` does both).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../dist/client/", import.meta.url).pathname;
const FORBIDDEN = [
  "unstorage",
  "is full (", // db.ts: the card limit's wording
  "was archived", // db.ts: its other refusals
  "A title can't be empty",
  "BOARD_STORAGE",
  "BOARD_SLOW"
];

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(js|mjs|css|html)$/.test(entry.name)) files.push(path);
  }
})(root);

let failed = false;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const needle of FORBIDDEN) {
    if (text.includes(needle)) {
      failed = true;
      console.error(`  LEAK  "${needle}" in ${file.slice(root.length)}`);
    }
  }
}
if (failed) process.exit(1);
console.log(
  `client bundle is clean: ${files.length} files, none of ${FORBIDDEN.length} server strings`
);
