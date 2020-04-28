const path = require("path");
const source = require("./lib/server");
const ssg = require("../static");

ssg(path.resolve(__dirname, "dist"), {
  source,
  pages: ["index", "profile", "settings"]
});
