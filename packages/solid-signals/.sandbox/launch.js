import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const SANDBOX_TEMPLATE = path.resolve(process.cwd(), ".sandbox"),
  SANDBOX_DIR = path.resolve(process.cwd(), "sandbox"),
  IGNORED_FILES = new Set(["launch.js"]);

// Copy files from .sandbox template directory to sandbox.
if (!fs.existsSync(SANDBOX_DIR)) {
  fs.mkdirSync(SANDBOX_DIR);
  const files = fs.readdirSync(SANDBOX_TEMPLATE);
  for (const file of files) {
    if (IGNORED_FILES.has(file)) continue;
    const from = path.resolve(SANDBOX_TEMPLATE, file);
    const to = path.resolve(SANDBOX_DIR, file);
    fs.writeFileSync(to, fs.readFileSync(from, "utf-8"));
  }
}

execSync("vite --open=/sandbox/index.html --port=3100 --host", {
  stdio: "inherit",
});
