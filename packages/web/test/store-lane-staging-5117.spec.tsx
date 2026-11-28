/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { expect, test } from "vitest";
import {
  For,
  Loading,
  Show,
  action,
  createMemo,
  createOptimistic,
  createOptimisticStore,
  createProjection,
  createSignal,
  flush,
  refresh
} from "solid-js";
import { render } from "@solidjs/web";

process.on("unhandledRejection", () => {});

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

function desk() {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const land = async (key: string, v: any = key) => {
    const i = asks.findIndex(a => a.key === key);
    if (i < 0) throw new Error(`no ask ${key}; open: ${asks.map(a => a.key)}`);
    asks.splice(i, 1)[0].res(v);
    await tick();
  };
  const drain = async () => {
    for (let n = 0; n < 30 && asks.length; n++) {
      for (const a of asks.splice(0)) a.res(a.key);
      await tick();
    }
  };
  return { ask, land, drain, open: () => asks.map(a => a.key).join(",") };
}

function mount(view: () => any) {
  const container = document.body.appendChild(document.createElement("div"));
  const dispose = render(view, container);
  return {
    frame: () => container.textContent!.replace(/\s+/g, " ").trim(),
    dispose: () => (dispose(), container.remove())
  };
}

test("W: one projection field shows one value in a frame, inside and outside a closing <Show>", async () => {
  const d = desk();
  let act!: (x: number) => void;
  const app = mount(() => {
    const [s, setS] = createSignal(0);
    const [o, setO] = createOptimistic(() => d.ask("o:" + s()));
    const p = createProjection<{ n: any }>(draft => void (draft.n = o()), { n: 0 });
    act = action(function* (x: number) {
      setS(x);
      setO("G");
      yield d.ask("save");
    });
    return (
      <div>
        [p={p.n}]{" "}
        <Show when={s() < 2}>
          <span>[p={p.n}]</span>
        </Show>
      </div>
    );
  });
  flush();
  await tick();
  await d.drain();
  act(2);
  flush();
  await tick();
  const mid = app.frame();
  await d.drain();
  app.dispose();
  expect(new Set([...mid.matchAll(/\[p=([^\]]*)\]/g)].map(m => m[1])).size, mid).toBe(1);
});

test("L6: <For> over a keyed projection of an optimistic list does not read an undefined row", async () => {
  const d = desk();
  const errors: string[] = [];
  const origError = console.error;
  console.error = (...a: any[]) =>
    void errors.push(String(a[0]) + " " + String(a[1]?.message ?? ""));
  let tog!: (i: number, v: boolean) => void, del!: (id: number) => void;
  const app = mount(() => {
    const [rows, setRows] = createOptimisticStore<{ id: number; t: string; d: boolean }[]>(
      () => d.ask("list"),
      [],
      { key: "id" }
    );
    const openList = createMemo(() => rows.filter(x => !x.d));
    const open = createProjection(() => openList(), [], { key: "id" });
    tog = action(function* (i: number, v: boolean) {
      setRows(dr => void (dr[i].d = v));
      yield d.ask("tog");
    });
    del = action(function* () {
      yield d.ask("del");
      refresh(rows);
    });
    return (
      <Loading fallback="loading">
        <p>
          open:
          <For each={open}>
            {y => (
              <i>
                &lt;{y.id}
                {y.t}&gt;
              </i>
            )}
          </For>
        </p>
      </Loading>
    );
  });
  flush();
  await tick();
  await d.land("list", [{ id: 1, t: "c", d: false }]);
  tog(0, true);
  await tick();
  del(1);
  await tick();
  await d.land("del", 0);
  const got = app.frame();
  await d.land("list", []);
  await d.land("tog", 0);
  const end = app.frame();
  app.dispose();
  console.error = origError;
  expect({ got, end, errors }).toEqual({
    got: expect.not.stringContaining("undefined"),
    end: "open:",
    errors: []
  });
});
