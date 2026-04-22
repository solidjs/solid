import express from "express";
import path from "path";
import url from "url";

const app = express();
const port = 3000;
const publicDir = url.fileURLToPath(new URL("./public", import.meta.url));

app.use(
  express.static(publicDir, {
    etag: false,
    lastModified: false,
    setHeaders: res => res.setHeader("Cache-Control", "no-store")
  })
);

app.get("*", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(port, () => console.log(`CSR example listening on port ${port}!`));
