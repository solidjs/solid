// The client build must carry none of what renders a reply: not the markdown
// parser, not the highlighter, not the model's SDK or its key's name, not the
// store. Run after `pnpm build` (`pnpm check` does both).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../dist/client/", import.meta.url).pathname;
const FORBIDDEN = [
  "ANTHROPIC_API_KEY",
  "anthropic-version", // the SDK's request header
  "registerLanguage", // highlight.js
  'hljs-keyword\\b|className:"keyword"', // its grammars
  "walkTokens", // marked
  "unstorage",
  "simulated model", // the canned answers
  "Interrupted by a server restart", // db.ts
  "Wait for the reply" // db.ts: a refusal's wording
];

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(js|mjs)$/.test(entry.name)) files.push(path);
  }
})(root);

let failed = false;
let bytes = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  bytes += text.length;
  for (const needle of FORBIDDEN) {
    if (new RegExp(needle).test(text)) {
      failed = true;
      console.error(`  LEAK  /${needle}/ in ${file.slice(root.length)}`);
    }
  }
}
if (failed) process.exit(1);
console.log(
  `client bundle is clean: ${files.length} scripts, ${Math.round(bytes / 1024)} kB, none of ${FORBIDDEN.length} server-only markers`
);
