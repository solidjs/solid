import ssr from "../..";
import { awaitSuspense } from "solid-js";
import { renderToString, generateHydrationEventsScript } from "solid-js/dom";
import App from "./components/App";
const lang = "en";

function render(body) {
  return `<html lang="${lang}">
    <head>
      <title>🔥 Solid SSR 🔥</title>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <link rel="stylesheet" href="/styles.css" />
      <script>${generateHydrationEventsScript(["click", "blur", "input"])}</script>
    </head>
    <body><div id="app">${body}</div></body>
    <script type="module" src="/js/index.js"></script>
  </html>`;
}

// entry point for server render
ssr(async req => {
  const string = await renderToString(awaitSuspense(() => <App url={req.url} />));
  return render(string);
});
