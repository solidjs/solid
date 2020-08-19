const path = require("path");
const { execFile } = require("child_process");

const pathToRunner = path.resolve(__dirname, "writeToDisk.js");

function run({ entry, output, url }) {
  execFile("node", [pathToRunner, entry, output, url], (err, stdout, stderr) => console.log(stdout));
}

module.exports = function renderStatic(config) {
  if (Array.isArray(config)) {
    config.forEach(run);
  } else run(config);
};
