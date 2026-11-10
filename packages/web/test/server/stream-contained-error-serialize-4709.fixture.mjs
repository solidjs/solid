// The contained-error scenarios of stream-contained-error-serialize-4709.spec.tsx,
// run in a child Node against the BUILT artifacts under whatever
// `--conditions` the spec passes: default (production) or `development`.
// The wire policy is a property of the artifacts, so the production record
// is only reachable here. No JSX: the compiled shapes are written out.
// Prints one JSON result.
import {
  Errored,
  createComponent,
  escape,
  getHydrationWriter,
  isDev,
  markSafeError,
  renderToStream,
  ssr
} from "@solidjs/web";
import { createMemo } from "solid-js";

const unserializable = message => Object.assign(new Error(message), { fn() {} });

// <main><Errored fallback={err => <p>{err().message}</p>}>{data()}</Errored></main>
// with `data` a memo that rejects with `error()`, deferStream unless `streamed`.
const contained = (error, streamed) => () => {
  const data = createMemo(() => Promise.reject(error()), { deferStream: !streamed });
  return ssr(
    ["<main>", "</main>"],
    createComponent(Errored, {
      fallback: err => ssr(['<p class="fallback">', "</p>"], escape(String(err().message))),
      get children() {
        return data();
      }
    })
  );
};
// <main>page</main>, the rejection handed to the writer: no boundary reads it.
const written = error => () => {
  getHydrationWriter().write("lib:rejected", Promise.reject(error()), { deferStream: true });
  return ssr("<main>page</main>");
};

function render(App, map) {
  const heard = [];
  let completed = false;
  return Promise.race([
    renderToStream(App, {
      onError(e, context) {
        heard.push(`${context.kind}/${context.handling}`);
        return map ? map(e, context) : undefined;
      },
      onCompleteAll() {
        completed = true;
      }
    }).then(html => ({ state: "settled", html, completed, heard })),
    new Promise(r => setTimeout(r, 500)).then(() => ({ state: "pending", completed, heard }))
  ]);
}

const results = { isDev };
// The default policy: the original in dev, the generic Error in production.
results.plain = await render(contained(() => unserializable("x")));
// Branded safe: the original reaches the wire in every tier.
results.safe = await render(contained(() => markSafeError(unserializable("visible"))));
// The hook's mapping is the boundary's wire in every tier.
results.mapped = await render(
  contained(() => new Error("x")),
  (_, context) => (context.handling === "fallback" ? unserializable("mapped") : undefined)
);
// The same error from a streamed source: seroval meets it after the write.
results.streamed = await render(contained(() => markSafeError(unserializable("visible")), true));
// Nothing contains a rejection handed to the writer.
results.uncaught = await render(written(() => markSafeError(unserializable("visible"))));
process.stdout.write(JSON.stringify(results));
