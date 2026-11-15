/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
/**
 * #4869: a row of a keyed optimistic store toggled twice while the first
 * toggle's action is out. A refetch landing between the toggles corrects
 * the first guess, whose screen stays until its hold lands (D-34). The
 * second toggle's setter composed on that screen (`done`) and wrote `open`,
 * but its guess went on a new carrier over the committed row (`open`) and
 * was dropped as no change: the row kept showing `done`. A rename back to
 * the confirmed title (`a` -> `b` -> `a`) is the same shape.
 */
import { expect, test } from "vitest";
import {
  action,
  createMemo,
  createOptimisticStore,
  createRoot,
  flush,
  For,
  Loading,
  refresh
} from "solid-js";

const tick = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  flush();
};

function setup<R extends { id: number }>(initial: R[], flip: (r: R) => R, show: (r: R) => string) {
  let server = initial;
  const asks: Record<string, () => void> = {};
  const ask = (k: string, f = () => {}) =>
    new Promise<void>(
      r =>
        (asks[k] = () => {
          delete asks[k];
          f();
          r();
        })
    );
  let n = 0,
    t = 0;
  let el!: HTMLElement, change!: (v?: any) => any, refetch!: () => any;
  createRoot(() => {
    const list = createMemo(async () => {
      await ask("list" + n++);
      return structuredClone(server);
    });
    const [rows, setRows] = createOptimisticStore(() => list(), null as any, { key: "id" } as any);
    change = action(function* (v?: any) {
      let next!: R;
      setRows((d: any[]) => {
        next = flip({ ...d[0] });
        Object.assign(d[0], next);
      });
      yield ask("save" + t++, () => {
        server = server.map((x, i) => (i === 0 ? { ...x, ...next } : x));
      });
      refresh(list);
    });
    refetch = action(function* () {
      refresh(list);
    });
    el = (
      <section>
        <Loading>
          <For each={rows as any[]}>{r => <i>{show(r)}</i>}</For>
        </Loading>
      </section>
    ) as any;
  });
  return { asks, el, change, refetch };
}

test("#4869 a second toggle shows after a refetch landed between the toggles", async () => {
  const { asks, el, change, refetch } = setup(
    [{ id: 0, done: false }],
    r => ({ ...r, done: !r.done }),
    r => (r.done ? "done" : "open")
  );
  asks.list0();
  await tick();
  expect(el.textContent).toBe("open");
  change();
  await tick();
  expect(el.textContent).toBe("done");
  refetch();
  await tick();
  asks.list1();
  await tick();
  expect(el.textContent).toBe("done");
  change();
  await tick();
  expect(el.textContent).toBe("open");
  // Both saves and their refetches land: it stays `open` throughout.
  asks.save0();
  await tick();
  expect(el.textContent).toBe("open");
  asks.list2();
  await tick();
  expect(el.textContent).toBe("open");
  asks.save1();
  await tick();
  expect(el.textContent).toBe("open");
  asks.list3();
  await tick();
  expect(el.textContent).toBe("open");
});

test("#4869 a rename back to the confirmed title shows after a refetch landed between", async () => {
  const titles = ["b", "a"];
  let i = 0;
  const { asks, el, change, refetch } = setup(
    [{ id: 0, title: "a" }],
    r => ({ ...r, title: titles[i++] }),
    r => r.title
  );
  asks.list0();
  await tick();
  expect(el.textContent).toBe("a");
  change();
  await tick();
  expect(el.textContent).toBe("b");
  refetch();
  await tick();
  asks.list1();
  await tick();
  expect(el.textContent).toBe("b");
  change();
  await tick();
  expect(el.textContent).toBe("a");
  asks.save0();
  await tick();
  asks.list2();
  await tick();
  expect(el.textContent).toBe("a");
  asks.save1();
  await tick();
  asks.list3();
  await tick();
  expect(el.textContent).toBe("a");
});
