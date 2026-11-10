/**
 * @jsxImportSource @solidjs/web
 *
 * Fixtures for #4747: a memo that rejects on the server inside an
 * `<Errored>`, read with and without `deferStream`. Rendered by
 * test/server/errored-deferstream-rejection-4747.gen.spec.tsx, replayed by
 * test/hydration/errored-deferstream-rejection-4747.spec.tsx. The same
 * components run on both sides: `env.client` picks what `ask` answers.
 */
import { createMemo } from "solid-js";
import { Errored } from "@solidjs/web";

export const env: {
  client: boolean;
  runs: number;
  RealPromise: PromiseConstructor;
  reset?: () => void;
} = { client: false, runs: 0, RealPromise: Promise };

// Server: a rejection; client: a value. The hydration dry run computes under
// a mock Promise: count real asks only.
function ask(): Promise<string> {
  if (!env.client) return Promise.reject(Object.assign(new Error("x"), { code: 42 }));
  if (Promise === env.RealPromise) env.runs++;
  return Promise.resolve("client value");
}

function App(props: { deferStream: boolean }) {
  const item = createMemo(() => ask(), { deferStream: props.deferStream });
  return (
    <main>
      <Errored
        fallback={(e: () => any, reset: () => void) => {
          env.reset = reset;
          return <p class="fb">{e().message}</p>;
        }}
      >
        <p class="content">{String(item())}</p>
      </Errored>
    </main>
  );
}

export const AppStreamed = () => <App deferStream={false} />;
export const AppDeferred = () => <App deferStream={true} />;
