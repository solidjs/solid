const path = require("path");
const execFile = require("util").promisify(require("child_process").execFile);

const pathToRunner = path.resolve(__dirname, "writeToDisk.js");

async function run({ entry, output, url }) {
  const { stdout } = await execFile("node", [pathToRunner, entry, output, url]);
  if (stdout.length) console.log(stdout);
}

module.exports = async function renderStatic(config) {
  if (Array.isArray(config)) {
    await Promise.all(config.map(run));
  } else await run(config);
};
