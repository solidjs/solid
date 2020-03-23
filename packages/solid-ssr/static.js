const path = require("path");
const fs = require("fs");
const util = require("util");
const createSSR = require("./server");

const mkdir = util.promisify(fs.mkdir);
const writeFile = util.promisify(fs.writeFile);

module.exports = async function generateStatic(outDir, { pages, source }) {
  const server = createSSR({ path: source, forks: pages.length });
  await mkdir(outDir, { recursive: true })
  await Promise.all(
    pages.map(async url => {
      const name = `${url.slice(1) || "index"}.html`;
      const s = await server.render({ url });
      writeFile(path.join(outDir, name), s);
    })
  );
  server.terminate();
};
