// `page: hackernews`: the client entry of examples/hackernews as
// @solidjs/vite-plugin 3.0.0-next.35 generates it for that example's config
// (`solid({ start: {}, ssr: true, serverFunctions: { components: true } })`,
// the default `errorBoundary`, no devtools) — `virtual:solid-ssr-entry-client`
// written out: install the server-component transport, then hydrate the
// document with the app inside the plugin's default error boundaries. The
// app is the example's own `src/app.tsx` (through its `~` alias), reached
// unchanged; `document.jsx` and `error-boundary.jsx` beside this file are
// the plugin's other two generated modules. Together they are what the
// example's `vite build` hands the browser as its one eager script.
import { hydrate } from "@solidjs/web";
import { installServerComponents } from "@solidjs/web/frames";
import { DefaultErrorBoundary } from "./error-boundary.jsx";
import Document from "./document.jsx";
import App from "~/app";

installServerComponents();

hydrate(
  () => (
    <DefaultErrorBoundary>
      <Document>
        <DefaultErrorBoundary>
          <App />
        </DefaultErrorBoundary>
      </Document>
    </DefaultErrorBoundary>
  ),
  document
);
