import express from "express";
import path from "path";

import { renderToStringAsync } from "solid-js/web";
import App from "../shared/src/components/App";

const app = express();
const port = 8080;
const lang = "en";

app.use(express.static(path.join(__dirname, "../public")));

app.get("*", async (req, res) => {
  let result;
  try {
    const { html, script } = await renderToStringAsync(() => <App url={req.url} />);
    result = `<html lang="${lang}">
      <head>
        <title>🔥 Solid SSR 🔥</title>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="stylesheet" href="/styles.css" />
        ${script}
      </head>
      <body><div id="app">${html}</div></body>
      <script type="module" src="/js/index.js"></script>
    </html>`;
  } catch (err) {
    console.error(err);
  } finally {
    res.send(result);
  }
});

app.listen(port, () => console.log(`Example app listening on port ${port}!`));
