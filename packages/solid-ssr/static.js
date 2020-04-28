const path = require("path");
const fs = require("fs");
const util = require("util");

const mkdir = util.promisify(fs.mkdir);
const writeFile = util.promisify(fs.writeFile);

module.exports = async function generateStatic(outDir, { pages, source, urlRoot = "/" }) {
  await mkdir(outDir, { recursive: true });
  await Promise.all(
    pages.map(async (name) => {
      const fileName = `${name || "index"}.html`;
      const s = await source({ url: urlRoot + (name === "index" ? "" : name) });
      writeFile(path.join(outDir, fileName), s);
    })
  );
};
