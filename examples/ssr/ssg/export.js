import path from "path";
import url from "url";
import renderStatic from "../../static/index.js";

const PAGES = ["index", "profile", "settings"];
const __dirname = url.fileURLToPath(new URL(".", import.meta.url));
const pathToServer = path.resolve(__dirname, "lib/index.js");
const pathToPublic = path.resolve(__dirname, "public");

renderStatic(
  PAGES.map(p => ({
    entry: pathToServer,
    output: path.join(pathToPublic, `${p}.html`),
    url: `/${p}`
  }))
);
