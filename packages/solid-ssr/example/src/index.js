import "../../register";
import { renderToString, generateHydrationEventsScript } from "solid-js/dom";
import Page from "./Page";
const lang = "en";

function render(body) {
  return `<html lang="${lang}">
    <head>
      <title>🔥 Solid SSR 🔥</title>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <script>${generateHydrationEventsScript(["click", "blur", "input"])}</script>
    </head>
    <body>${body}</body>
  </html>`;
}

require("http")
  .createServer((req, res) => {
    renderToString(Page).then(result => {
      res.writeHead(200, { "content-type": "text/html;charset=utf-8" });
      res.end(render(result));
    });
  })
  .listen(8080);

console.log("http://localhost:8080/");
