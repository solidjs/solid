import express from "express";
import url from "url";
import { readFileSync } from "fs";

import { renderToStream } from "@solidjs/web";
import App from "../shared/src/components/App";
import manifest from "virtual:asset-manifest";
const app = express();
const port = 3000;

app.use(express.static(url.fileURLToPath(new URL("../public", import.meta.url))));

app.get("/{*path}", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  renderToStream(() => <App url={req.url} />, { manifest }).pipe(res);
});

app.listen(port, () => console.log(`Example app listening on port ${port}!`));
