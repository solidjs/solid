/** @jsxImportSource @solidjs/web */
// #3972: an async memo's retry (its source settled) runs under its own
// render's context, not whichever concurrent render set it last — or the
// slot content it creates takes the other render's ids. Repro by ibniss.
import { expect, test } from "vitest";
import { renderToStream, type JSX } from "@solidjs/web";
import { children, createMemo, Show } from "solid-js";
import { sharedConfig } from "solid-js/internal";

const render = (code: () => any) => renderToStream(code).pipeTo(new WritableStream({ write() {} }));

const later = <T,>(value: T, ms: number) => new Promise<T>(r => setTimeout(() => r(value), ms));

// A layout with an optional side slot: resolved once with `children()`, and
// laid out differently when it is present.
function Layout(props: { side?: JSX.Element }) {
  const side = children(() => props.side);
  return (
    <Show when={side() !== undefined} fallback={<main />}>
      <aside>{side()}</aside>
      <main />
    </Show>
  );
}

test("a slot resolved by children() is created under its own render's context", async () => {
  const contexts: Record<string, unknown> = {};
  const seenBy: Record<string, unknown> = {};

  // Two requests rendering the same page; each page's slot waits on its own data.
  const page = (name: string, ms: number) =>
    render(() => {
      contexts[name] = sharedConfig.context;
      const data = createMemo(() => later(name, ms));
      return (
        <Layout
          side={
            <Show when={data()}>
              {(() => {
                seenBy[name] = sharedConfig.context;
                return name;
              })()}
            </Show>
          }
        />
      );
    });

  await Promise.all([page("A", 5), page("B", 10)]);

  expect(seenBy.A).toBe(contexts.A);
  expect(seenBy.B).toBe(contexts.B);
});
