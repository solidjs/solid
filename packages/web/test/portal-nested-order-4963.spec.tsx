/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { Loading, createMemo, createSignal, flush } from "solid-js";
import { describe, expect, test } from "vitest";
import { Portal, render } from "../src/index.js";

const order = (root: ParentNode) =>
  [...root.querySelectorAll("[data-p]")].map(el => (el as HTMLElement).dataset.p);

describe("nested Portal order (#4963)", () => {
  test("a nested portal mounts after its parent portal", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const dispose = render(
      () => (
        <Portal>
          <div data-p="outer">
            <Portal>
              <div data-p="inner" />
            </Portal>
          </div>
        </Portal>
      ),
      document.getElementById("app")!
    );
    flush();
    expect(order(document.body)).toEqual(["outer", "inner"]);
    dispose();
    expect(order(document.body)).toEqual([]);
  });

  test("a nested portal shown later still mounts after its parent", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const [open, setOpen] = createSignal(false);
    const dispose = render(
      () => (
        <Portal>
          <div data-p="outer">
            {open() && (
              <Portal>
                <div data-p="inner" />
              </Portal>
            )}
          </div>
        </Portal>
      ),
      document.getElementById("app")!
    );
    flush();
    setOpen(true);
    flush();
    expect(order(document.body)).toEqual(["outer", "inner"]);
    setOpen(false);
    flush();
    expect(order(document.body)).toEqual(["outer"]);
    dispose();
  });

  test("three levels and siblings keep tree order", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const dispose = render(
      () => (
        <>
          <Portal>
            <div data-p="a">
              <Portal>
                <div data-p="a1">
                  <Portal>
                    <div data-p="a1x" />
                  </Portal>
                </div>
              </Portal>
            </div>
          </Portal>
          <Portal>
            <div data-p="b" />
          </Portal>
        </>
      ),
      document.getElementById("app")!
    );
    flush();
    expect(order(document.body)).toEqual(["a", "a1", "a1x", "b"]);
    dispose();
  });

  test("an inner portal with its own mount, and an outer mount swap", () => {
    document.body.innerHTML = '<div id="app"></div><div id="m1"></div><div id="m2"></div>';
    const m1 = document.getElementById("m1")!,
      m2 = document.getElementById("m2")!;
    const [mount, setMount] = createSignal<Element>(m1);
    const dispose = render(
      () => (
        <Portal mount={mount()}>
          <div data-p="outer">
            <Portal mount={m2}>
              <div data-p="other" />
            </Portal>
            <Portal mount={m1}>
              <div data-p="inner" />
            </Portal>
          </div>
        </Portal>
      ),
      document.getElementById("app")!
    );
    flush();
    expect(order(m2)).toEqual(["other"]);
    expect(order(m1)).toEqual(["outer", "inner"]);
    setMount(m2);
    flush();
    expect(order(m1)).toEqual(["inner"]);
    expect(order(m2).sort()).toEqual(["other", "outer"]);
    dispose();
    expect(order(document.body)).toEqual([]);
  });

  test("nested portals behind a fallback keep tree order at the reveal (D-19)", async () => {
    document.body.innerHTML = '<div id="app"></div>';
    let resolve!: (v: string) => void;
    const dispose = render(() => {
      const data = createMemo(() => new Promise<string>(r => (resolve = r)));
      return (
        <Loading fallback={<p>loading</p>}>
          <Portal>
            <div data-p="outer">
              {data()}
              <Portal>
                <div data-p="inner" />
              </Portal>
            </div>
          </Portal>
        </Loading>
      );
    }, document.getElementById("app")!);
    flush();
    expect(order(document.body)).toEqual([]);
    resolve("x");
    await Promise.resolve();
    await new Promise(r => setTimeout(r, 0));
    flush();
    expect(order(document.body)).toEqual(["outer", "inner"]);
    dispose();
  });
});
