globalThis.isSSR = true;
import { renderToNodeStream, generateHydrationScript } from "solid-js/server";
import App from "../shared/components/App";
const lang = "en";

// entry point for server render
export default (req, res) => {
  const stream = renderToNodeStream(() => <App url={req.url} />)

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
};
