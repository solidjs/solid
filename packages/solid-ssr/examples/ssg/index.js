globalThis.isSSR = true;
import { awaitSuspense } from "solid-js";
import { renderToString, generateHydrationScript } from "solid-js/dom";
import { extractCss } from "solid-styled-components";
import App from "../shared/src/components/App";
const lang = "en";

// entry point for server render
export default async req => {
  const string = await renderToString(awaitSuspense(() => <App url={req.url} />));
  const style = extractCss();
  return `<html lang="${lang}">
    <head>
      <title>🔥 Solid SSR 🔥</title>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <link rel="stylesheet" href="/styles.css" />
      <script>${generateHydrationScript({
        eventNames: ["click", "blur", "input"],
        resolved: true
      })}</script>
      ${style ? `<style id="_goober">${style}</style>` : ""}
    </head>
    <body><div id="app">${string}</div></body>
    <script type="module" src="/js/index.js"></script>
  </html>`;
};
