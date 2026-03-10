import express from "express";
import url from "url";
import { readFileSync } from "fs";

import { renderToStream } from "@solidjs/web";
import App from "../shared/src/components/App";

const manifest = JSON.parse(
  readFileSync(new URL("../public/js/asset-manifest.json", import.meta.url), "utf-8")
);

const app = express();
const port = 3000;

app.use(
  express.static(url.fileURLToPath(new URL("../public", import.meta.url)), {
    etag: false,
    lastModified: false,
    setHeaders: res => res.setHeader("Cache-Control", "no-store")
  })
);

app.get("*", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  renderToStream(() => <App url={req.url} />, { manifest }).pipe(res);
});

app.listen(port, () => console.log(`Example app listening on port ${port}!`));
