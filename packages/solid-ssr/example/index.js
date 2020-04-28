const express = require("express");
const path = require("path");
const render = require("./lib/server");

const app = express();
const port = 8080;

app.use(express.static(path.join(__dirname, "public")));

app.get("*", async (req, res) => {
  let html;
  try {
    html = await render(req);
  } catch (err) {
    console.log(err);
  } finally {
    res.send(html);
  }
});

app.listen(port, () => console.log(`Example app listening on port ${port}!`));
