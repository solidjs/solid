import client from "../../client";
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

client(async (req) => {
  const string = await renderToString(Page);
  return render(string);
})