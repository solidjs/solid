import { resolve } from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const pathToRunner = resolve(__dirname, "writeToDisk.js");

async function run({ entry, output, url }) {
  const { stdout, stderr } = await exec("node", [
    pathToRunner,
    entry,
    output,
    url,
    "--trace-warnings"
  ]);
  if (stdout.length) console.log(stdout);
  if (stderr.length) console.log(stderr);
}

export default async function renderStatic(config) {
  if (Array.isArray(config)) {
    await Promise.all(config.map(run));
  } else await run(config);
}
