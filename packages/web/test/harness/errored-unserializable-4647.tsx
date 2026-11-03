/**
 * @jsxImportSource @solidjs/web
 *
 * Fixtures for #4647 (maintainer ruling, 2026-11-03): an async memo whose
 * server value cannot be serialized, settling after the first flush (inside a
 * `<Loading>`, so the shell went out first) — the render completes and the
 * memo's key rejects on the client. Rendered by
 * test/server/errored-unserializable-4647.gen.spec.tsx, replayed by
 * test/hydration/errored-unserializable-hydration-4647.spec.tsx. The same
 * components run on both sides: `env.client` picks what `ask` answers.
 */
import { createMemo, createSignal, Loading } from "solid-js";
import { Errored } from "@solidjs/web";

export class Unserializable {}

export const env: {
  client: boolean;
  runs: number;
  RealPromise: PromiseConstructor;
  setters: { sel?: (v: number) => void; reset?: () => void };
} = {
  client: false,
  runs: 0,
  RealPromise: Promise,
  setters: {}
};

// Server: an Unserializable; client: a string. The hydration dry run
// computes under a mock Promise: count real asks only.
function ask(sel: number) {
  if (env.client && Promise === env.RealPromise) env.runs++;
  return new Promise<any>(r =>
    setTimeout(() => r(env.client ? `pear ${sel}` : new Unserializable()), 20)
  );
}
const show = (v: any) => (v instanceof Unserializable ? "server value" : String(v));

/** A sibling whose value serializes, before the shell. */
function Ok() {
  const ok = createMemo(() => new Promise<string>(r => setTimeout(() => r("fine"), 1)));
  return <span class="ok">{ok()}</span>;
}

function fallback(e: () => any, reset: () => void) {
  env.setters.reset = reset;
  return <p class="fb">{e().message}</p>;
}

/** The memo inside a `<Loading>` inside the `<Errored>`. */
export function AppInside() {
  const [sel, setSel] = createSignal(1);
  env.setters.sel = setSel;
  return (
    <main>
      <Ok />
      <Errored fallback={fallback}>
        <Loading fallback={<p class="loading">loading</p>}>
          {(() => {
            const item = createMemo(() => ask(sel()));
            return <p class="content">{show(item())}</p>;
          })()}
        </Loading>
      </Errored>
    </main>
  );
}

/** The memo outside the `<Errored>`, read inside it. */
export function AppOutside() {
  const [sel, setSel] = createSignal(1);
  env.setters.sel = setSel;
  return (
    <main>
      <Ok />
      <Loading fallback={<p class="loading">loading</p>}>
        {(() => {
          const item = createMemo(() => ask(sel()));
          return (
            <Errored fallback={fallback}>
              <p class="content">{show(item())}</p>
            </Errored>
          );
        })()}
      </Loading>
    </main>
  );
}

/** No `<Errored>` above the memo. */
export function AppBare() {
  return (
    <main>
      <Ok />
      <Loading fallback={<p class="loading">loading</p>}>
        {(() => {
          const item = createMemo(() => ask(1));
          return <p class="content">{show(item())}</p>;
        })()}
      </Loading>
    </main>
  );
}
