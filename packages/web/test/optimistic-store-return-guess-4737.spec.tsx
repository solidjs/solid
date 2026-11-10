/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4737, #4738, #4739: a keyed `createOptimisticStore`'s guess reads the same
// at every frame however the setter writes it (S-59: a returned top-level
// array with the same keys is one write per index that differs, like the
// field write), and a guess shows from the flush that carries it (D-33).
import { expect, test } from "vitest";
import {
  Loading,
  Errored,
  For,
  action,
  createOptimisticStore,
  createMemo,
  createSignal,
  flush,
  refresh
} from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
const asker = () => {
  const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
  const pick = (key: string) =>
    asks.splice(
      asks.findIndex(a => a.key === key),
      1
    )[0];
  return { ask, pick };
};

for (const form of ["field", "return"] as const)
  test(`#4737 a failed refresh after a ${form} guess shows its error`, async () => {
    const { ask, pick } = asker();
    const c = document.body.appendChild(document.createElement("div"));
    let assign!: (id: number) => any;
    const server = [
      { id: 1, a: "-" },
      { id: 3, a: "-" }
    ];
    const dispose = render(() => {
      const [filter] = createSignal("open");
      const list = createMemo(() => (filter(), ask("fetch")));
      const [rows, set] = createOptimisticStore(
        (d: any[]) => {
          const r = (list() as any[]).map(x => ({ ...x }));
          d.length = r.length;
          r.forEach((x, i) => {
            d[i] = x;
          });
        },
        [] as any[],
        { key: "id" }
      );
      assign = action(function* (id: number) {
        set((d: any) => {
          if (form === "return") return d.map((r: any) => (r.id === id ? { ...r, a: "guest" } : r));
          d.find((x: any) => x.id === id).a = "guest";
        });
        yield ask(`assign:${id}`);
        refresh(list);
        refresh(rows);
      });
      return (
        <Loading on={filter()} fallback={<i>loading</i>}>
          <Errored fallback={(e: any) => <b>list error: {e().message}</b>}>
            <For each={rows}>
              {(r: any) => (
                <i>
                  [#{r.id} {r.a}]
                </i>
              )}
            </For>
          </Errored>
        </Loading>
      );
    }, c);
    await tick();
    pick("fetch").res(server.map(x => ({ ...x })));
    await tick();
    expect(c.textContent).toBe("[#1 -][#3 -]");
    assign(1);
    await tick();
    expect(c.textContent).toBe("[#1 guest][#3 -]");
    server[0].a = "guest";
    pick("assign:1").res({});
    await tick();
    expect(c.textContent).toBe("[#1 guest][#3 -]");
    pick("fetch").rej(new Error("down"));
    await tick();
    expect(c.textContent).toBe("list error: down");
    dispose();
    c.remove();
  });

for (const withRename of [true, false])
  test(`#4738 a field guess shows while other guesses on the store are out (rename ${withRename})`, async () => {
    const { ask, pick } = asker();
    const c = document.body.appendChild(document.createElement("div"));
    let close!: (id: number) => any,
      assign!: (id: number, who: string) => any,
      rename!: (id: number, t: string) => any;
    const dispose = render(() => {
      const server = createMemo(() => ask("fetch"));
      const [renames, setRenames] = createSignal<any[]>([]);
      const [assigns, setAssigns] = createSignal<any[]>([]);
      const [closedIds, setClosed] = createSignal<number[]>([]);
      const [rows, set] = createOptimisticStore(
        (d: any[]) => {
          const r = (server() as any[]).map(i => ({
            id: i.id,
            title:
              renames()
                .filter(x => x.id === i.id)
                .at(-1)?.title ?? i.title,
            a:
              assigns()
                .filter(x => x.id === i.id)
                .at(-1)?.a ?? i.a,
            gone: closedIds().includes(i.id)
          }));
          d.length = r.length;
          r.forEach((x, i) => {
            d[i] = x;
          });
        },
        [] as any[],
        { key: "id" }
      );
      close = action(function* (id: number) {
        const i = rows.findIndex((r: any) => r.id === id);
        set((d: any) => {
          d[i].gone = true;
        });
        try {
          yield ask(`close:${id}`);
          setClosed(cs => [...cs, id]);
        } catch {}
      });
      assign = action(function* (id: number, who: string) {
        const i = rows.findIndex((r: any) => r.id === id);
        set((d: any) => {
          d[i].a = who;
        });
        try {
          yield ask(`assign:${id}`);
          setAssigns(as => [...as.filter(a => a.id !== id), { id, a: who }]);
        } catch {}
      });
      rename = action(function* (id: number, t: string) {
        const i = rows.findIndex((r: any) => r.id === id);
        set((d: any) => {
          d[i].title = t;
        });
        try {
          yield ask(`rename:${id}`);
          setRenames(rs => [...rs.filter(r => r.id !== id), { id, title: t }]);
        } catch {}
      });
      const visible = createMemo(() => rows.filter((r: any) => !r.gone));
      return (
        <Loading fallback={<i>loading</i>}>
          <For each={visible()}>
            {(r: any) => (
              <i>
                [#{r.id} {r.title} {r.a}]
              </i>
            )}
          </For>
        </Loading>
      );
    }, c);
    await tick();
    pick("fetch").res([
      { id: 1, title: "A", a: "-" },
      { id: 3, title: "C", a: "-" },
      { id: 4, title: "D", a: "dana" }
    ]);
    await tick();
    close(1);
    await tick();
    close(3);
    await tick();
    close(4);
    await tick();
    expect(c.textContent).toBe("");
    if (withRename) {
      rename(4, "Delta");
      await tick();
    }
    pick("close:3").rej(new Error("declined"));
    await tick();
    expect(c.textContent).toBe("[#3 C -]");
    if (withRename) {
      pick("rename:4").res({});
      await tick();
    }
    assign(3, "bob");
    await tick();
    expect(c.textContent).toBe("[#3 C bob]");
    pick("assign:3").res({});
    await tick();
    expect(c.textContent).toBe("[#3 C bob]");
    dispose();
    c.remove();
  });

for (const [af, form] of [
  ["field", "field"],
  ["return", "field"],
  ["field", "removal"],
  ["return", "removal"]
] as const)
  test(`#4739 ${af} assign, a ${form} close guess made during another action's refresh`, async () => {
    const { ask, pick } = asker();
    const c = document.body.appendChild(document.createElement("div"));
    let assign!: (id: number) => any, close!: (id: number) => any;
    const server = [
      { id: 1, a: "-", closed: false },
      { id: 3, a: "-", closed: false },
      { id: 4, a: "dana", closed: false }
    ];
    const dispose = render(() => {
      const list = createMemo(() => ask("fetch"));
      const [rows, set] = createOptimisticStore(
        (d: any[]) => {
          const r = (list() as any[]).filter(x => !x.closed).map(x => ({ ...x }));
          d.length = r.length;
          r.forEach((x, i) => {
            d[i] = x;
          });
        },
        [] as any[],
        { key: "id" }
      );
      assign = action(function* (id: number) {
        set((d: any) => {
          if (af === "return") return d.map((r: any) => (r.id === id ? { ...r, a: "guest" } : r));
          d.find((r: any) => r.id === id).a = "guest";
        });
        yield ask(`assign:${id}`);
        refresh(list);
        refresh(rows);
      });
      close = action(function* (id: number) {
        set((d: any) => {
          if (form === "removal") return d.filter((r: any) => r.id !== id);
          d.find((r: any) => r.id === id).closed = true;
        });
        yield ask(`close:${id}`);
        refresh(list);
        refresh(rows);
      });
      return (
        <Loading fallback={<i>loading</i>}>
          <Errored fallback={(e: any) => <b>list error: {e().message}</b>}>
            <For each={rows.filter((r: any) => !r.closed)}>
              {(r: any) => (
                <i>
                  [#{r.id} {r.a}]
                </i>
              )}
            </For>
          </Errored>
        </Loading>
      );
    }, c);
    await tick();
    pick("fetch").res(server.map(x => ({ ...x })));
    await tick();
    assign(4);
    await tick();
    expect(c.textContent).toBe("[#1 -][#3 -][#4 guest]");
    server[2].a = "guest";
    pick("assign:4").res({});
    await tick();
    close(1);
    await tick();
    expect(c.textContent).toBe("[#3 -][#4 guest]");
    pick("fetch").rej(new Error("down"));
    await tick();
    expect(c.textContent).toBe("list error: down");
    dispose();
    c.remove();
  });
