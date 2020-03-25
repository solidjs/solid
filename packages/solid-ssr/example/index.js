const express = require("express");
const path = require("path");
const createSSR = require("../server");

const server = createSSR({ path: path.resolve(__dirname, "lib/server.js") });
const app = express();
const port = 8080;

app.use(express.static(path.join(__dirname, "public")));

app.get("*", async (req, res) => {
  let html;
  try {
    html = await server.render(req);
  } catch (err) {
    console.log(err);
  } finally {
    res.send(html);
  }
});

app.listen(port, () => console.log(`Example app listening on port ${port}!`));
