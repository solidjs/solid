globalThis.isSSR = true;
import { renderToString, generateHydrationScript } from "solid-js/server";
import App from "../shared/components/App";
const lang = "en";

function render(body) {
  return `<html lang="${lang}">
    <head>
      <title>🔥 Solid SSR 🔥</title>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <link rel="stylesheet" href="/styles.css" />
      <script>${generateHydrationScript({
        eventNames: ["click", "blur", "input"]
      })}</script>
    </head>
    <body><div id="app">${body}</div></body>
    <script type="module" src="/js/index.js"></script>
  </html>`;
}

// entry point for server render
export default req => {
  const string = renderToString(() => <App url={req.url} />);
  return render(string);
};
