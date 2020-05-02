const path = require("path");
const fs = require("fs");
const util = require("util");
const createSSR = require("./server");

const mkdir = util.promisify(fs.mkdir);
const writeFile = util.promisify(fs.writeFile);

module.exports = async function generateStatic(outDir, { pages, source, urlRoot = "/" }) {
  const server = createSSR({ path: source, forks: pages.length });
  await mkdir(outDir, { recursive: true });
  await Promise.all(
    pages.map(async (name) => {
      const fileName = `${name || "index"}.html`;
      const s = await server.render({ url: urlRoot + (name === "index" ? "" : name) });
      writeFile(path.join(outDir, fileName), s);
    })
  );
  server.terminate();
};
