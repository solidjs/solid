import { awaitSuspense } from "solid-js";
import { renderToStringAsync } from "solid-js/web";
import { extractCss } from "solid-styled-components";
import App from "../shared/src/components/App";
const lang = "en";

// entry point for server render
export default async req => {
  const string = await renderToStringAsync(awaitSuspense(() => <App url={req.url} />));
  const style = extractCss();
  return `<html lang="${lang}">
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
};
