const path = require("path");
const renderStatic = require("../../static");

const PAGES = ["index", "profile", "settings"];
const pathToServer = path.resolve(__dirname, "lib/index.js");
const pathToPublic = path.resolve(__dirname, "public");

renderStatic(
  PAGES.map(p => ({
    entry: pathToServer,
    output: path.join(pathToPublic, `${p}.html`),
    url: `/${p}`
  }))
);
