/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { Loading, createMemo, createRoot, flush, untrack } from "solid-js";
import { render } from "../src/index.js";

// A component that creates an async memo and reads it through a plain
// `untrack` in its body used to freeze the page under <Loading>: the read
// threw NotReady, the boundary re-ran the body, and the body made a fresh
// pending memo, forever. In dev it now throws PENDING_ASYNC_UNTRACKED_READ,
// as the same read without `untrack` does.
describe("untracked pending read in a component body", () => {
  it("throws the dev error instead of re-running forever", async () => {
    const p = new Promise<{ name: string }>(() => {});
    function Page() {
      const user = createMemo(() => p);
      const v = untrack(() => user() ?? { name: "" });
      return <span>{v.name}</span>;
    }
    const c = document.body.appendChild(document.createElement("div"));
    let error: unknown;
    try {
      render(
        () => (
          <Loading fallback={<i>loading</i>}>
            <Page />
          </Loading>
        ),
        c
      );
    } catch (e) {
      error = e;
    }
    flush();
    expect(String(error)).toContain("[PENDING_ASYNC_UNTRACKED_READ]");
    c.remove();
  });

  it("a memo created outside the body still reads through untrack under <Loading>", async () => {
    let resolve!: (v: { name: string }) => void;
    const p = new Promise<{ name: string }>(r => (resolve = r));
    let user!: () => { name: string };
    createRoot(() => (user = createMemo(() => p)));
    function Page() {
      const v = untrack(() => user());
      return <span>{v.name}</span>;
    }
    const c = document.body.appendChild(document.createElement("div"));
    render(
      () => (
        <Loading fallback={<i>loading</i>}>
          <Page />
        </Loading>
      ),
      c
    );
    flush();
    expect(c.innerHTML).toBe("<i>loading</i>");
    resolve({ name: "Tony" });
    await p;
    await new Promise(r => setTimeout(r, 0));
    flush();
    expect(c.innerHTML).toBe("<span>Tony</span>");
    c.remove();
  });
});
