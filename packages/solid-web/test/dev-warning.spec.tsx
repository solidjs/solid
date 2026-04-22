/**
 * @jsxImportSource solid-js
 * @vitest-environment jsdom
 */

import { describe, expect, test, vi, afterEach } from "vitest";
import { createMemo, Loading, flush } from "solid-js";
import { render } from "../src/index.js";

describe("Dev-mode async warning", () => {
  let div: HTMLDivElement;
  let disposer: (() => void) | undefined;

  afterEach(() => {
    if (disposer) {
      disposer();
      disposer = undefined;
    }
    div?.remove();
  });

  test("warns when async content rendered without Loading boundary", () => {
    div = document.createElement("div");
    document.body.appendChild(div);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => {
      disposer = render(() => {
        const value = createMemo(() => new Promise<string>(() => {}));
        return <div>{value()}</div>;
      }, div);
    }).not.toThrow();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Loading boundary"));
    warnSpy.mockRestore();
  });

  test("no Loading-boundary warning when async content wrapped in Loading", () => {
    div = document.createElement("div");
    document.body.appendChild(div);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => {
      disposer = render(() => {
        const value = createMemo(() => new Promise<string>(() => {}));
        return (
          <Loading fallback="loading">
            <div>{value()}</div>
          </Loading>
        );
      }, div);
    }).not.toThrow();

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("Loading boundary"));
    warnSpy.mockRestore();
  });
});

describe("Deferred root mount", () => {
  let divs: HTMLDivElement[] = [];
  const disposers: Array<() => void> = [];

  afterEach(() => {
    disposers.splice(0).forEach(d => d());
    divs.splice(0).forEach(d => d.remove());
  });

  function makeMount(): HTMLDivElement {
    const el = document.createElement("div");
    document.body.appendChild(el);
    divs.push(el);
    return el;
  }

  test("happy-path: attaches synchronously on no-async render", () => {
    const el = makeMount();
    disposers.push(render(() => <div class="hello">hi</div>, el));

    expect(el.innerHTML).toContain("hi");
  });

  test("uncaught async defers root mount until pending settles", async () => {
    const el = makeMount();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let resolveFn!: (v: string) => void;
    const promise = new Promise<string>(r => {
      resolveFn = r;
    });

    disposers.push(
      render(() => {
        const value = createMemo(() => promise);
        return <div class="async">{value()}</div>;
      }, el)
    );

    expect(el.innerHTML).toBe("");

    resolveFn("done");
    await promise;
    flush();
    await Promise.resolve();
    flush();

    expect(el.innerHTML).toContain("done");
    warnSpy.mockRestore();
  });

  test("nested async: element empty until nested pending settles, then commits atomically", async () => {
    const el = makeMount();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let resolveFn!: (v: string) => void;
    const promise = new Promise<string>(r => {
      resolveFn = r;
    });

    function Inner() {
      const value = createMemo(() => promise);
      return <span class="inner">{value()}</span>;
    }

    disposers.push(
      render(
        () => (
          <div class="outer">
            <span class="sibling">static</span>
            <Inner />
          </div>
        ),
        el
      )
    );

    expect(el.innerHTML).toBe("");

    resolveFn("ready");
    await promise;
    flush();
    await Promise.resolve();
    flush();

    const html = el.innerHTML;
    expect(html).toContain("static");
    expect(html).toContain("ready");
    expect(html).toContain('class="outer"');
    warnSpy.mockRestore();
  });

  test("nested async: ASYNC_OUTSIDE_LOADING_BOUNDARY warn fires once on initial mount", async () => {
    const el = makeMount();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let resolveFn!: (v: string) => void;
    const promise = new Promise<string>(r => {
      resolveFn = r;
    });

    function Inner() {
      const value = createMemo(() => promise);
      return <span class="inner">{value()}</span>;
    }

    disposers.push(
      render(
        () => (
          <div class="outer">
            <Inner />
          </div>
        ),
        el
      )
    );

    expect(
      warnSpy.mock.calls.some(args =>
        args.some(a => typeof a === "string" && a.includes("Loading boundary"))
      )
    ).toBe(true);

    resolveFn("ready");
    await promise;
    flush();
    await Promise.resolve();
    flush();

    warnSpy.mockRestore();
  });

  test("nested async wrapped in Loading: no deferral, no warn", () => {
    const el = makeMount();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    function Inner() {
      const value = createMemo(() => new Promise<string>(() => {}));
      return <span class="inner">{value()}</span>;
    }

    disposers.push(
      render(
        () => (
          <div class="outer">
            <Loading fallback={<span class="fallback">wait</span>}>
              <Inner />
            </Loading>
          </div>
        ),
        el
      )
    );

    expect(el.innerHTML).toContain("fallback");
    expect(el.innerHTML).toContain("outer");
    expect(
      warnSpy.mock.calls.some(args =>
        args.some(a => typeof a === "string" && a.includes("Loading boundary"))
      )
    ).toBe(false);
    warnSpy.mockRestore();
  });

  test("islands: independent render() calls do not block each other", async () => {
    const fastEl = makeMount();
    const slowEl = makeMount();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    let resolveFast!: (v: string) => void;
    let resolveSlow!: (v: string) => void;
    const fastPromise = new Promise<string>(r => {
      resolveFast = r;
    });
    const slowPromise = new Promise<string>(r => {
      resolveSlow = r;
    });

    disposers.push(
      render(() => {
        const value = createMemo(() => fastPromise);
        return <div class="fast">{value()}</div>;
      }, fastEl)
    );
    disposers.push(
      render(() => {
        const value = createMemo(() => slowPromise);
        return <div class="slow">{value()}</div>;
      }, slowEl)
    );

    expect(fastEl.innerHTML).toBe("");
    expect(slowEl.innerHTML).toBe("");

    resolveFast("fast-done");
    await fastPromise;
    flush();
    await Promise.resolve();
    flush();

    expect(fastEl.innerHTML).toContain("fast-done");
    expect(slowEl.innerHTML).toBe("");

    resolveSlow("slow-done");
    await slowPromise;
    flush();
    await Promise.resolve();
    flush();

    expect(slowEl.innerHTML).toContain("slow-done");
    warnSpy.mockRestore();
  });
});
