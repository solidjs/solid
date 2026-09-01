// Headless verification that the R channel threads through Solid context.
//
// Build the sources first, then run against the client build of solid-js:
//   npx esbuild src/solid-effect.ts src/api.ts --outdir=.verify --bundle \
//     --format=esm --external:solid-js --external:effect --external:effect/Utils
//   node --conditions=browser verify-r.mjs
//
// Case 1: memo reads runEffect(searchPackages(q)) under a RuntimeContext
//         provider built from SearchConfigLive → results arrive.
// Case 2: same memo with NO provider → default-runtime fallback fails with
//         a missing-service error (proves the provider was load-bearing).
import {
  createComponent,
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  flush
} from "solid-js";
import { createRuntime, RuntimeContext, runEffect } from "./.verify/solid-effect.js";
import { searchPackages, SearchConfigLive } from "./.verify/api.js";

const sleep = ms => new Promise(r => setTimeout(r, ms));

function run(withProvider) {
  return new Promise(resolve => {
    createRoot(() => {
      const body = () => {
        const results = createMemo(() => runEffect(searchPackages("solid")));
        createEffect(() => results(), {
          effect: value => resolve({ ok: true, count: value.length }),
          error: err => resolve({ ok: false, error: String(err) })
        });
        return null;
      };
      if (withProvider) {
        const out = createComponent(RuntimeContext, {
          value: createRuntime(SearchConfigLive),
          get children() {
            return body();
          }
        });
        // The provider's children resolve lazily and are only kept alive
        // while observed — hold them in a render effect like a renderer does.
        createRenderEffect(
          () => {
            let o = out;
            while (typeof o === "function") o = o();
            return o;
          },
          () => {}
        );
      } else body();
    });
    flush();
  });
}

const withProvider = await Promise.race([run(true), sleep(8000).then(() => "timeout")]);
console.log("with provider   :", JSON.stringify(withProvider));

const withoutProvider = await Promise.race([run(false), sleep(8000).then(() => "timeout")]);
console.log("without provider:", JSON.stringify(withoutProvider));

const pass =
  withProvider.ok === true &&
  withProvider.count > 0 &&
  withoutProvider.ok === false &&
  /Service not found|SearchConfig/.test(withoutProvider.error);
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);
