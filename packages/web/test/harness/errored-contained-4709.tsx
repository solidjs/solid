/**
 * @jsxImportSource @solidjs/web
 *
 * Fixtures for #4709 (review): a streamed memo (no `deferStream`) whose
 * rejection an `<Errored>` contains before the first flush, with an error
 * the default serializer cannot encode. The render keeps the fallback and
 * completes, and the memo's key rejects on the client with a plain `Error`
 * carrying the message, marked as seroval marks a rejection. Rendered by
 * test/server/errored-contained-4709.gen.spec.tsx, replayed by
 * test/hydration/errored-contained-hydration-4709.spec.tsx. The same
 * component runs on both sides: `env.client` picks what `ask` answers.
 */
import { createMemo } from "solid-js";
import { Errored } from "@solidjs/web";

export const env: {
  client: boolean;
  /** Whether the server's error carries a field seroval cannot encode. */
  encodes: boolean;
  runs: number;
  RealPromise: PromiseConstructor;
  reset?: () => void;
} = {
  client: false,
  encodes: false,
  runs: 0,
  RealPromise: Promise
};

// Server: a rejection. Client: a string. The hydration dry run computes
// under a mock Promise: count real asks only.
function ask() {
  if (env.client) {
    if (Promise === env.RealPromise) env.runs++;
    return Promise.resolve("client value");
  }
  return Promise.reject(Object.assign(new Error("x"), env.encodes ? { code: 42 } : { fn() {} }));
}

function fallback(e: () => any, reset: () => void) {
  env.reset = reset;
  return <p class="fb">{e().message}</p>;
}

export function App() {
  const item = createMemo(() => ask());
  return (
    <main>
      <Errored fallback={fallback}>
        <p class="content">{String(item())}</p>
      </Errored>
    </main>
  );
}
