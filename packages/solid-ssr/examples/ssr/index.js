import express from "express";
import path from "path";

import { renderToString, generateHydrationScript } from "solid-js/web";
import App from "../shared/src/components/App";

const app = express();
const port = 8080;
const lang = "en";

app.use(express.static(path.join(__dirname, "../public")));

app.get("*", (req, res) => {
  let html;
  try {
    const string = renderToString(() => <App url={req.url} />);
    html = `<html lang="${lang}">
      <head>
        <title>🔥 Solid SSR 🔥</title>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="stylesheet" href="/styles.css" />
        <script>${generateHydrationScript()}</script>
      </head>
      <body><div id="app">${string}</div></body>
      <script async type="module" src="/js/index.js"></script>
    </html>`;
  } catch (err) {
    console.error(err);
  } finally {
    res.send(html);
  }
});

app.listen(port, () => console.log(`Example app listening on port ${port}!`));
