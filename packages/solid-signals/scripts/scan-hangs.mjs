// Wedge scanner: runs each test file in an isolated vitest process with a
// hard timeout; reports TIMEOUT (wedge) / FAIL / PASS per file.
// Usage: node scripts/scan-hangs.mjs [timeoutMs]
import { execFile } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const TIMEOUT = parseInt(process.argv[2] || "30000", 10);
const root = new URL("..", import.meta.url).pathname;

const files = [];
const walk = dir => {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (e.isDirectory()) walk(join(dir, e.name));
    else if (e.name.endsWith(".test.ts")) files.push(join(dir, e.name));
  }
};
walk("tests");

const runOne = file =>
  new Promise(resolve => {
    const child = execFile(
      "pnpm",
      ["vitest", "run", "--no-file-parallelism", file],
      { cwd: root, timeout: TIMEOUT, killSignal: "SIGKILL" },
      (err, stdout) => {
        if (err && err.killed) return resolve("TIMEOUT");
        const m = /Tests\s+(?:(\d+) failed \| )?(\d+) passed/.exec(stdout);
        if (!m) return resolve("ERROR");
        resolve(m[1] ? `FAIL(${m[1]}/${+m[1] + +m[2]})` : "PASS");
      }
    );
    void child;
  });

for (const f of files) {
  const r = await runOne(f);
  if (r !== "PASS") console.log(r.padEnd(12), f);
}
console.log("scan complete:", files.length, "files");
