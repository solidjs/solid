const path = require("path")
const ssg = require("../static");

ssg(path.resolve(__dirname, "dist"), {
  source: path.resolve(__dirname, "lib/server.js"),
  pages: ["/", "/profile", "/settings"]
});
