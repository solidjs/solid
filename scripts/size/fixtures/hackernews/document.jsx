// @solidjs/vite-plugin 3.0.0-next.35's built-in document shell
// (`virtual:solid-ssr-document`, SSR start mode) as the plugin emits it:
// minimal, hydration-ready. The client entry script is injected into <head>
// by the handler, not rendered here.
import { HydrationScript } from "@solidjs/web";

export default function Document(props) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <HydrationScript />
      </head>
      <body>{props.children}</body>
    </html>
  );
}
