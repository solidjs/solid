const express = require("express");
const path = require("path");
const code = require("./lib/index");
const app = express();
const port = 8080;

app.use(express.static(path.join(__dirname, "public")));

app.get("*", code);

app.listen(port, () => console.log(`Example app listening on port ${port}!`));
