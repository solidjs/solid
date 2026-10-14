/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { Loading, Show, action, createMemo, createSignal, flush } from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  flush();
};

/**
 * #3540, in a flush: a `<Show>` that flips mainline to mount a fresh
 * `<Loading>` over a held value shows `open` and the fallback now; the
 * content reveals with the hold's commit. A derivation outside the boundary
 * in the same mount still makes the tick join the hold (membership is the
 * tick's).
 */
describe("a fresh Loading mounted by a flush over a held value (#3540)", () => {
  function setup(outside: boolean) {
    const container = document.createElement("div");
    const [x, setX] = createSignal(0);
    const [open, setOpen] = createSignal(false);
    function Content() {
      const m = createMemo(() => `content ${x()}`);
      return <p>{m()}</p>;
    }
    function Label() {
      const m = createMemo(() => `label ${x()}`);
      return <b>{m()}</b>;
    }
    const dispose = render(
      () => (
        <main>
          <h1>{x()}</h1>
          <i>{String(open())}</i>
          <Show when={open()}>
            {outside && <Label />}
            <Loading fallback={<p>fallback</p>}>
              <Content />
            </Loading>
          </Show>
        </main>
      ),
      container
    );
    flush();
    let release!: () => void;
    const done = action(function* () {
      setX(1);
      yield new Promise<void>(r => (release = r));
    })();
    flush();
    return { container, setOpen, release: () => release(), done, dispose };
  }

  test("the mount and the fallback show now; the content reveals at the commit", async () => {
    const s = setup(false);
    expect(s.container.innerHTML).toBe("<main><h1>0</h1><i>false</i></main>");

    s.setOpen(true);
    flush();
    expect(s.container.innerHTML).toBe("<main><h1>0</h1><i>true</i><p>fallback</p></main>");

    s.release();
    await s.done;
    await tick();
    expect(s.container.innerHTML).toBe("<main><h1>1</h1><i>true</i><p>content 1</p></main>");
    s.dispose();
  });

  test("mounted outside a flush, content bound in JSX: the fallback now, the content at the commit", async () => {
    const [x, setX] = createSignal(0);
    let release!: () => void;
    const done = action(function* () {
      setX(1);
      yield new Promise<void>(r => (release = r));
    })();
    flush();
    function Content() {
      const m = createMemo(() => `content ${x()}`);
      return <p>{m()}</p>;
    }
    const container = document.createElement("div");
    const dispose = render(
      () => (
        <Loading fallback={<p>fallback</p>}>
          <Content />
        </Loading>
      ),
      container
    );
    flush();
    expect(container.innerHTML).toBe("<p>fallback</p>");

    release();
    await done;
    await tick();
    expect(container.innerHTML).toBe("<p>content 1</p>");
    dispose();
  });

  test("a derivation outside the boundary holds the mount with the tick", async () => {
    const s = setup(true);
    s.setOpen(true);
    flush();
    expect(s.container.innerHTML).toBe("<main><h1>0</h1><i>false</i></main>");

    s.release();
    await s.done;
    await tick();
    expect(s.container.innerHTML).toBe(
      "<main><h1>1</h1><i>true</i><b>label 1</b><p>content 1</p></main>"
    );
    s.dispose();
  });
});
