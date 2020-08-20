globalThis.isSSR = true;
import express from "express";
import path from "path";

import { renderToNodeStream, generateHydrationScript } from "solid-js/server";
import App from "../shared/src/components/App";

const app = express();
const port = 8080;
const lang = "en";

app.use(express.static(path.join(__dirname, "../public")));

app.get("*", (req, res) => {
  const stream = renderToNodeStream(() => <App url={req.url} />);

  const htmlStart = `<html lang="${lang}">
    <head>
      <title>🔥 Solid SSR 🔥</title>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <link rel="stylesheet" href="/styles.css" />
      <script>${generateHydrationScript({
        eventNames: ["click", "blur", "input"],
        streaming: true
      })}</script>
    </head>
    <body><div id="app">`;

  res.write(htmlStart);

  stream.pipe(res, { end: false });

  const htmlEnd = `</div></body>
    <script type="module" src="/js/index.js"></script>
  </html>`;

  stream.on("end", () => {
    res.write(htmlEnd);
    res.end();
  });
});

app.listen(port, () => console.log(`Example app listening on port ${port}!`));
