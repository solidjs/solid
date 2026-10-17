/**
 * @jsxImportSource @solidjs/web
 *
 * A sequential `<Reveal>` reveals its boundaries in REGISTRATION order, and a
 * boundary registers when its component renders. A `<For>` of boundaries
 * followed by a sibling boundary must therefore register the rows first: the
 * list's rows render while the enclosing template's arguments are evaluated,
 * in source order with the sibling. A list memo that pulled lazily (at the
 * template's read of the accessor, after the eagerly called sibling) would
 * register the sibling first and reveal it ahead of the rows — the regression
 * that `perf/ssr-suspend-unwind`'s reverted second commit introduced.
 */
import { describe, expect, test } from "vitest";
import { createMemo } from "solid-js";
import { For, Loading, renderToStream, Reveal } from "@solidjs/web";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(res => (resolve = res));
  return { promise, resolve };
}
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

function collect(code: () => any): Promise<string> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(code).pipe({
      write: (c: string) => chunks.push(c),
      end: () => resolve(chunks.join(""))
    });
  });
}

describe("<Reveal> with a <For> of boundaries before a sibling boundary", () => {
  test("the rows register before the sibling and reveal first, whatever settles first", async () => {
    const a = deferred<string>();
    const b = deferred<string>();
    const tail = deferred<string>();
    const sources: Record<string, Promise<string>> = { a: a.promise, b: b.promise };

    function Row(props: { k: string }) {
      const data = createMemo(async () => sources[props.k]);
      return <div class="row">{data()}</div>;
    }
    function Tail() {
      const data = createMemo(async () => tail.promise);
      return <div class="tail">{data()}</div>;
    }
    function App() {
      return (
        <Reveal>
          <For each={["a", "b"]}>
            {k => (
              <Loading fallback={<p>loading {k}</p>}>
                <Row k={k} />
              </Loading>
            )}
          </For>
          <Loading fallback={<p>loading tail</p>}>
            <Tail />
          </Loading>
        </Reveal>
      );
    }

    const done = collect(() => <App />);
    // Past the shell (everything pending streams as fragments), the sibling
    // settles first; sequential order must still hold it for the rows.
    await delay(10);
    tail.resolve("tail-content");
    await delay(20);
    a.resolve("row-a");
    await delay(20);
    b.resolve("row-b");
    const full = await done;

    const keyOf = (content: string) =>
      full.match(new RegExp(`<template id="(\\d+)"><div[^>]*>${content}`))![1];
    const activation = (key: string) => full.indexOf(`$dfj(["${key}"])`);
    const [ka, kb, kt] = [keyOf("row-a"), keyOf("row-b"), keyOf("tail-content")];
    expect(activation(ka)).toBeGreaterThan(-1);
    expect(activation(kb)).toBeGreaterThan(activation(ka));
    expect(activation(kt)).toBeGreaterThan(activation(kb));
  });
});
