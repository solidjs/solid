import express from "express";
import url from "url";

import { Loading } from "solid-js";
import { renderToString } from "@solidjs/web";
import Shell from "../shared/src/components/Shell";
import App from "../shared/src/components/App";

import manifest from "virtual:asset-manifest";

const app = express();
const port = 3000;

app.use(express.static(url.fileURLToPath(new URL("../public", import.meta.url))));

// `renderToString` is fully synchronous, so an uncaught async read throws.
// Wrap `<App />` in a `<Loading>` here (and in `./client.tsx`) so sync SSR
// can emit a fallback page for async routes. Streaming SSR and CSR don't
// need this -- streaming holds the response and `render()` defers the
// initial mount.
app.get("*", (req, res) => {
  let html: string | undefined;

  try {
    html = renderToString(
      () => (
        <Shell>
          <Loading fallback={<div>Loading…</div>}>
            <App url={req.url} />
          </Loading>
        </Shell>
      ),
      { manifest }
    );
  } catch (error) {
    console.error(error);
  } finally {
    res.send(html);
  }
});

app.listen(port, () => console.log(`Example app listening on port ${port}!`));
