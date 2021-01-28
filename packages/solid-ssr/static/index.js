const path = require("path");
const execFile = require("util").promisify(require("child_process").execFile);

const pathToRunner = path.resolve(__dirname, "writeToDisk.js");

async function run({ entry, output, url }) {
  const { stdout, stderr } = await execFile("node", [pathToRunner, entry, output, url, "--trace-warnings"]);
  if (stdout.length) console.log(stdout);
  if (stderr.length) console.log(stderr);
}

module.exports = async function renderStatic(config) {
  if (Array.isArray(config)) {
    await Promise.all(config.map(run));
  } else await run(config);
};
