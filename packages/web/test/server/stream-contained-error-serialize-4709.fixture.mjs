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
  isDev,
  markSafeError,
  renderToStream,
  ssr
} from "@solidjs/web";
import { createMemo } from "solid-js";

const unserializable = message => Object.assign(new Error(message), { fn() {} });

// <main><Errored fallback={err => <p>{err().message}</p>}>{data()}</Errored></main>
// with `data` a deferStream memo that rejects with `error()`.
function render(error, map) {
  const heard = [];
  let completed = false;
  const App = () => {
    const data = createMemo(() => Promise.reject(error()), { deferStream: true });
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
results.plain = await render(() => unserializable("x"));
// Branded safe: the original reaches the wire in every tier.
results.safe = await render(() => markSafeError(unserializable("visible")));
// The hook's mapping is the boundary's wire in every tier.
results.mapped = await render(
  () => new Error("x"),
  (_, context) => (context.handling === "fallback" ? unserializable("mapped") : undefined)
);
process.stdout.write(JSON.stringify(results));
