import { afterEach, describe, expect, it } from "vitest";
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createStore,
  flush
} from "../../src/index.js";

afterEach(() => flush());

const tick = () => new Promise<void>(r => setTimeout(r, 0));

function pending() {
  let release!: () => void;
  const promise = new Promise<void>(r => (release = r));
  return { promise, release };
}

async function settle(run: () => Promise<void>) {
  const done = run();
  flush();
  await done;
  flush();
  await tick();
  flush();
}

describe("#3672 — chained optimistic store, second action moves back to the previous value", () => {
  it("writes the base's previous value as an override while pending", async () => {
    const seen: string[] = [];
    const { base, setBase, view, setView } = createRoot(() => {
      const [base, setBase] = createStore({ position: 0, moving: false });
      const [view, setView] = createOptimisticStore(base);
      createRenderEffect(
        () => `${view.position}:${view.moving}`,
        v => {
          seen.push(v);
        }
      );
      return { base, setBase, view, setView };
    });
    flush();
    expect(seen).toEqual(["0:false"]);

    await settle(
      action(function* () {
        setView(d => {
          d.position = 1;
          d.moving = true;
        });
        yield tick();
        setBase(d => {
          d.position = 1;
        });
      })
    );
    expect(base.position).toBe(1);
    expect(view.position).toBe(1);
    expect(view.moving).toBe(false);
    expect(seen.at(-1)).toBe("1:false");

    const gate = pending();
    const second = action(function* () {
      setView(d => {
        d.position = 0;
        d.moving = true;
      });
      yield gate.promise;
    })();
    flush();
    expect(base.position).toBe(1);
    expect(view.moving).toBe(true);
    expect(view.position).toBe(0);
    expect(seen.at(-1)).toBe("0:true");

    gate.release();
    await second;
    flush();
    expect(view.position).toBe(1);
    expect(view.moving).toBe(false);
    expect(seen.at(-1)).toBe("1:false");
  });

  it("re-adds a key the base deleted after the first action confirmed the delete", async () => {
    const { base, setBase, view, setView } = createRoot(() => {
      const [base, setBase] = createStore<{ tag?: string }>({ tag: "x" });
      const [view, setView] = createOptimisticStore(base);
      createRenderEffect(
        () => [view.tag, "tag" in view],
        () => {}
      );
      return { base, setBase, view, setView };
    });
    flush();

    await settle(
      action(function* () {
        setView(d => {
          delete d.tag;
        });
        yield tick();
        setBase(d => {
          delete d.tag;
        });
      })
    );
    expect("tag" in base).toBe(false);
    expect("tag" in view).toBe(false);

    const gate = pending();
    const second = action(function* () {
      setView(d => {
        d.tag = "x";
      });
      yield gate.promise;
    })();
    flush();
    expect("tag" in base).toBe(false);
    expect("tag" in view).toBe(true);
    expect(view.tag).toBe("x");
    expect(Object.keys(view)).toEqual(["tag"]);

    gate.release();
    await second;
    flush();
    expect("tag" in view).toBe(false);
  });

  it("pops a row the base appended after the first action confirmed the push", async () => {
    const { base, setBase, view, setView } = createRoot(() => {
      const [base, setBase] = createStore([{ id: "a" }]);
      const [view, setView] = createOptimisticStore(base);
      createRenderEffect(
        () => view.map(r => r.id).join(),
        () => {}
      );
      return { base, setBase, view, setView };
    });
    flush();

    await settle(
      action(function* () {
        setView(d => {
          d.push({ id: "b" });
        });
        yield tick();
        setBase(d => {
          d.push({ id: "b" });
        });
      })
    );
    expect(base.length).toBe(2);
    expect(view.length).toBe(2);

    const gate = pending();
    const second = action(function* () {
      setView(d => {
        d.pop();
      });
      yield gate.promise;
    })();
    flush();
    expect(base.length).toBe(2);
    expect(view.length).toBe(1);
    expect(view.map(r => r.id)).toEqual(["a"]);
    expect(1 in view).toBe(false);

    gate.release();
    await second;
    flush();
    expect(view.length).toBe(2);
  });
});
