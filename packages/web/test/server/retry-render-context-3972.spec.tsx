/** @jsxImportSource @solidjs/web */
// #3972: an async memo's retry (its source settled) runs under its own
// render's context, not whichever concurrent render set it last — or the
// slot content it creates takes the other render's ids. Repro by ibniss.
import { expect, test } from "vitest";
import { renderToStream, type JSX } from "@solidjs/web";
import {
  children,
  createMemo,
  createOptimisticStore,
  createProjection,
  createRenderEffect,
  createSignal,
  createStore,
  Show
} from "solid-js";
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

// The other retry paths: a compute that read a pending source re-runs when the
// source settles — a render effect's retry, a projection's re-derive (also
// `createStore(fn)` and `createOptimisticStore(fn)`). Each pass, the first and
// the retry, runs under the render that created the primitive.
const primitives: Record<
  string,
  (note: () => void, data: () => string) => () => string | undefined
> = {
  createMemo: (note, data) => {
    const m = createMemo(() => (note(), data()));
    return m;
  },
  "createSignal(fn)": (note, data) => createSignal(() => (note(), data()))[0],
  createRenderEffect: (note, data) => {
    createRenderEffect(
      () => (note(), data()),
      () => {}
    );
    return () => "";
  },
  createProjection: (note, data) => {
    const p = createProjection<{ v?: string }>(draft => {
      note();
      draft.v = data();
    }, {});
    return () => p.v;
  },
  "createStore(fn)": (note, data) => {
    const [s] = createStore<{ v?: string }>(draft => {
      note();
      draft.v = data();
    }, {});
    return () => s.v;
  },
  "createOptimisticStore(fn)": (note, data) => {
    const [s] = createOptimisticStore<{ v?: string }>(draft => {
      note();
      draft.v = data();
    }, {});
    return () => s.v;
  }
};

for (const [kind, create] of Object.entries(primitives))
  test(`${kind}: a retry runs under its own render's context`, async () => {
    const contexts: Record<string, unknown> = {};
    const passes: Record<string, unknown[]> = { A: [], B: [] };
    const page = (name: string, ms: number) =>
      render(() => {
        contexts[name] = sharedConfig.context;
        const data = createMemo(() => later(name, ms));
        const read = create(() => passes[name].push(sharedConfig.context), data);
        return <div>{read()}</div>;
      });

    await Promise.all([page("A", 5), page("B", 10)]);

    // The first pass threw on the pending source; the retry ran when it settled.
    expect(passes.A.length).toBeGreaterThan(1);
    expect(passes.B.length).toBeGreaterThan(1);
    for (const name of ["A", "B"])
      for (const seen of passes[name]) expect(seen).toBe(contexts[name]);
  });
