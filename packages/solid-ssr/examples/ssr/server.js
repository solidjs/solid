const express = require("express");
const path = require("path");
const code = require("./lib/index");
const app = express();
const port = 8080;

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  let html;
  try {
    html = code(req);
  } catch (err) {
    console.log(err);
  } finally {
    res.send(html);
  }
});

app.listen(port, () => console.log(`Example app listening on port ${port}!`));
