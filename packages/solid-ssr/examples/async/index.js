import express from "express";
import path from "path";

import { awaitSuspense } from "solid-js";
import { renderToStringAsync } from "solid-js/web";
import { extractCss } from "solid-styled-components";
import App from "../shared/src/components/App";

const app = express();
const port = 8080;
const lang = "en";

app.use(express.static(path.join(__dirname, "../public")));

app.get("*", async (req, res) => {
  let html;
  try {
    const string = await renderToStringAsync(awaitSuspense(() => <App url={req.url} />));
    const style = extractCss();
    html = `<html lang="${lang}">
      <head>
        <title>🔥 Solid SSR 🔥</title>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="stylesheet" href="/styles.css" />
        ${style ? `<style id="_goober">${style}</style>` : ""}
      </head>
      <body><div id="app">${string}</div></body>
      <script type="module" src="/js/index.js"></script>
    </html>`;
  } catch (err) {
    console.error(err);
  } finally {
    res.send(html);
  }
});

app.listen(port, () => console.log(`Example app listening on port ${port}!`));
